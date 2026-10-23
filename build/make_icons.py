# Original artwork for Nubbi icons (not the upstream assets).
from PIL import Image, ImageDraw, ImageFilter
import math, os
HERE = os.path.dirname(os.path.abspath(__file__)); ASSETS = os.path.join(HERE, '..', 'src', 'assets')
os.makedirs(ASSETS, exist_ok=True)

def squircle(cx, cy, a, b, n=3.4, steps=400):
    pts = []
    for i in range(steps):
        t = i / steps * 2 * math.pi; c, s = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / n), c), cy + b * math.copysign(abs(s) ** (2 / n), s)))
    return pts

def app_icon(S=1024):
    k = 2; W = S * k
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    # macOS-style squircle tile, deep night gradient
    tile = Image.new('RGBA', (W, W), (0, 0, 0, 0)); m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).polygon(squircle(W / 2, W / 2, W * 0.41, W * 0.41, 5), fill=255)
    grad = Image.new('RGBA', (W, W))
    gd = ImageDraw.Draw(grad)
    for y in range(W):
        t = y / W
        gd.line([(0, y), (W, y)], fill=(int(28 + 10 * t), int(26 + 6 * t), int(44 + 20 * t), 255))
    tile.paste(grad, (0, 0), m)
    # notch pill at top of tile
    nl = Image.new('RGBA', (W, W), (0, 0, 0, 0)); nd = ImageDraw.Draw(nl)
    nw, nh = W * 0.30, W * 0.075
    nd.rounded_rectangle([W / 2 - nw / 2, W * 0.0, W / 2 + nw / 2, W * 0.09 + nh], radius=nh * 0.6, fill=(0, 0, 0, 255))
    tile = Image.alpha_composite(tile, Image.composite(nl, Image.new('RGBA', (W, W), (0, 0, 0, 0)), m))
    # pink glow
    glow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W * .22, W * .3, W * .78, W * .86], fill=(255, 140, 190, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.07))
    tile = Image.alpha_composite(tile, Image.composite(glow, Image.new('RGBA', (W, W), (0, 0, 0, 0)), m))
    # nubbi body
    body = Image.new('RGBA', (W, W), (0, 0, 0, 0)); bm = Image.new('L', (W, W), 0)
    cx, cy, a, b = W / 2, W * 0.58, W * 0.27, W * 0.215
    ImageDraw.Draw(bm).polygon(squircle(cx, cy, a, b), fill=255)
    shade = Image.new('RGBA', (W, W)); sd = ImageDraw.Draw(shade)
    for i in range(60, 0, -1):
        r = i / 60
        col = (int(215 + 40 * (1 - r)), int(214 + 41 * (1 - r)), int(224 + 31 * (1 - r)), 255)
        sd.ellipse([cx - a * 1.3 * r - a * .2, cy - b * 1.4 * r - b * .35, cx + a * 1.3 * r - a * .2, cy + b * 1.4 * r - b * .35], fill=col)
    body.paste(shade, (0, 0), bm)
    sh = Image.new('RGBA', (W, W), (0, 0, 0, 0)); ImageDraw.Draw(sh).polygon(squircle(cx, cy + W * .025, a, b), fill=(0, 0, 0, 130))
    sh = sh.filter(ImageFilter.GaussianBlur(W * 0.02))
    tile = Image.alpha_composite(tile, sh); tile = Image.alpha_composite(tile, body)
    d = ImageDraw.Draw(tile)
    # cheeks
    ch = Image.new('RGBA', (W, W), (0, 0, 0, 0)); cd = ImageDraw.Draw(ch)
    for sx in (-1, 1):
        x = cx + sx * a * 0.62; y = cy + b * 0.28
        cd.ellipse([x - a * .2, y - b * .16, x + a * .2, y + b * .16], fill=(255, 150, 175, 200))
    tile = Image.alpha_composite(tile, ch.filter(ImageFilter.GaussianBlur(W * 0.012)))
    d = ImageDraw.Draw(tile)
    for sx in (-1, 1):
        x = cx + sx * a * 0.28; y = cy + b * 0.02
        d.ellipse([x - a * .095, y - b * .17, x + a * .095, y + b * .17], fill=(18, 18, 22, 255))
        d.ellipse([x - a * .06, y - b * .12, x - a * .01, y - b * .05], fill=(255, 255, 255, 150))
    d.arc([cx - a * .1, cy + b * .14, cx + a * .1, cy + b * .34], 20, 160, fill=(18, 18, 22, 255), width=int(W * .009))
    d.ellipse([cx - a * .55, cy - b * .78, cx - a * .1, cy - b * .55], fill=(255, 255, 255, 170))
    return tile.resize((S, S), Image.LANCZOS)

def tray(S, template=True):
    k = 8; W = S * k
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    col = (0, 0, 0, 255) if template else (255, 255, 255, 255)
    cx, cy, a, b = W / 2, W * 0.54, W * 0.44, W * 0.35
    d.polygon(squircle(cx, cy, a, b), fill=col)
    for sx in (-1, 1):  # eyes are cut out
        x = cx + sx * a * 0.3
        d.ellipse([x - W * .052, cy - W * .09, x + W * .052, cy + W * .06], fill=(0, 0, 0, 0))
    return img.resize((S, S), Image.LANCZOS)

app_icon().save(os.path.join(HERE, 'icon.png'))
app_icon(512).save(os.path.join(ASSETS, 'icon.png'))
tray(18).save(os.path.join(ASSETS, 'trayTemplate.png')); tray(36).save(os.path.join(ASSETS, 'trayTemplate@2x.png'))
tray(22, False).save(os.path.join(ASSETS, 'tray.png')); tray(44, False).save(os.path.join(ASSETS, 'tray@2x.png'))
print('icons ok')
