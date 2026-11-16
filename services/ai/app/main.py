# FastAPI web service: takes a leaf photo and returns the likely plant disease.
import io
import json
import os
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image, ImageOps

from .treatments import crop_name, severity_for, symptoms_for, treatment_for

# Where the model files live
SERVICE_ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = Path(os.getenv("MODELS_DIR", SERVICE_ROOT / "models"))


# Picks which model file to load (MODEL_PATH env, or the first one found)
def _resolve_model_path() -> Path:
    explicit = os.getenv("MODEL_PATH")
    if explicit:
        return Path(explicit)

    # Prefer the EfficientNet model, then older demo model names
    for candidate in (
        MODELS_DIR / "plant_disease_efficientnet.keras",
        MODELS_DIR / "plant_disease_model.keras",
        MODELS_DIR / "plant_disease_model.h5",
    ):
        if candidate.exists():
            return candidate
    return MODELS_DIR / "plant_disease_efficientnet.keras"


# Reads class_names.txt lines like "0: Apple___healthy" into a list
def _parse_class_names(path: Path) -> list[str]:
    class_names: dict[int, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if ":" not in line:
            continue
        idx, name = line.split(":", 1)
        class_names[int(idx.strip())] = name.strip()
    return [class_names[i] for i in sorted(class_names)]


# Loads the class labels; skips files whose count doesn't match the model
def _load_labels(expected_count: int | None = None) -> list[str]:
    explicit = os.getenv("LABELS_PATH")
    paths = [
        Path(explicit) if explicit else None,
        MODELS_DIR / "class_names.txt",
        MODELS_DIR / "labels.json",
    ]

    for path in [p for p in paths if p is not None]:
        if not path.exists():
            continue
        try:
            loaded = (
                _parse_class_names(path)
                if path.suffix.lower() == ".txt"
                else json.loads(path.read_text(encoding="utf-8"))
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Could not read labels from {path}: {exc}")
            continue

        if not isinstance(loaded, list) or not all(isinstance(x, str) for x in loaded):
            print(f"Skipping {path}: labels must be a JSON/text list of class names.")
            continue
        if expected_count is not None and len(loaded) != expected_count:
            print(
                f"Skipping {path}: found {len(loaded)} labels but model outputs "
                f"{expected_count} classes."
            )
            continue
        return loaded

    return []


# Model settings (can be changed with environment variables)
MODEL_PATH = _resolve_model_path()
IMAGE_SIZE = int(os.getenv("IMAGE_SIZE", "224"))
USE_EFFICIENTNET_PREPROCESS = os.getenv(
    "USE_EFFICIENTNET_PREPROCESS",
    "1" if "efficientnet" in MODEL_PATH.name.lower() else "0",
) == "1"

# The web app, plus the loaded model and labels (None/empty = use mock answers)
app = FastAPI(title="SmartAgri Plant Disease Detection", version="1.0.0")
model = None
labels: list[str] = []


# Loads the model and labels once when the service starts
@app.on_event("startup")
def load_artifacts():
    global model, labels
    if not MODEL_PATH.exists():
        print(f"Model not found at {MODEL_PATH}; using mock fallback.")
        return

    # If TensorFlow or the model fails to load, fall back to mock answers
    try:
        import tensorflow as tf

        # compile=False: only predicting, and it avoids old .h5 loading errors
        loaded_model = tf.keras.models.load_model(MODEL_PATH, compile=False)

        # Auto-match preprocessing to the model's expected input size.
        global IMAGE_SIZE
        in_shape = loaded_model.input_shape  # e.g. (None, 224, 224, 3)
        if len(in_shape) == 4 and in_shape[1]:
            IMAGE_SIZE = int(in_shape[1])

        out_units = int(loaded_model.output_shape[-1])
        loaded_labels = _load_labels(out_units)
        if not loaded_labels:
            print(f"Could not find {out_units} matching labels. Using mock fallback.")
            return

        model = loaded_model
        labels = loaded_labels
        print(
            f"Loaded model {MODEL_PATH}: input {IMAGE_SIZE}px, {out_units} classes, "
            f"{len(labels)} labels, efficientnet_preprocess={USE_EFFICIENTNET_PREPROCESS}."
        )
        if out_units != len(labels):
            print(
                f"WARNING: model outputs {out_units} classes but labels has "
                f"{len(labels)}. Fix model labels so indices line up."
            )
    except Exception as exc:  # noqa: BLE001
        model = None
        labels = []
        print(f"Could not load TensorFlow model ({exc}). Using mock fallback.")


# Logs a warning when the real model isn't loaded
def ensure_ready():
    if model is None or not labels:
        print("Warning: Model artifacts not found. Using fail-safe mock fallback for predictions.")


# ---- Preprocessing: several views of each photo, results averaged ----


# Makes 6 views of the photo (padded, centre, zoomed, and their mirrors)
def _views(image_bytes: bytes) -> list:
    image = Image.open(io.BytesIO(image_bytes))
    image = ImageOps.exif_transpose(image).convert("RGB")  # phone photos: apply rotation
    size = (IMAGE_SIZE, IMAGE_SIZE)
    w, h = image.size
    side = min(w, h)
    # A closer crop around the centre (the leaf is usually in the middle).
    zoom = int(side * 0.8)
    left, top = (w - zoom) // 2, (h - zoom) // 2
    base = [
        ImageOps.pad(image, size, color=(128, 128, 128)),  # whole photo, no stretching
        ImageOps.fit(image, size),  # centre square
        image.crop((left, top, left + zoom, top + zoom)).resize(size),  # closer
    ]
    return base + [ImageOps.mirror(view) for view in base]


# Turns the photo views into a number array the model can read
def preprocess_image(image_bytes: bytes):
    import numpy as np
    import tensorflow as tf

    arrays = [tf.keras.utils.img_to_array(view) for view in _views(image_bytes)]
    batch = np.stack(arrays, axis=0)
    if USE_EFFICIENTNET_PREPROCESS:
        from tensorflow.keras.applications.efficientnet import preprocess_input

        batch = preprocess_input(batch)
    return batch


# Short crop name from a label, e.g. 'Corn_(maize)___Common_rust_' -> 'corn'
def crop_key(label: str) -> str:
    head = label.split("___")[0].lower()
    for sep in ("_(", ",", "("):
        head = head.split(sep)[0]
    return head.strip("_ ")


# Readable disease name, e.g. "Late Blight" or "Healthy tomato"
def pretty(label: str) -> str:
    name = label.split("___")[-1].replace("_", " ").strip()
    crop = crop_name(label).split(" (")[0].split(",")[0]
    return f"Healthy {crop.lower()}" if name.lower() == "healthy" else name.title()


# Below these limits the answer is marked "unsure"
UNSURE_BELOW = float(os.getenv("UNSURE_BELOW", "0.55"))
UNSURE_MARGIN = float(os.getenv("UNSURE_MARGIN", "0.15"))
# Unsure if the photo barely looks like the pot's known crop
CROP_MATCH_MIN = float(os.getenv("CROP_MATCH_MIN", "0.35"))


# Health check: says whether the real model is loaded
@app.get("/health")
def health():
    return {
        "status": "ready" if model is not None and labels else "missing_model",
        "modelPath": str(MODEL_PATH),
        "labels": len(labels),
        "imageSize": IMAGE_SIZE,
        "efficientnetPreprocess": USE_EFFICIENTNET_PREPROCESS,
    }


# Optional secret: if set, /predict needs a matching "x-ai-token" header
AI_SERVICE_TOKEN = os.getenv("AI_SERVICE_TOKEN", "")


# Main endpoint: upload a leaf photo, get the disease, confidence and treatment
@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    # Optional crop (e.g. "tomato"): only that crop's diseases are considered
    crop: str | None = Form(default=None),
    x_ai_token: str | None = Header(default=None),
):
    # Safety checks: token, file type and empty upload
    if AI_SERVICE_TOKEN and x_ai_token != AI_SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Missing or invalid AI service token.")
    ensure_ready()
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload must be an image file.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    global model, labels
    if model is None or not labels:
        # No model: return a fixed Tomato Late Blight demo answer
        label = "Tomato___Late_blight"
        confidence = 0.942
        treatment = treatment_for(label)
        recommendation = " ".join(treatment["immediate"] + treatment["prevention"])
        return {
            "disease": label.split("___")[-1].replace("_", " ").title(),
            "crop": crop_name(label),
            "className": label,
            "confidence": round(confidence, 4),
            "severity": severity_for(label, confidence),
            "symptoms": symptoms_for(label),
            "treatment": treatment,
            "recommendation": recommendation,
            "modelVersion": "MockModelFallback",
        }

    try:
        batch = preprocess_image(image_bytes)
        raw = model.predict(batch, verbose=0)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not process image: {exc}") from exc

    import numpy as np

    probs = np.asarray(raw, dtype="float64").mean(axis=0)  # average of the views
    probs = probs / probs.sum()
    looked_like = crop_key(labels[int(np.argmax(probs))])

    # Keep only this crop's classes, when the crop is one the model knows
    wanted = (crop or "").strip().lower()
    allowed = [i for i, name in enumerate(labels) if crop_key(name) == wanted] if wanted else []
    # Don't limit to a crop with only one class (it would always win)
    if len(allowed) < 2:
        allowed = []
    # Share of belief on this crop (low = photo doesn't look like this plant)
    crop_match = float(probs[allowed].sum()) if allowed else None
    if allowed:
        mask = np.zeros_like(probs)
        mask[allowed] = 1.0
        probs = probs * mask
        probs = probs / probs.sum() if probs.sum() > 0 else mask / mask.sum()

    # Rank classes: best guess first, runner-up second
    order = [int(i) for i in np.argsort(probs)[::-1] if probs[i] > 0]
    class_index = order[0]
    confidence = float(probs[class_index])
    runner_up = float(probs[order[1]]) if len(order) > 1 else 0.0
    label = labels[class_index]
    treatment = treatment_for(label)
    recommendation = " ".join(treatment["immediate"] + treatment["prevention"])

    return {
        "disease": label.split("___")[-1].replace("_", " ").title(),
        "crop": crop_name(label),
        "className": label,
        "confidence": round(confidence, 4),
        "severity": severity_for(label, confidence),
        "symptoms": symptoms_for(label),
        "treatment": treatment,
        "recommendation": recommendation,
        "modelVersion": MODEL_PATH.name,
        # Extra detail for the report.
        "alternatives": [
            {"disease": pretty(labels[i]), "className": labels[i], "confidence": round(float(probs[i]), 4)}
            for i in order[1:4]
            if probs[i] >= 0.05
        ],
        "uncertain": confidence < UNSURE_BELOW
        or (confidence - runner_up) < UNSURE_MARGIN
        or (crop_match is not None and crop_match < CROP_MATCH_MIN),
        "cropMatch": round(crop_match, 4) if crop_match is not None else None,
        "restrictedTo": wanted if allowed else None,
        "lookedLike": looked_like,
        "views": int(len(raw)),
    }
