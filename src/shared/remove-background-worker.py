from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image


DEFAULT_INPUT_SIZE = {
    "birefnet": 1024,
    "isnet": 1024,
    "u2net": 320,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Remove an image background with a local ONNX model.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--model-kind", required=True, choices=tuple(DEFAULT_INPUT_SIZE))
    return parser.parse_args()


def model_size(shape: list[object], kind: str) -> tuple[int, int]:
    fallback = DEFAULT_INPUT_SIZE[kind]
    if len(shape) != 4:
        return fallback, fallback
    height, width = shape[-2], shape[-1]
    if isinstance(height, int) and height > 0 and isinstance(width, int) and width > 0:
        return height, width
    return fallback, fallback


def prepare_input(image: Image.Image, height: int, width: int) -> np.ndarray:
    resized = image.resize((width, height), Image.Resampling.LANCZOS)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    mean = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
    array = (array - mean) / std
    return np.transpose(array, (2, 0, 1))[None, ...].astype(np.float32)


def output_mask(outputs: list[np.ndarray]) -> np.ndarray:
    if not outputs:
        raise RuntimeError("The ONNX model returned no outputs.")
    mask = np.asarray(outputs[0], dtype=np.float32).squeeze()
    while mask.ndim > 2:
        mask = mask[0]
    if mask.ndim != 2:
        raise RuntimeError(f"Unsupported model output shape: {outputs[0].shape}")
    if float(mask.min()) < 0.0 or float(mask.max()) > 1.0:
        mask = 1.0 / (1.0 + np.exp(-np.clip(mask, -30.0, 30.0)))
    low = float(mask.min())
    high = float(mask.max())
    if high - low > 1e-6:
        mask = (mask - low) / (high - low)
    return np.clip(mask * 255.0, 0.0, 255.0).astype(np.uint8)


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve(strict=True)
    model_path = Path(args.model).resolve(strict=True)
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(input_path) as opened:
        image = opened.convert("RGB")

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    model_input = session.get_inputs()[0]
    height, width = model_size(model_input.shape, args.model_kind)
    tensor = prepare_input(image, height, width)
    mask = output_mask(session.run(None, {model_input.name: tensor}))
    alpha = Image.fromarray(mask, mode="L").resize(image.size, Image.Resampling.LANCZOS)
    rgba = image.convert("RGBA")
    rgba.putalpha(alpha)
    rgba.save(output_path, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
