import sys, subprocess; sys.argv = ['cover']
from compose import render_caption
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np
subprocess.check_call(['ffmpeg', '-y', '-v', 'error', '-ss', '16.4', '-i', 'out/master-vertical.mkv', '-frames:v', '1', '/tmp/cov_bg.png'])
bg = Image.open('/tmp/cov_bg.png').convert('RGBA')
W, H = bg.size
# dark bottom: gradient into a deep indigo
ov = Image.new('RGBA', (W, H)); a = np.zeros((H, W), np.uint8)
for y in range(H):
    v = 0 if y < 900 else min(1, (y - 900) / 200) ** 1.2; a[y] = int(255 * v)
ov.paste((14, 10, 38, 255), (0, 0, W, H)); ov.putalpha(Image.fromarray(a)); bg.alpha_composite(ov)
# soft glow behind text
gl = Image.new('RGBA', (W, H)); ImageDraw.Draw(gl).ellipse((-200, 1180, 900, 1900), fill=(91, 224, 179, 40)); bg.alpha_composite(gl.filter(ImageFilter.GaussianBlur(120)))
lines = render_caption([("Meet Nubbi 👋", 1.3, ["Nubbi"]), ("your AI buddy that", 0.86, []), ("lives in your notch", 0.86, ["notch"])], 108, 950, 'left', (91, 224, 179))
y = 1230
for im, pad, px in lines:
    bg.alpha_composite(im, (64 - pad, int(y - pad))); y += int(px * 1.18)
# pill
f = ImageFont.truetype('/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf', 46)
try: f.set_variation_by_axes([32, 800])
except Exception: pass
txt = "Free for Mac  ·  Link in bio"; tw = ImageDraw.Draw(bg).textlength(txt, font=f)
px0, py0 = 64, y + 40; d = ImageDraw.Draw(bg)
d.rounded_rectangle((px0, py0, px0 + tw + 70, py0 + 92), 46, fill=(91, 224, 179, 255))
d.text((px0 + 35, py0 + 18), txt, font=f, fill=(14, 10, 38, 255))
bg.convert('RGB').save('nubbi-ad-cover.png', optimize=True)
print(bg.size, y)
