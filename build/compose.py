# Composite raw transparent captures onto a mock macOS desktop (2x, notched MacBook).
import json, os, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'screens', 'raw'); OUT = os.path.join(ROOT, 'screens')
FONT = '/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf'
def font(px, w=500):
    f = ImageFont.truetype(FONT, px)
    try: f.set_variation_by_axes([14, w])
    except Exception:
        try: f.set_variation_by_axes([w])
        except Exception: pass
    return f
K = 2; SW, SH = 1512, 982  # MacBook Air 15"-ish points
W, H = SW * K, SH * K
NW, NH = 185, 37

def wallpaper():
    img = Image.new('RGB', (W // 8, H // 8))
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            u, v = x / img.width, y / img.height
            r = 34 + 70 * (1 - v) * u + 40 * math.sin(u * 3 + v * 2) ** 2 * v
            g = 26 + 30 * v + 20 * (1 - u) * v
            b = 70 + 90 * (1 - v) + 40 * u * v
            px[x, y] = (int(r), int(g), int(b))
    img = img.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(30))
    # soft glow blobs
    gl = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(gl)
    d.ellipse([W * .55, H * .15, W * 1.05, H * .85], fill=(255, 120, 170, 70))
    d.ellipse([-W * .2, H * .45, W * .45, H * 1.2], fill=(90, 140, 255, 70))
    gl = gl.filter(ImageFilter.GaussianBlur(160))
    return Image.alpha_composite(img.convert('RGBA'), gl)

def terminal(img):
    # a blurred-ish mock terminal window for context
    x0, y0, w, h = 210 * K, 300 * K, 600 * K, 300 * K
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + 20, x0 + w, y0 + h + 30], 24, fill=(0, 0, 0, 120))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(40)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], 22, fill=(24, 24, 30, 245), outline=(255, 255, 255, 30), width=2)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse([x0 + 26 + i * 40, y0 + 24, x0 + 50 + i * 40, y0 + 48], fill=c)
    f = font(13 * K, 450); fm = ImageFont.truetype('/usr/share/fonts/truetype/sand-box/google/JetBrains_Mono/JetBrainsMono-VariableFont_wght.ttf', 13 * K) if os.path.exists('/usr/share/fonts/truetype/sand-box/google/JetBrains_Mono/JetBrainsMono-VariableFont_wght.ttf') else f
    d.text((x0 + w / 2, y0 + 36), 'korus — claude — 120×40', font=f, fill=(170, 170, 178), anchor='mm')
    lines = [('✻ Welcome to Claude Code', (215, 119, 87)), ('', None), ('> Fix the flaky checkout test', (230, 230, 235)), ('', None),
             ('⏺ Reading src/checkout.test.ts', (160, 160, 170)), ('⏺ Update(src/checkout.test.ts)', (160, 160, 170)), ('  ⎿  Updated with 3 additions', (120, 120, 130)),
             ('⏺ Bash(npm test -- checkout)', (160, 160, 170)), ('  ⎿  14 passing (2.1s)', (120, 200, 130))]
    for i, (t, c) in enumerate(lines):
        if t: d.text((x0 + 34, y0 + 90 + i * 22 * K // 1.15), t, font=fm, fill=c)

def menubar(img, tray_active=False):
    bar = Image.new('RGBA', (W, NH * K), (20, 16, 34, 120)); img.alpha_composite(bar)
    d = ImageDraw.Draw(img); f = font(13 * K, 500); fb = font(13 * K, 700)
    y = NH * K // 2
    # apple logo stand-in
    d.ellipse([22 * K, y - 7 * K, 36 * K, y + 7 * K], fill=(255, 255, 255, 235)); d.ellipse([31 * K, y - 11 * K, 37 * K, y - 5 * K], fill=(20, 16, 34, 255))
    x = 56 * K
    for i, t in enumerate(['iTerm2', 'Shell', 'Edit', 'View', 'Session', 'Window', 'Help']):
        d.text((x, y), t, font=fb if i == 0 else f, fill=(255, 255, 255, 240), anchor='lm'); x += d.textlength(t, font=fb if i == 0 else f) + 20 * K
    # right side
    xr = W - 22 * K
    t = 'Fri 23 Oct  9:41'; d.text((xr, y), t, font=f, fill=(255, 255, 255, 240), anchor='rm'); xr -= d.textlength(t, font=f) + 22 * K
    # control center / wifi / battery
    d.rounded_rectangle([xr - 26 * K, y - 6 * K, xr - 2 * K, y + 6 * K], 3 * K, outline=(255, 255, 255, 230), width=K); d.rectangle([xr - 24 * K, y - 4 * K, xr - 9 * K, y + 4 * K], fill=(255, 255, 255, 230)); xr -= 44 * K
    for r in (9, 6, 3):
        d.arc([xr - r * K * 1.2, y - r * K * .9, xr + r * K * 1.2, y + r * K * 1.5], 215, 325, fill=(255, 255, 255, 230), width=int(1.8 * K))
    xr -= 34 * K
    # tray: Nubbi template icon
    tray = Image.open(os.path.join(ROOT, 'src', 'assets', 'trayTemplate@2x.png')).convert('RGBA')
    white = Image.new('RGBA', tray.size, (255, 255, 255, 255)); white.putalpha(tray.getchannel('A'))
    tx = int(xr - tray.width); ty = int(y - tray.height / 2)
    if tray_active:
        hl = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(hl).rounded_rectangle([tx - 8 * K, y - 12 * K, tx + tray.width + 8 * K, y + 12 * K], 5 * K, fill=(255, 255, 255, 50)); img.alpha_composite(hl)
    img.alpha_composite(white, (tx, ty))
    # hardware notch
    nx = (W - NW * K) // 2
    d.rounded_rectangle([nx, -20 * K, nx + NW * K, NH * K], 10 * K, fill=(0, 0, 0, 255))
    return (tx + tray.width // 2, NH * K)

BASE = None
def desktop(tray_active=False):
    global BASE
    if BASE is None:
        BASE = wallpaper(); terminal(BASE)
    img = BASE.copy(); pos = menubar(img, tray_active)
    return img, pos

def crop(img, cx=None, w=1180, h=620):
    cx = W // 2 if cx is None else cx
    x0 = max(0, min(W - w * K, cx - w * K // 2)); return img.crop((x0, 0, x0 + w * K, h * K))

def island_shot(name):
    img, _ = desktop()
    cap = Image.open(os.path.join(RAW, name + '.png')).convert('RGBA')
    img.alpha_composite(cap, ((W - cap.width) // 2, 0))
    return crop(img)

def tray_shot():
    items = json.load(open(os.path.join(RAW, 'tray-items.json')))
    img, (tx, ty) = desktop(True)
    f = font(13 * K, 450); fs = font(13 * K, 400)
    rows = []
    for it in items:
        rows.append(('sep' if it['type'] == 'separator' else 'item', it))
    hgt = sum(11 * K if r[0] == 'sep' else 22 * K for r in rows) + 10 * K; wid = 260 * K
    x0 = min(tx - 18 * K, W - wid - 8 * K); y0 = ty + 6 * K
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + 10, x0 + wid, y0 + hgt + 20], 12 * K, fill=(0, 0, 0, 140))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(24)))
    reg = img.crop((x0, y0, x0 + wid, y0 + hgt)).filter(ImageFilter.GaussianBlur(30))
    panel = Image.alpha_composite(reg, Image.new('RGBA', reg.size, (40, 40, 46, 205)))
    m = Image.new('L', reg.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, wid - 1, hgt - 1], 10 * K, fill=255)
    img.paste(panel, (x0, y0), m)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, y0, x0 + wid - 1, y0 + hgt - 1], 10 * K, outline=(255, 255, 255, 40), width=K)
    y = y0 + 5 * K
    for i, (kind, it) in enumerate(rows):
        if kind == 'sep':
            d.line([x0 + 12 * K, y + 5 * K, x0 + wid - 12 * K, y + 5 * K], fill=(255, 255, 255, 40), width=K); y += 11 * K; continue
        if i == 0: d.rounded_rectangle([x0 + 5 * K, y, x0 + wid - 5 * K, y + 22 * K], 5 * K, fill=(10, 110, 230, 255))
        col = (255, 255, 255, 240) if it.get('enabled', True) else (150, 150, 158, 255)
        if it['type'] == 'checkbox' and it.get('checked'): d.text((x0 + 13 * K, y + 11 * K), '✓', font=f, fill=col, anchor='lm')
        d.text((x0 + 28 * K, y + 11 * K), it['label'], font=f, fill=col, anchor='lm')
        acc = it.get('acc') or ''
        acc = acc.replace('CommandOrControl+', '⌘').replace('Control+', '⌃').replace('Alt+', '⌥')
        if acc: d.text((x0 + wid - 14 * K, y + 11 * K), acc, font=fs, fill=(170, 170, 178, 255) if it.get('enabled', True) else (110, 110, 118, 255), anchor='rm')
        y += 22 * K
    out = crop(img, cx=W - 380 * K, w=760, h=330)
    d = ImageDraw.Draw(out); cf = font(11 * K, 500)
    d.text((14 * K, out.height - 14 * K), 'Replica of the macOS menu, drawn from the app’s real tray menu template (native menus can’t be captured on Linux).', font=cf, fill=(255, 255, 255, 170), anchor='lb')
    return out

