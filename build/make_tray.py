# Tray icons for Nubbi (original): gumdrop silhouette + antenna sparkle, eyes cut out. Template = black+alpha (macOS tints it).
from PIL import Image, ImageDraw
import os
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'assets')
def draw(px, col):
    k = 8; W = px * k; im = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(im); u = W / 22
    d.chord([3 * u, 6.5 * u, 19 * u, 26 * u], 180, 360, fill=col)               # dome
    d.rounded_rectangle([3 * u, 15.5 * u, 19 * u, 19.5 * u], radius=2 * u, fill=col)  # base
    d.line([(11 * u, 7 * u), (11.6 * u, 4.6 * u), (13 * u, 3.2 * u)], fill=col, width=int(1.3 * u))
    cx, cy, r = 14.2 * u, 2.6 * u, 2.2 * u
    d.polygon([(cx, cy - r), (cx + r * .3, cy - r * .3), (cx + r, cy), (cx + r * .3, cy + r * .3), (cx, cy + r), (cx - r * .3, cy + r * .3), (cx - r, cy), (cx - r * .3, cy - r * .3)], fill=col)
    for ex in (8 * u, 14 * u): d.ellipse([ex - 1.3 * u, 12 * u - 1.3 * u, ex + 1.3 * u, 12 * u + 1.3 * u], fill=(0, 0, 0, 0))
    return im.resize((px, px), Image.LANCZOS)
for sfx, px in (('', 22), ('@2x', 44)):
    draw(px, (0, 0, 0, 255)).save(os.path.join(A, f'trayTemplate{sfx}.png'))
    draw(px, (126, 230, 190, 255)).save(os.path.join(A, f'tray{sfx}.png'))
print('ok')
