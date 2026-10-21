from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from io import BytesIO
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request, send_file, session
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

import model_adapter


BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = Path(os.environ.get("BONEAI_INSTANCE_DIR", BASE_DIR / "instance"))
UPLOAD_DIR = INSTANCE_DIR / "uploads"
DB_PATH = INSTANCE_DIR / "boneai.sqlite3"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_FORMATS = {"JPEG": ".jpg", "PNG": ".png"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

APP_ENV = os.environ.get("BONEAI_ENV", "development").lower()
SECRET_KEY = os.environ.get("BONEAI_SECRET_KEY")
if APP_ENV == "production" and not SECRET_KEY:
    raise RuntimeError("Set BONEAI_SECRET_KEY before running BoneAI in production.")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=SECRET_KEY or "dev-only-change-this-secret",
    MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES + (256 * 1024),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("BONEAI_HTTPS", "0") == "1",
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        connection = sqlite3.connect(DB_PATH)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        g.db = connection
    return g.db


@app.teardown_appcontext
def close_db(_error=None) -> None:
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def init_db() -> None:
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL,
            label TEXT,
            fracture_probability REAL,
            confidence REAL,
            box_json TEXT,
            image_width INTEGER NOT NULL,
            image_height INTEGER NOT NULL,
            model_version TEXT,
            message TEXT,
            review_label TEXT,
            review_note TEXT,
            review_updated_at TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS analyses_user_created_idx
            ON analyses(user_id, created_at DESC);
        """
    )
    # Small in-place migration for databases created by an earlier prototype.
    columns = {row[1] for row in connection.execute("PRAGMA table_info(analyses)").fetchall()}
    for column, definition in (
        ("review_label", "TEXT"),
        ("review_note", "TEXT"),
        ("review_updated_at", "TEXT"),
    ):
        if column not in columns:
            connection.execute(f"ALTER TABLE analyses ADD COLUMN {column} {definition}")
    connection.commit()
    connection.close()


init_db()


def api_login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify(error="Please sign in to use the analysis workspace.", auth_required=True), 401
        return view(*args, **kwargs)

    return wrapped


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute(
        "SELECT id, name, email FROM users WHERE id = ?", (user_id,)
    ).fetchone()


def json_body() -> dict:
    return request.get_json(silent=True) or {}


def analysis_to_dict(row: sqlite3.Row) -> dict:
    box = None
    if row["box_json"]:
        try:
            box = json.loads(row["box_json"])
        except (TypeError, json.JSONDecodeError):
            box = None
    return {
        "id": row["id"],
        "original_name": row["original_name"],
        "created_at": row["created_at"],
        "status": row["status"],
        "label": row["label"],
        "fracture_probability": row["fracture_probability"],
        "confidence": row["confidence"],
        "box": box,
        "image_width": row["image_width"],
        "image_height": row["image_height"],
        "model_version": row["model_version"],
        "message": row["message"],
        "review_label": row["review_label"],
        "review_note": row["review_note"],
        "review_updated_at": row["review_updated_at"],
        "image_url": f"/api/analyses/{row['id']}/image",
    }


def image_from_upload(file_storage):
    """Validate, decode, orient, and safely re-encode an uploaded X-ray image."""
    raw = file_storage.read(MAX_UPLOAD_BYTES + 1)
    if not raw:
        raise ValueError("Choose an image before starting the analysis.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("The image is larger than 10 MB. Choose a smaller file.")

    try:
        probe = Image.open(BytesIO(raw))
        image_format = probe.format
        if probe.width < 32 or probe.height < 32:
            raise ValueError("The image is too small to analyze (minimum 32 × 32 pixels).")
        if probe.width * probe.height > 20_000_000:
            raise ValueError("The image dimensions are too large. Please resize it and try again.")
        probe.verify()
        image = Image.open(BytesIO(raw))
        image = ImageOps.exif_transpose(image)
        image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValueError("This file could not be read as a valid PNG or JPEG image.")

    if image_format not in ALLOWED_FORMATS:
        raise ValueError("Only PNG and JPG/JPEG images are supported.")
    width, height = image.size
    if width < 32 or height < 32:
        raise ValueError("The image is too small to analyze (minimum 32 × 32 pixels).")
    if width * height > 20_000_000:
        raise ValueError("The image dimensions are too large. Please resize it and try again.")

    # Re-encoding strips embedded metadata and keeps the stored file name safe.
    suffix = ALLOWED_FORMATS[image_format]
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    destination = UPLOAD_DIR / stored_name
    if image_format == "JPEG":
        image.convert("RGB").save(destination, format="JPEG", quality=94, optimize=True)
    else:
        if image.mode not in ("L", "RGB"):
            image = image.convert("RGB")
        image.save(destination, format="PNG", optimize=True)

    original_name = secure_filename(file_storage.filename or "xray-image") or "xray-image"
    return image.convert("L"), stored_name, original_name, width, height


def get_owned_analysis(analysis_id: int):
    return get_db().execute(
        "SELECT * FROM analyses WHERE id = ? AND user_id = ?",
        (analysis_id, session["user_id"]),
    ).fetchone()


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "model": model_adapter.status()})


@app.get("/api/me")
def me():
    user = current_user()
    if not user:
        return jsonify(authenticated=False)
    return jsonify(
        authenticated=True,
        user={"id": user["id"], "name": user["name"], "email": user["email"]},
    )


@app.post("/api/register")
def register():
    data = json_body()
    name = " ".join(str(data.get("name", "")).split())[:80]
    email = str(data.get("email", "")).strip().lower()[:254]
    password = str(data.get("password", ""))

    if len(name) < 2:
        return jsonify(error="Enter your name (at least 2 characters)."), 400
    if not EMAIL_RE.match(email):
        return jsonify(error="Enter a valid email address."), 400
    if len(password) < 8:
        return jsonify(error="Use a password with at least 8 characters."), 400

    connection = get_db()
    try:
        cursor = connection.execute(
            "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (name, email, generate_password_hash(password), utc_now()),
        )
        connection.commit()
    except sqlite3.IntegrityError:
        return jsonify(error="An account with that email already exists. Try signing in."), 409

    session.clear()
    session["user_id"] = cursor.lastrowid
    return jsonify(
        authenticated=True,
        user={"id": cursor.lastrowid, "name": name, "email": email},
    ), 201


@app.post("/api/login")
def login():
    data = json_body()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify(error="The email or password is incorrect."), 401

    session.clear()
    session["user_id"] = user["id"]
    session.permanent = bool(data.get("remember", False))
    return jsonify(
        authenticated=True,
        user={"id": user["id"], "name": user["name"], "email": user["email"]},
    )


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.post("/api/analyze")
@api_login_required
def analyze():
    uploaded = request.files.get("image")
    if uploaded is None:
        return jsonify(error="Choose an image before starting the analysis."), 400
    if not uploaded.filename:
        return jsonify(error="Choose an image before starting the analysis."), 400

    extension = Path(uploaded.filename).suffix.lower()
    if extension not in {".jpg", ".jpeg", ".png"}:
        return jsonify(error="Only PNG and JPG/JPEG images are supported."), 400

    try:
        image, stored_name, original_name, width, height = image_from_upload(uploaded)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

    model_status = model_adapter.status()
    status = "model_unavailable"
    label = None
    fracture_probability = None
    confidence = None
    box = None
    model_version = model_status.get("model_name")
    message = model_status.get(
        "message",
        "A trained model is not connected. The image was uploaded and preprocessed successfully.",
    )

    try:
        # This is performed even when weights are absent so the image-processing
        # module is independently testable and the upload path is end-to-end.
        prepared_input = model_adapter.preprocess(image)
        if model_status.get("ready"):
            prediction = model_adapter.predict(image, prepared_input)
            fracture_probability = float(prediction["fracture_probability"])
            threshold = float(os.environ.get("BONEAI_THRESHOLD", "0.5"))
            if fracture_probability >= threshold:
                label = "fracture_suspected"
                confidence = fracture_probability
            else:
                label = "no_fracture_detected"
                confidence = 1.0 - fracture_probability
            box = prediction.get("box")
            model_version = prediction.get("model_version") or model_version
            status = "completed"
            message = "Model inference completed. This research output requires professional review."
    except Exception as exc:  # Keep a failed preprocessing/inference visible in history.
        app.logger.exception("Image preprocessing or model inference failed")
        status = "error"
        message = f"The image could not be prepared or the configured model failed: {str(exc)[:180]}"

    connection = get_db()
    cursor = connection.execute(
        """INSERT INTO analyses
           (user_id, original_name, stored_name, created_at, status, label,
            fracture_probability, confidence, box_json, image_width, image_height,
            model_version, message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            session["user_id"],
            original_name,
            stored_name,
            utc_now(),
            status,
            label,
            fracture_probability,
            confidence,
            json.dumps(box) if box is not None else None,
            width,
            height,
            model_version,
            message,
        ),
    )
    connection.commit()
    row = connection.execute("SELECT * FROM analyses WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(analysis=analysis_to_dict(row), model=model_status)


@app.get("/api/history")
@api_login_required
def history():
    rows = get_db().execute(
        "SELECT * FROM analyses WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100",
        (session["user_id"],),
    ).fetchall()
    return jsonify(analyses=[analysis_to_dict(row) for row in rows])


@app.get("/api/dashboard")
@api_login_required
def dashboard():
    connection = get_db()
    stats = connection.execute(
        """SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status = 'model_unavailable' THEN 1 ELSE 0 END) AS waiting,
             SUM(CASE WHEN review_label IS NOT NULL OR review_note IS NOT NULL THEN 1 ELSE 0 END) AS reviewed
           FROM analyses WHERE user_id = ?""",
        (session["user_id"],),
    ).fetchone()
    recent_rows = connection.execute(
        "SELECT * FROM analyses WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 6",
        (session["user_id"],),
    ).fetchall()
    return jsonify(
        stats={key: int(stats[key] or 0) for key in ("total", "completed", "waiting", "reviewed")},
        recent=[analysis_to_dict(row) for row in recent_rows],
    )


@app.get("/api/analyses/<int:analysis_id>")
@api_login_required
def get_analysis(analysis_id: int):
    row = get_owned_analysis(analysis_id)
    if not row:
        return jsonify(error="Analysis not found."), 404
    return jsonify(analysis=analysis_to_dict(row))


@app.post("/api/analyses/<int:analysis_id>/review")
@api_login_required
def save_review(analysis_id: int):
    row = get_owned_analysis(analysis_id)
    if not row:
        return jsonify(error="Analysis not found."), 404
    data = json_body()
    review_label = str(data.get("review_label", "none")).strip().lower()
    allowed = {"none", "needs_review", "agree", "disagree"}
    if review_label not in allowed:
        return jsonify(error="Choose a valid reviewer feedback option."), 400
    if review_label in {"agree", "disagree"} and row["status"] != "completed":
        return jsonify(error="Agree/disagree feedback is available only when a model result exists."), 400
    note = str(data.get("review_note", "")).strip()
    if len(note) > 2000:
        return jsonify(error="Reviewer notes must be 2,000 characters or fewer."), 400
    saved_label = None if review_label == "none" else review_label
    saved_note = note or None
    updated_at = utc_now() if (saved_label or saved_note) else None
    connection = get_db()
    connection.execute(
        "UPDATE analyses SET review_label = ?, review_note = ?, review_updated_at = ? WHERE id = ? AND user_id = ?",
        (saved_label, saved_note, updated_at, analysis_id, session["user_id"]),
    )
    connection.commit()
    updated = get_owned_analysis(analysis_id)
    return jsonify(analysis=analysis_to_dict(updated))


@app.get("/api/analyses/<int:analysis_id>/report")
@api_login_required
def printable_report(analysis_id: int):
    row = get_owned_analysis(analysis_id)
    if not row:
        return jsonify(error="Analysis not found."), 404
    return render_template("report.html", analysis=analysis_to_dict(row), generated_at=utc_now())


@app.get("/api/analyses/<int:analysis_id>/image")
@api_login_required
def get_analysis_image(analysis_id: int):
    row = get_owned_analysis(analysis_id)
    if not row:
        return jsonify(error="Analysis not found."), 404
    path = UPLOAD_DIR / row["stored_name"]
    if not path.is_file():
        return jsonify(error="The stored image is no longer available."), 404
    return send_file(path, conditional=True, max_age=0)


@app.delete("/api/analyses/<int:analysis_id>")
@api_login_required
def delete_analysis(analysis_id: int):
    row = get_owned_analysis(analysis_id)
    if not row:
        return jsonify(error="Analysis not found."), 404
    path = UPLOAD_DIR / row["stored_name"]
    get_db().execute("DELETE FROM analyses WHERE id = ?", (analysis_id,))
    get_db().commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        app.logger.warning("Could not remove uploaded image %s", path)
    return jsonify(ok=True)


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify(error="The image is larger than 10 MB. Choose a smaller file."), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
