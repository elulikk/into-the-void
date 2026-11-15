# Genera icon.ico (planeta con anillo sobre fondo espacial) en varios tamaños.
import math
import random
import sys
from PIL import Image, ImageDraw, ImageFilter

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# fondo redondeado
d.rounded_rectangle((8, 8, S - 8, S - 8), radius=110, fill=(8, 14, 30, 255))
random.seed(4)
for _ in range(90):
    x, y = random.randint(40, S - 40), random.randint(40, S - 40)
    r = random.choice([1, 1, 2, 2, 3])
    b = random.randint(140, 255)
    d.ellipse((x - r, y - r, x + r, y + r), fill=(b, b, 255, 255))

cx, cy, R = S / 2, S / 2, 150

def ring(draw, front):
    # elipse inclinada del anillo, dividida en mitad trasera / delantera
    pts = []
    for k in range(361):
        a = math.radians(k)
        x, y = math.cos(a) * 235, math.sin(a) * 62
        t = math.radians(-22)
        pts.append((cx + x * math.cos(t) - y * math.sin(t), cy + x * math.sin(t) + y * math.cos(t), a))
    for w, col in ((26, (200, 170, 120, 255)), (12, (240, 222, 180, 255))):
        seg = [(x, y) for x, y, a in pts if (math.sin(a) > 0) == front]
        draw.line(seg, fill=col, width=w, joint="curve")

layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ring(ImageDraw.Draw(layer), front=False)
img.alpha_composite(layer)

# planeta con bandas y sombreado
planet = Image.new("RGBA", (S, S), (0, 0, 0, 0))
pd = ImageDraw.Draw(planet)
bands = [(235, 205, 150), (210, 160, 105), (240, 225, 190), (190, 135, 90), (230, 200, 150), (205, 165, 115)]
for i in range(int(cy - R), int(cy + R)):
    c = bands[int((i - (cy - R)) / (2 * R) * 9) % len(bands)]
    pd.line((0, i, S, i), fill=c + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).ellipse((cx - R, cy - R, cx + R, cy + R), fill=255)
shade = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shade)
for k in range(60):
    off = k * 3.2
    sd.ellipse((cx - R + off + 60, cy - R + off + 40, cx + R + off + 60, cy + R + off + 40), fill=(5, 8, 20, 6))
planet.alpha_composite(shade)
planet.putalpha(mask)
img.alpha_composite(planet)

layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ring(ImageDraw.Draw(layer), front=True)
img.alpha_composite(layer)

out = sys.argv[1] if len(sys.argv) > 1 else "icon.ico"
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.save(out.replace(".ico", ".png"))
print("ok", out)
