#!/usr/bin/env python3
"""تولید آیکون اپ (build/icon.png) بدون وابستگی به ابزارهای گرافیکی خارجی."""

import os
from PIL import Image, ImageDraw

SIZE = 512
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# پس‌زمینه گرادیانی با گوشه‌های گرد
top = (79, 140, 255)
bottom = (109, 74, 226)
grad = Image.new("RGB", (SIZE, SIZE))
gd = ImageDraw.Draw(grad)
for y in range(SIZE):
    t = y / (SIZE - 1)
    gd.line(
        [(0, y), (SIZE, y)],
        fill=(
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        ),
    )
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=112, fill=255)
img.paste(grad, (0, 0), mask)

# رومیزی: سطح میز + آویز پارچه
cloth = (247, 238, 220, 255)
cloth_dark = (223, 209, 183, 255)
draw.rounded_rectangle([128, 176, 384, 246], radius=22, fill=cloth)
draw.polygon(
    [(128, 236), (384, 236), (424, 392), (88, 392)],
    fill=cloth_dark,
)
draw.polygon([(128, 236), (384, 236), (400, 300), (112, 300)], fill=cloth)

# خطوط چین پارچه
for x in (168, 256, 344):
    draw.line([(x, 302), (x - 16 if x < 256 else x + 16, 386)], fill=(201, 186, 158, 255), width=6)

# بشقاب
draw.ellipse([206, 190, 306, 262], fill=(255, 255, 255, 255), outline=(224, 213, 192, 255), width=5)
draw.ellipse([232, 204, 280, 248], fill=(240, 232, 216, 255))

# فنجان
draw.rounded_rectangle([318, 168, 366, 224], radius=12, fill=(255, 255, 255, 255))
draw.arc([356, 180, 392, 214], start=270, end=90, fill=(255, 255, 255, 255), width=8)

os.makedirs(OUT, exist_ok=True)
img.save(os.path.join(OUT, "icon.png"))
img.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "icon-256.png"))
print("icons written to", OUT)
