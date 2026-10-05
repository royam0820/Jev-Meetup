"""Generate the extension icons (rounded square + broom-ish glyph)."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

HERE = Path(__file__).parent
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

def font(size):
    for f in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()

for size in (16, 32, 48, 128):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = max(2, size // 5)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=(225, 29, 72, 255))
    f = font(int(size * 0.62))
    text = "T"
    bbox = d.textbbox((0, 0), text, font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=f, fill="white")
    # diagonal "blocked" stroke
    lw = max(1, size // 10)
    d.line((size * 0.2, size * 0.8, size * 0.8, size * 0.2), fill=(255, 255, 255, 230), width=lw)
    img.save(HERE / f"icon{size}.png")
    print("wrote", f"icon{size}.png")
