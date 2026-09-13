from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / ".artifacts" / "product-design-rework" / "director-desk.png"
IMPLEMENTATION = (
    ROOT
    / ".artifacts"
    / "director-desk-qa"
    / "vox-reference-1440x1024.png"
)
OUTPUT = ROOT / ".artifacts" / "director-desk-comparison"

LABEL_HEIGHT = 34
REFERENCE_LABEL = "REFERENCE - DIRECTOR DESK"
IMPLEMENTATION_LABEL = "IMPLEMENTATION - FINAL VOX"


def comparison(
    name: str,
    box: tuple[int, int, int, int],
    implementation_path: Path = IMPLEMENTATION,
    implementation_label: str = IMPLEMENTATION_LABEL,
) -> dict[str, object]:
    with Image.open(REFERENCE) as reference_source, Image.open(implementation_path) as implementation_source:
        if reference_source.size != implementation_source.size:
            raise ValueError(
                "Comparison requires equal, uncropped source viewport dimensions: "
                f"reference={reference_source.size}, implementation={implementation_source.size}. "
                "Capture the implementation at the reference viewport; do not pad or resize it."
            )
        width, height = reference_source.size
        left, top, right, bottom = box
        if not (0 <= left < right <= width and 0 <= top < bottom <= height):
            raise ValueError(f"Crop {box} is outside the actual {width}x{height} source viewport.")
        reference = reference_source.convert("RGB").crop(box)
        implementation = implementation_source.convert("RGB").crop(box)

    canvas = Image.new(
        "RGB",
        (reference.width + implementation.width, LABEL_HEIGHT + reference.height),
        "#0d1115",
    )
    canvas.paste(reference, (0, LABEL_HEIGHT))
    canvas.paste(implementation, (reference.width, LABEL_HEIGHT))

    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=16)
    draw.rectangle((0, 0, reference.width, LABEL_HEIGHT), fill="#161a1f")
    draw.rectangle(
        (reference.width, 0, canvas.width, LABEL_HEIGHT),
        fill="#161a1f",
    )
    draw.text((12, 9), REFERENCE_LABEL, fill="#f2f4f6", font=font)
    draw.text(
        (reference.width + 12, 9),
        implementation_label,
        fill="#ff6b57",
        font=font,
    )
    draw.line(
        (reference.width, 0, reference.width, canvas.height),
        fill="#ff6b57",
        width=2,
    )
    canvas.save(OUTPUT / name, optimize=True)
    return {
        "name": name,
        "reference": str(REFERENCE),
        "implementation": str(implementation_path),
        "sourceViewport": {"width": width, "height": height},
        "crop": {"left": left, "top": top, "right": right, "bottom": bottom},
        "outputSize": {"width": canvas.width, "height": canvas.height},
        "resized": False,
        "padded": False,
    }


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    comparisons = [
        comparison("comparison-full-final-1440x1024.png", (0, 0, 1440, 1024)),
        comparison("comparison-center-preview-final.png", (282, 60, 1042, 636)),
        comparison("comparison-right-inspector-final.png", (1042, 60, 1440, 982)),
    ]
    (OUTPUT / "report.json").write_text(
        json.dumps({"state": "local-keyframe-reference", "comparisons": comparisons}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