def settings_shot(name):
    img, _ = desktop()
    cap = Image.open(os.path.join(RAW, name + '.png')).convert('RGBA')
    sx = (W - cap.width) // 2 + 120 * K; sy = 70 * K
    if cap.height + sy > H - 20 * K:  # tall capture: make a taller canvas
        big = Image.new('RGBA', (W, cap.height + sy + 60 * K)); big.alpha_composite(img.resize((W, big.height)))
        img = big
    m = Image.new('L', cap.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, cap.width - 1, cap.height - 1], 12 * K, fill=255)
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([sx, sy + 20, sx + cap.width, sy + cap.height + 30], 14 * K, fill=(0, 0, 0, 160))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(50)))
    img.paste(cap, (sx, sy), m)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([sx, sy, sx + cap.width - 1, sy + cap.height - 1], 12 * K, outline=(255, 255, 255, 40), width=K)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse([sx + 20 * K + i * 20 * K, sy + 14 * K, sx + 32 * K + i * 20 * K, sy + 26 * K], fill=c)
    return img.crop((sx - 80 * K, 0, sx + cap.width + 80 * K, sy + cap.height + 50 * K))

names = ['01-idle-notch', '02-nubbi-peek', '03-session-working', '04-permission', '05-success', '06-drop-zone', '07-upload-progress', '08-file-ready', '08b-provider-picker', '09-answer-live', '09b-no-key', '10-dizzy', '11-color-peach', '11-color-lilac', '11-color-sky']
for n in names:
    island_shot(n).convert('RGB').save(os.path.join(OUT, n + '.png'), optimize=True); print('wrote', n)
tray_shot().convert('RGB').save(os.path.join(OUT, '13-tray-menu.png'), optimize=True); print('wrote tray')
settings_shot('12-settings').convert('RGB').save(os.path.join(OUT, '12-settings.png'), optimize=True)
settings_shot('12b-settings-full').convert('RGB').save(os.path.join(OUT, '12b-settings-full.png'), optimize=True)
settings_shot('12c-settings-gemini').convert('RGB').save(os.path.join(OUT, '12c-settings-gemini.png'), optimize=True); print('wrote settings')
