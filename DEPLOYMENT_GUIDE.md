# BoneAI: local run, feature roadmap, and deployment

## 1. Run BoneAI on your computer

Unzip `BoneAI-project.zip`, open a terminal in the `BoneAI` folder (the folder containing `app.py`), then follow the instructions for your operating system.

### Windows PowerShell

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

If PowerShell blocks environment activation, run this once in that terminal and activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000** or **http://localhost:5000**, create an account, and try the upload flow. Stop the server with **Ctrl+C**. By default, SQLite and uploaded images are created in `instance/` next to the app. That folder is ignored by Git.

If port 5000 is busy, set another port before starting:

```powershell
# Windows PowerShell
$env:PORT = "5001"
python app.py
```

```bash
# macOS / Linux
PORT=5001 python app.py
```

Then open `http://localhost:5001`.

### Current AI status

The web workflow is functional, but the project package does **not** contain trained fracture-detection weights or an X-ray dataset. Without a compatible model, BoneAI validates, preprocesses, stores and lists uploads, then clearly says that inference is unavailable. Connect and validate your own model using the `BONEAI_MODEL_PATH` and `BONEAI_BACKEND` settings described in `README.md` before expecting classification/localization output.

## 2. Add features in a sensible order

A large-looking site is most convincing when its features are useful, consistent and backed by a real workflow. Build in stages rather than adding many disconnected pages.

### Included demo features (implemented in this ZIP)

- **Dashboard overview:** real totals, completed runs, uploads awaiting model weights, reviewer flags, and latest activity.
- **History tools:** filename search, status filters, and 8-row client-side pagination over the latest 100 records.
- **Reports:** private printable report page with browser **Print / Save PDF**, plus a downloadable text report.
- **Reviewer annotations:** status and notes saved separately from model predictions; agree/disagree is disabled until a model result exists.
- **Project pages:** objectives, scope/modules, requirements, references, FAQ and privacy guidance.

### Good next additions

1. Add date-range filters, multi-select report export, and a contact/feedback form.
2. Add measured validation metrics and model-version records after training a suitable model.
3. Improve accessibility testing and optionally add English/Marathi/Hindi translations.

### Stage B — real model and localization

1. Select an appropriately licensed dataset and document its label quality, class balance, body regions, and limitations.
2. Train and evaluate a model on patient-separated train/validation/test sets. Keep a held-out test set untouched until final evaluation.
3. For localization, use ground-truth bounding boxes or segmentation labels and a detection/localization model. Do not draw a box from a classification score alone.
4. Record the model version, input size, preprocessing, class order, threshold, and evaluation date with every result.
5. Display clinically relevant metrics (for example sensitivity, specificity, precision/recall, AUROC and localization overlap) only when actually measured on suitable data. Never promise 100% accuracy.

### Stage C — more production-like workflow

- **DICOM support:** add `pydicom`, inspect/strip identifying metadata where appropriate, and make sure the chosen model supports the DICOM pixel representation. Do this only after a privacy review.
- **Roles and permissions:** researcher, reviewer and administrator roles; email verification, account recovery, and role-based access controls.
- **Asynchronous inference:** move slow model jobs to Celery/RQ with Redis, then show queued/running/completed/failed states. The current route processes inference synchronously.
- **Database and file storage:** replace SQLite/local uploads with PostgreSQL and private encrypted object storage (such as a private S3-compatible bucket). Add migrations, backups and retention policies.
- **Audit and operations:** audit logs, rate limits, request-size limits, error monitoring, backups, health checks, and deployment alerts.
- **API:** document a versioned API (for example `/api/v1/...`) for integrating another application; protect it with authentication and rate limiting.

## 3. Deploy a demo to Render (one example)

Render, Railway, Fly.io and a Linux VPS all follow a similar pattern. These steps describe a simple Render web-service deployment; dashboard labels can change over time.

### Prepare the project

1. Create a private GitHub repository and push the project files. Do **not** commit `.env`, `instance/`, patient images, datasets, or large model files. The included `.gitignore` excludes these paths.
2. The project includes a `Procfile` and `gunicorn` in `requirements.txt` for Linux hosting.
3. Create a long random secret locally with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Keep the value private. Do not use the example development key in a public deployment.

### Create the web service

1. In Render, choose **New → Web Service** and connect the GitHub repository.
2. Use a supported Python runtime (Python 3.11 or 3.12 is a practical choice when you later add ML libraries).
3. Set the build command to:

```text
pip install -r requirements.txt
```

4. Set the start command to:

```text
gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 180 app:app
```

5. Set the health-check path to:

```text
/api/health
```

6. Add environment variables in the host dashboard:

```text
BONEAI_ENV=production
BONEAI_SECRET_KEY=<your-long-random-secret>
BONEAI_HTTPS=1
```

Leave model variables unset for a UI/upload demo, or configure `BONEAI_MODEL_PATH`, `BONEAI_BACKEND`, `BONEAI_INPUT_SIZE`, `BONEAI_CHANNELS`, and `BONEAI_THRESHOLD` after you have tested a compatible model.

7. Deploy, open the HTTPS URL provided by the host, create an account, and test sign-up, sign-in, upload, history, deletion and report download. The status endpoint is `https://your-domain/api/health`.

### Important persistence note

The current prototype stores its database and images under `instance/`. Many web hosts use **ephemeral** filesystems: files may disappear on restart or redeploy. For a short-lived UI demonstration, that may be acceptable if you use non-sensitive test images. For persistence, either attach a durable disk and set `BONEAI_INSTANCE_DIR` to its mounted path, or upgrade the code to use PostgreSQL for records and private object storage for images. A durable disk is a small-demo bridge, not the best design for a high-traffic service.

The current app uses SQLite and synchronous inference, so it is suited to a student prototype or low-volume demo, not a large concurrent service. For higher traffic, use PostgreSQL, object storage, a job queue and a separate model-serving worker/service. GPU model inference may require a host that explicitly provides compatible GPU hardware; ordinary web-service instances usually do not provide CUDA.

## 4. Privacy and safety before public use

- Use synthetic, public, or properly de-identified images for a school demonstration. Avoid identifiable patient data.
- This prototype is not a medical device and is not ready for clinical use. Do not use output to make care decisions.
- Before handling real medical images, complete a privacy/security review, use HTTPS, restrict access, encrypt stored data, define deletion/retention rules, audit access, and confirm applicable institutional and legal requirements.
- Accuracy depends on dataset composition, image quality, model validation and real-world generalization. **No website can guarantee 100% diagnostic accuracy.**
