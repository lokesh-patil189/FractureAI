# BoneAI — X-ray fracture screening prototype

A responsive Flask web application inspired by the supplied BoneAI reference. It includes account creation/sign-in, a PNG/JPEG upload flow, preprocessing, a metrics dashboard, searchable/filterable history, separate reviewer notes, printable reports, and privacy/FAQ content.

## Important accuracy and safety note

**No system can guarantee 100% accuracy.** This project is an educational/final-year prototype and is not a medical device. It must not be used to make treatment decisions or replace a radiologist/doctor. Results from any model need independent validation on representative, correctly labelled data and professional review.

The workspace contains the working app, **not pretrained fracture-detection weights or a medical dataset**. With no trained model configured, the app still validates, stores and preprocesses uploads, but it explicitly reports that AI inference is unavailable rather than making up a fracture result. The interface is ready for a trained model adapter.

## Recommended system requirements

- **Operating system:** Windows 10/11 or Linux.
- **Processor/RAM:** Intel Core i5/i7 or equivalent; 16 GB RAM recommended.
- **GPU:** NVIDIA CUDA-capable GPU is optional and depends on model/runtime support.
- **Storage:** 20 GB or more recommended for datasets, model weights and uploaded images.
- **Software:** Python 3.10+, Flask, HTML/CSS/JavaScript; TensorFlow/Keras or PyTorch for the optional AI runtime.

## Run locally

Python 3.10+ is recommended.

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>. Create an account from the sign-up dialog. Images and the SQLite database are stored in `instance/` (excluded from source control in a normal deployment).

For a stable secret key, export `BONEAI_SECRET_KEY` before running. Do not deploy the development server as a public production service; use HTTPS, a production WSGI server, access controls, retention rules, and a privacy/security review before handling real patient data. See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for Windows/macOS/Linux local-run steps, a Render deployment example, and a staged feature roadmap.

## Connect a trained model

The model bridge supports Keras and TorchScript. Install the matching optional runtime, then set environment variables:

```bash
# Example for a Keras SavedModel or .keras model
export BONEAI_BACKEND=keras
export BONEAI_MODEL_PATH=models/fracture_model.keras
export BONEAI_INPUT_SIZE=224
export BONEAI_CHANNELS=1
export BONEAI_FRACTURE_INDEX=1
export BONEAI_THRESHOLD=0.5
python app.py
```

On Windows PowerShell, use `$env:BONEAI_BACKEND = "keras"` and equivalent assignments. `BONEAI_MODEL_PATH` may point at a Keras model file or SavedModel directory, or a TorchScript `.pt` file when `BONEAI_BACKEND=torchscript`.

### Model contract

- Input is resized to `BONEAI_INPUT_SIZE` square pixels, converted to grayscale by default (`BONEAI_CHANNELS=1`, or RGB for `3`) and scaled to `[0, 1]`. Training preprocessing must match.
- A classification model may return a scalar `P(fracture)` or a two-class probability/logit vector ordered `[normal, fracture]` by default. Change `BONEAI_FRACTURE_INDEX` if your class order differs.
- Optional localization should be returned as normalized `[x1, y1, x2, y2]` coordinates in `[0, 1]`.
- Keras can return a dict like `{"fracture_probability": score, "box": [x1, y1, x2, y2]}` or a tuple/list `(class_output, box_output)`. A TorchScript model should return the same structure or a tensor containing class scores. For models that return classification only, the app says localization is unavailable; it does not draw a fabricated box.
- The app uses the configured threshold to display **“Suspected fracture”** versus **“No fracture detected”**. These are screening labels, not a diagnosis.

Model output shapes differ across research code. If your model does not follow this contract, update `model_adapter.py` to match its input/output signature and test with a held-out set before using the interface.

## Project structure

```text
app.py                 Flask routes, validation, SQLite accounts/history
model_adapter.py       Optional Keras/TorchScript inference bridge
templates/index.html    Public landing page, dashboard, upload, history and FAQ/privacy
templates/report.html   Private printable review report (browser Save as PDF)
static/styles.css      Responsive application styling
static/app.js          Upload, auth, dashboard, filters, feedback, reports and navigation
requirements.txt       Base dependencies + Gunicorn for Linux deployment
Procfile               Production web-server command
DEPLOYMENT_GUIDE.md    Local run, feature roadmap, deployment and safety notes
instance/              Local database and uploaded images (created at runtime)
```

## Included modules

1. **User module:** email/password registration, password hashing and session-based sign-in.
2. **Image preprocessing module:** file-type/size/dimension validation, EXIF orientation correction, safe re-encoding, grayscale model input and normalization.
3. **Fracture detection module:** optional Keras/TorchScript model bridge with explicit status when weights are absent.
4. **Review/history module:** per-account records, search/status filters, client-side pagination, deletion and separate human reviewer notes.
5. **Reporting module:** private printable report (browser print or Save as PDF) and downloadable text report.
6. **Dashboard/public pages:** metrics, recent activity, project scope, FAQ and privacy guidance.
7. **Responsive UI:** landing, upload, analysis, results and history across desktop and mobile layouts.

## Suggested validation before a real model demo

Use a properly licensed dataset with patient-level train/validation/test separation; document class balance and source; evaluate sensitivity, specificity, precision, recall, AUROC, calibration, and localization overlap where bounding-box labels exist. Test external/generalization data and obtain supervisor/clinical review. Accuracy alone is not enough for medical screening.

## References

1. [TensorFlow/Keras documentation](https://www.tensorflow.org/guide/keras)
2. [PyTorch documentation](https://pytorch.org/docs/stable/index.html)
3. [OpenCV documentation](https://docs.opencv.org/)
4. [Kaggle datasets](https://www.kaggle.com/datasets) — verify dataset licensing and annotation quality before use.
5. [Research literature on deep learning for bone-fracture detection using X-rays](https://scholar.google.com/scholar?q=deep+learning+bone+fracture+detection+x-ray) — cite the specific paper and dataset used in your final report.
