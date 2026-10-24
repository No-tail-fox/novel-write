"""Place the selected source and actual Electron captures on shared QA canvases.

Evidence only: no artwork is generated or modified in the product bundle.
Run with the project's bundled Python (Pillow).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "implementation-evidence"
OUT = EVIDENCE / "comparisons"
FONT = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 22)
SMALL = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 17)
OUT.mkdir(exist_ok=True)


def open_rgb(path):
    with Image.open(path) as image:
        return image.convert("RGB")


def pair(name, source_box=None, actual_box=None):
    source = open_rgb(ROOT / "concepts/process-outline/design.png")
    actual = open_rgb(EVIDENCE / "desktop-dark-final.png")
    if source_box:
        source = source.crop(source_box)
    if actual_box:
        actual = actual.crop(actual_box)
    padding, heading, gap = 20, 58, 24
    canvas = Image.new(
        "RGB",
        (source.width + actual.width + padding * 2 + gap,
         max(source.height, actual.height) + heading + padding),
        "#e5e7eb",
    )
    draw = ImageDraw.Draw(canvas)
    draw.text((padding, 16), "Selected option 3 / source", font=FONT, fill="#111827")
    draw.text((padding + source.width + gap, 16), "Actual Electron / Phase A", font=FONT, fill="#111827")
    canvas.paste(source, (padding, heading))
    canvas.paste(actual, (padding + source.width + gap, heading))
    canvas.save(OUT / name)


def contact(name, files, max_width=1040, columns=2):
    padding, heading, gap = 20, 48, 20
    images = []
    for label, path in files:
        image = open_rgb(path)
        if image.width > max_width:
            image = image.resize(
                (max_width, round(image.height * max_width / image.width)),
                Image.Resampling.LANCZOS,
            )
        images.append((label, image))
    width = max(image.width for _, image in images)
    height = max(image.height for _, image in images)
    rows = (len(images) + columns - 1) // columns
    canvas = Image.new(
        "RGB",
        (padding * 2 + columns * width + (columns - 1) * gap,
         padding * 2 + rows * (height + heading) + (rows - 1) * gap),
        "#e5e7eb",
    )
    draw = ImageDraw.Draw(canvas)
    for index, (label, image) in enumerate(images):
        x = padding + (index % columns) * (width + gap)
        y = padding + (index // columns) * (height + heading + gap)
        draw.text((x, y + 7), label, font=SMALL, fill="#111827")
        canvas.paste(image, (x, y + heading))
    canvas.save(OUT / name)


pair("01-full-view.png")
pair("02-outline.png", (0, 60, 349, 715), (0, 60, 300, 715))
pair("03-preview.png", (377, 75, 1510, 642), (318, 75, 1505, 642))
pair("04-inline-content.png", (377, 653, 1510, 890), (318, 653, 1505, 890))
pair("05-fixed-footer.png", (0, 910, 1536, 1024), (0, 910, 1536, 1024))
contact("06-compact-themes.png", [
    (f"{theme} / 1040 x 720", EVIDENCE / f"compact-{theme}-final.png")
    for theme in ("dark", "light")
])
contact("07-narrow-drawers.png", [
    (f"{theme} / {state} / 860 x 720", EVIDENCE / f"narrow-{state}-{theme}.png")
    for theme in ("dark", "light")
    for state in ("outline", "advanced")
], max_width=860)
contact("08-template-and-zoom.png", [
    ("Nested template dialog", EVIDENCE / "desktop-template.png"),
    ("200% actual Electron zoom / CSS 768 x 512", EVIDENCE / "desktop-200-percent.png"),
    ("Advanced settings scrolled to bottom", EVIDENCE / "desktop-advanced-bottom.png"),
    ("200% advanced drawer", EVIDENCE / "desktop-200-percent-advanced.png"),
])
contact("09-comic-regression.png", [
    (f"Comic / {theme} / {width}", EVIDENCE / "comic-regression" / f"{theme}-{width}.png")
    for theme in ("dark", "light")
    for width in (1536, 1040)
])
contact("10-desktop-themes.png", [
    (f"{theme} / 1536 x 1024", EVIDENCE / f"desktop-{theme}-final.png")
    for theme in ("dark", "light")
])
print(f"Saved 10 comparison canvases to {OUT}")
