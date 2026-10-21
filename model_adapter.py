"""Optional model bridge for BoneAI.

The app deliberately ships without pretrained weights. Configure a model using
BONEAI_MODEL_PATH and BONEAI_BACKEND (keras or torchscript). See README.md for
the input/output contract. A missing model is reported honestly to the UI.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from PIL import Image


def _settings() -> tuple[str, str, int, int]:
    model_path = os.environ.get("BONEAI_MODEL_PATH", "").strip()
    backend = os.environ.get("BONEAI_BACKEND", "keras").strip().lower()
    input_size = int(os.environ.get("BONEAI_INPUT_SIZE", "224"))
    channels = int(os.environ.get("BONEAI_CHANNELS", "1"))
    if channels not in (1, 3):
        channels = 1
    return model_path, backend, max(32, min(input_size, 1024)), channels


def status() -> dict[str, Any]:
    model_path, backend, input_size, channels = _settings()
    if not model_path:
        return {
            "ready": False,
            "model_name": None,
            "backend": backend,
            "input_size": input_size,
            "message": "No trained model is connected yet. Upload and preprocessing work; connect validated model weights to produce predictions.",
        }

    path = Path(model_path).expanduser()
    if not path.exists():
        return {
            "ready": False,
            "model_name": path.name,
            "backend": backend,
            "input_size": input_size,
            "message": f"The configured model file was not found: {path.name}. Check BONEAI_MODEL_PATH.",
        }

    if backend == "keras":
        try:
            import tensorflow  # noqa: F401
        except ImportError:
            return {
                "ready": False,
                "model_name": path.name,
                "backend": backend,
                "input_size": input_size,
                "message": "TensorFlow is not installed. Install it to load the configured Keras model.",
            }
    elif backend in {"torch", "torchscript"}:
        try:
            import torch  # noqa: F401
        except ImportError:
            return {
                "ready": False,
                "model_name": path.name,
                "backend": backend,
                "input_size": input_size,
                "message": "PyTorch is not installed. Install it to load the configured TorchScript model.",
            }
    else:
        return {
            "ready": False,
            "model_name": path.name,
            "backend": backend,
            "input_size": input_size,
            "message": "Unsupported model backend. Set BONEAI_BACKEND to keras or torchscript.",
        }

    return {
        "ready": True,
        "model_name": path.name,
        "backend": backend,
        "input_size": input_size,
        "channels": channels,
        "message": "Trained model weights are connected.",
    }


def preprocess(image: Image.Image):
    """Resize, grayscale/RGB convert, and normalize an image for model input."""
    import numpy as np

    _path, _backend, input_size, channels = _settings()
    if channels == 1:
        resized = image.convert("L").resize((input_size, input_size), Image.Resampling.BILINEAR)
        array = np.asarray(resized, dtype="float32")[..., None]
    else:
        resized = image.convert("RGB").resize((input_size, input_size), Image.Resampling.BILINEAR)
        array = np.asarray(resized, dtype="float32")
    # Training and inference preprocessing must match. The default contract is [0, 1].
    return array / 255.0


def _numpy(value):
    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    elif hasattr(value, "numpy"):
        value = value.numpy()
    return value


def _one_probability(value, fracture_index: int = 1) -> float:
    import numpy as np

    arr = np.asarray(_numpy(value), dtype="float32").reshape(-1)
    if arr.size == 0:
        raise ValueError("Model returned an empty classification output.")
    if arr.size == 1:
        probability = float(arr[0])
    else:
        idx = max(0, min(fracture_index, arr.size - 1))
        probability = float(arr[idx])
        # If the head returns logits rather than probabilities, normalize them.
        if (arr < 0).any() or (arr > 1).any() or abs(float(arr.sum()) - 1.0) > 0.08:
            shifted = arr - float(arr.max())
            exps = np.exp(shifted)
            probability = float(exps[idx] / exps.sum())
    if probability < 0.0 or probability > 1.0:
        probability = 1.0 / (1.0 + __import__("math").exp(-max(-40.0, min(40.0, probability))))
    return max(0.0, min(1.0, probability))


def _normalize_box(value):
    import numpy as np

    if value is None:
        return None
    arr = np.asarray(_numpy(value), dtype="float32").reshape(-1)
    if arr.size < 4:
        return None
    x1, y1, x2, y2 = [float(v) for v in arr[:4]]
    # The adapter contract expects normalized [x1, y1, x2, y2] coordinates.
    x1, y1, x2, y2 = [max(0.0, min(1.0, v)) for v in (x1, y1, x2, y2)]
    if x2 <= x1 or y2 <= y1:
        return None
    return [round(x1, 5), round(y1, 5), round(x2, 5), round(y2, 5)]


def _unpack_output(output: Any) -> tuple[float, list[float] | None]:
    fracture_index = int(os.environ.get("BONEAI_FRACTURE_INDEX", "1"))
    probability_output = output
    box_output = None

    if isinstance(output, dict):
        if "fracture_probability" in output:
            probability_output = output["fracture_probability"]
        elif "probability" in output:
            probability_output = output["probability"]
        elif "class_probs" in output:
            probability_output = output["class_probs"]
        elif "probabilities" in output:
            probability_output = output["probabilities"]
        if "box" in output:
            box_output = output["box"]
        elif "bbox" in output:
            box_output = output["bbox"]
        elif "localization" in output:
            box_output = output["localization"]
    elif isinstance(output, (tuple, list)):
        if len(output) >= 2:
            probability_output = output[0]
            box_output = output[1]
        elif len(output) == 1:
            probability_output = output[0]

    probability = _one_probability(probability_output, fracture_index)
    return probability, _normalize_box(box_output)


def _load_model(path: str, backend: str):
    if backend == "keras":
        import tensorflow as tf

        return tf.keras.models.load_model(path, compile=False)
    import torch

    model = torch.jit.load(path, map_location="cpu")
    model.eval()
    return model


_CACHED_MODEL = None
_CACHED_KEY = None


def _get_model(path: str, backend: str):
    global _CACHED_MODEL, _CACHED_KEY
    file_path = Path(path).expanduser()
    try:
        modified = file_path.stat().st_mtime_ns
    except OSError:
        modified = 0
    key = (str(file_path.resolve()), backend, modified)
    if _CACHED_MODEL is None or _CACHED_KEY != key:
        _CACHED_MODEL = _load_model(str(file_path), backend)
        _CACHED_KEY = key
    return _CACHED_MODEL


def predict(image: Image.Image, prepared=None) -> dict[str, Any]:
    model_status = status()
    if not model_status.get("ready"):
        raise RuntimeError(model_status.get("message", "Model is not ready."))

    import numpy as np

    model_path, backend, input_size, channels = _settings()
    model = _get_model(model_path, backend)
    array = prepared if prepared is not None else preprocess(image)

    if backend == "keras":
        output = model.predict(np.expand_dims(array, axis=0), verbose=0)
    else:
        import torch

        tensor = torch.from_numpy(np.expand_dims(array, axis=0)).float()
        if channels == 1:
            tensor = tensor.permute(0, 3, 1, 2)
        else:
            tensor = tensor.permute(0, 3, 1, 2)
        with torch.no_grad():
            output = model(tensor)

    probability, box = _unpack_output(output)
    return {
        "fracture_probability": probability,
        "box": box,
        "model_version": Path(model_path).name,
        "input_size": input_size,
    }
