#!/usr/bin/env python3
"""Compose the Nubbi ad (vertical 1080x1920 + horizontal 1920x1080) from the real recording.
usage: python3 compose.py [--only v|h] [--from T --to T] [--preview DIR]"""
import json, math, os, subprocess, sys, argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, os.path.dirname(__file__))
from edl import *

HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(HERE, SRC)
ap = argparse.ArgumentParser(); ap.add_argument('--only'); ap.add_argument('--from', dest='t0', type=float, default=0); ap.add_argument('--to', dest='t1', type=float, default=DUR)
ap.add_argument('--preview'); ap.add_argument('--times')
A = ap.parse_args()

ST = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', REC + '/raw.mkv']).decode())
MK = {}
for l in open(REC + '/markers.jsonl'):
    m = json.loads(l); MK.setdefault(m['name'], m['t'] / 1000 - ST)
cur = np.loadtxt(REC + '/cursor.log'); cur[:, 0] -= ST
CT, CX, CY, CB = cur[:, 0], cur[:, 1] / 2, cur[:, 2] / 2, cur[:, 3]
press = [CT[i] for i in range(1, len(CT)) if CB[i] == 1 and CB[i - 1] == 0]
release = [CT[i] for i in range(1, len(CT)) if CB[i] == 0 and CB[i - 1] == 1]
def cursor_at(s):
    return float(np.interp(s, CT, CX)), float(np.interp(s, CT, CY)), int(CB[max(0, np.searchsorted(CT, s) - 1)])
# drag (second attempt) press/release
DRAG_P = min(p for p in press if p > MK['drag2']); DRAG_R = min(r for r in release if r > DRAG_P)
SW, SH = 2880, 2160

# ---------------------------------------------------------------- source reader
class Reader:
    def __init__(self, start):
        self.p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-ss', '%.3f' % max(0, start - 1), '-i', REC + '/raw.mkv', '-vf', 'fps=30', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                  stdout=subprocess.PIPE, bufsize=SW * SH * 3)
        self.base = max(0, start - 1); self.n = -1; self.buf = None
        # -ss on input with mkv: output frame 0 is at ~base (keyframes every 250 with ultrafast; accurate seek decodes)
    def get(self, s):
        idx = int(round((s - self.base) * FPS))
        while self.n < idx:
            b = self.p.stdout.read(SW * SH * 3)
            if len(b) < SW * SH * 3: break
            self.buf = b; self.n += 1
        return Image.frombuffer('RGB', (SW, SH), self.buf, 'raw', 'RGB', 0, 1)

# ---------------------------------------------------------------- fonts / text
FONT = '/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf'
EMOJI = os.path.join(HERE, 'assets/NotoColorEmoji.ttf')
def font(px, w=900):
    f = ImageFont.truetype(FONT, int(px))
    try: f.set_variation_by_axes([32, w])
    except Exception:
        try: f.set_variation_by_axes([w])
        except Exception: pass
    return f
_emo = {}
def emoji_img(ch, px):
    k = (ch, px)
    if k not in _emo:
        ef = ImageFont.truetype(EMOJI, 109, layout_engine=ImageFont.Layout.BASIC if hasattr(ImageFont, 'Layout') else 0)
        im = Image.new('RGBA', (160, 160)); ImageDraw.Draw(im).text((10, 10), ch, font=ef, embedded_color=True)
        im = im.crop(im.getbbox()); s = px / im.height; _emo[k] = im.resize((max(1, int(im.width * s)), int(px)), Image.LANCZOS)
    return _emo[k]
def is_emoji(ch): return ord(ch) > 0x2600 and ch not in '—’'
MINT = (91, 224, 179); HL = {'mint': MINT, 'lilac': (185, 162, 255), 'peach': (255, 169, 138), 'sky': (124, 200, 255)}

def line_layout(text, px):
    f = font(px); toks = []; x = 0
    words = text.split(' ')
    for wi, w in enumerate(words):
        if wi: x += f.getlength(' ')
        if len(w) == 1 and is_emoji(w):
            im = emoji_img(w, int(px * 0.92)); toks.append(('e', w, x, im)); x += im.width
        else:
            toks.append(('t', w, x, None)); x += f.getlength(w)
    return f, toks, x

def render_caption(lines, base_px, maxw, align, hl_col):
    """returns list of RGBA line images with shadows (each line separately for staggered animation)"""
    # fit size
    s = base_px
    while True:
        if all(line_layout(t, s * k)[2] <= maxw for t, k, _ in lines) or s < 30: break
        s -= 2
    out = []
    for t, k, hl in lines:
        px = s * k; f, toks, w = line_layout(t, px)
        pad = int(px * 0.35); H = int(px * 1.32)
        im = Image.new('RGBA', (int(w) + pad * 2, H + pad * 2)); d = ImageDraw.Draw(im)
        asc = f.getmetrics()[0]
        y = pad + int(px * 0.12)
        for kind, word, x, eim in toks:
            if kind == 'e': im.alpha_composite(eim, (int(pad + x), int(y + px * 0.08)))
            else:
                col = hl_col if word.strip(',.') in [h.strip(',.') for h in hl] or word in hl else (255, 255, 255)
                d.text((pad + x, y), word, font=f, fill=col + (255,))
        # shadow
        a = im.split()[3]
        sh = Image.new('RGBA', im.size, (8, 6, 24, 0)); sh.putalpha(a.filter(ImageFilter.GaussianBlur(px * 0.09)).point(lambda v: min(255, int(v * 1.6))))
        sh2 = Image.new('RGBA', im.size, (8, 6, 24, 0)); sh2.putalpha(a.filter(ImageFilter.GaussianBlur(px * 0.35)).point(lambda v: int(v * 0.55)))
        c = Image.new('RGBA', im.size); c.alpha_composite(sh2, (0, int(px * 0.06))); c.alpha_composite(sh, (0, int(px * 0.04))); c.alpha_composite(im)
        out.append((c, pad, px))
    return out

def ease_out_back(x, k=1.7):
    x = min(1, max(0, x)); x -= 1; return 1 + (k + 1) * x ** 3 + k * x ** 2
def ease_out(x): x = min(1, max(0, x)); return 1 - (1 - x) ** 3
def ease_io(x): x = min(1, max(0, x)); return x * x * (3 - 2 * x)

# ---------------------------------------------------------------- cursor sprite (macOS-style arrow, drawn here)
def cursor_sprite(scale):
    S = 8; pts = [(0, 0), (0, 16.6), (3.9, 12.9), (6.4, 18.9), (8.9, 17.9), (6.4, 12.0), (11.7, 12.0)]
    pad = 4; W = int((14 + pad * 2) * scale * S / 1), int((21 + pad * 2) * scale * S)
    im = Image.new('RGBA', W); d = ImageDraw.Draw(im)
    P = [((x + pad) * scale * S, (y + pad) * scale * S) for x, y in pts]
    sh = Image.new('RGBA', W); ImageDraw.Draw(sh).polygon([(x + 0.8 * scale * S, y + 1.4 * scale * S) for x, y in P], fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(1.6 * scale * S))
    im.alpha_composite(sh)
    d.polygon(P, fill=(255, 255, 255, 255))
    # inner black arrow (inset ~1.25 units)
    cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    ins = [(2.0 * 0 + 1.25, 1.9 + 1.25), ]
    inner = [(1.25, 3.05), (1.25, 13.6), (4.25, 10.9), (6.9, 17.2), (8.1, 16.7), (5.5, 10.75), (8.9, 10.75)]
    d.polygon([((x + pad) * scale * S, (y + pad) * scale * S) for x, y in inner], fill=(0, 0, 0, 255))
    im = im.resize((W[0] // S, W[1] // S), Image.LANCZOS)
    return im, int(pad * scale), int(pad * scale)

# ---------------------------------------------------------------- layouts
class Layout:
    def __init__(self, kind):
        self.kind = kind
        if kind == 'v':
            self.W, self.H = 1080, 1920; self.vw, self.vh = 1080, 1800; self.base_w = 648.0; self.ar = 1080 / 648 * 1.0
        else:
            self.W, self.H = 1920, 1080; self.vw, self.vh = 1920, 1080; self.base_w = 1440.0
        self.cache = {}
        self.cursor = {}
    def cam(self, t):
        i = seg_at(t); s = SEGS[i]; g = s[4]
        z = s[5] if self.kind == 'v' else s[6]
        if i and SEGS[i - 1][4] == g:  # same group: ease zoom from previous segment
            zp = SEGS[i - 1][5] if self.kind == 'v' else SEGS[i - 1][6]
            z = zp + (z - zp) * ease_io((t - s[2]) / 0.6)
        ga, gb = GROUP_SPAN[g]
        z *= 1 + 0.025 * (t - ga) / (gb - ga)  # slow push-in
        # punch at cuts
        for c in cut_times() + [0.0]:
            if c <= t < c + 0.3: z *= 1 + 0.07 * (1 - ease_out((t - c) / 0.3))
        w = self.base_w / z; h = w * self.vh / self.vw
        cx = 720.0
        if g == 9: y0 = (1080 - h) / 2 if self.kind == 'v' else 135 + (810 - h) / 2
        else: y0 = 0.0
        if self.kind == 'v' and g == 9: y0 = max(0, min(1080 - h, 40 + (1080 - h) / 2))
        return cx - w / 2, y0, w, h
    def frame(self, src_img, t, s):
        x0, y0, w, h = self.cam(t)
        sc = self.vw / w
        box = (x0 * 2, y0 * 2, (x0 + w) * 2, min(SH, (y0 + h) * 2))
        im = src_img.resize((self.vw, int(round((box[3] - box[1]) / 2 * sc))), Image.BICUBIC, box=box).convert('RGBA')
        canvas = Image.new('RGBA', (self.W, self.H))
        canvas.paste(im, (0, 0))
        if im.height < self.H:  # stretch bottom rows (smooth wallpaper) to fill
            strip = im.crop((0, im.height - 40, im.width, im.height)).resize((im.width, self.H - im.height + 40), Image.BICUBIC)
            canvas.paste(strip, (0, im.height - 40))
        to = lambda X, Y: ((X - x0) * sc, (Y - y0) * sc)
        # PDF drag ghost
        if DRAG_P + 0.05 < s < DRAG_R + 0.02:
            cxd, cyd, _ = cursor_at(s)
            g = self.ghost(sc); gx, gy = to(cxd, cyd)
            canvas.alpha_composite(g, (int(gx - g.width * 0.5), int(gy - g.height * 0.42)))
        # click ripples
        for p in press:
            if p <= s < p + 0.38:
                k = (s - p) / 0.38; cxp, cyp, _ = cursor_at(p); px, py = to(cxp, cyp)
                r = (5 + 22 * ease_out(k)) * sc; a = int(150 * (1 - k))
                ov = Image.new('RGBA', canvas.size); d = ImageDraw.Draw(ov)
                d.ellipse([px - r, py - r, px + r, py + r], outline=(255, 255, 255, a), width=max(2, int(2.2 * sc)))
                d.ellipse([px - r * 0.6, py - r * 0.6, px + r * 0.6, py + r * 0.6], fill=(255, 255, 255, a // 4))
                canvas.alpha_composite(ov)
        # cursor
        cxs, cys, b = cursor_at(s)
        k = round(sc * 1.25, 2)
        if k not in self.cursor: self.cursor[k] = cursor_sprite(k)
        spr, ox, oy = self.cursor[k]
        if b: spr = spr.resize((int(spr.width * 0.93), int(spr.height * 0.93)), Image.LANCZOS)
        px, py = to(cxs, cys)
        if -50 < px < self.W + 50 and -50 < py < self.H + 50: canvas.alpha_composite(spr, (int(px - ox), int(py - oy)))
        return canvas
    def ghost(self, sc):
        k = round(sc, 2)
        if ('g', k) not in self.cache:
            r = Reader(DRAG_P - 0.6); src = r.get(DRAG_P - 0.6); r.p.kill()
            d = src.crop((760 * 2, 174 * 2, 820 * 2, 248 * 2)).convert('RGBA')
            d = d.resize((int(60 * sc), int(74 * sc)), Image.LANCZOS)
            a = Image.new('L', d.size, 150); d.putalpha(a)
            self.cache[('g', k)] = d
        return self.cache[('g', k)]
    # captions
    def caption_imgs(self, g, hlname='mint'):
        key = ('cap', g, hlname)
        if key not in self.cache:
            lines = CAPS[g]
            if self.kind == 'v': self.cache[key] = render_caption(lines, 96, 860, 'left', HL[hlname])
            else: self.cache[key] = render_caption(CAPS_H[g], 76, 1640, 'center', HL[hlname])
        return self.cache[key]
    def captions(self, canvas, t, s):
        g = SEGS[seg_at(t)][4]
        if g not in CAPS: return
        ga, gb = GROUP_SPAN[g]
        hl = 'mint'
        if g == 7:
            hl = 'lilac' if s < MK['color_peach'] + 0.1 else 'peach' if s < MK['color_sky'] + 0.1 else 'sky'
        imgs = self.caption_imgs(g, hl)
        lt = t - ga - 0.06
        out_k = ease_io((t - (gb - 0.14)) / 0.14) if t > gb - 0.14 else 0
        if self.kind == 'v':
            total = sum(int(px * 1.08) for _, _, px in imgs); y = 1300 - total / 2; x = 64
        else:
            total = sum(int(px * 1.06) for _, _, px in imgs); y = 1080 - 56 - total
        if self.kind == 'h':  # dark band for legibility
            band = self.cache.get('band')
            if band is None:
                band = Image.new('RGBA', (self.W, self.H)); a = np.zeros((self.H, self.W), np.uint8)
                for yy in range(self.H - 420, self.H): a[yy, :] = int(232 * min(1, (yy - (self.H - 420)) / 230) ** 1.6)
                band.putalpha(Image.fromarray(a)); self.cache['band'] = band
            canvas.alpha_composite(band)
        else:
            band = self.cache.get('band')
            if band is None:
                band = Image.new('RGBA', (self.W, self.H)); a = np.zeros((self.H, self.W), np.uint8)
                for yy in range(1060, self.H):
                    v = 1 - abs(yy - 1300) / 420 if yy < 1720 else 0.0
                    a[yy, :] = int(120 * max(0, v) ** 1.2)
                band.putalpha(Image.fromarray(a)); self.cache['band'] = band
            canvas.alpha_composite(band)
        for i, (im, pad, px) in enumerate(imgs):
            k = lt - i * 0.09
            if k <= 0: y += int(px * (1.08 if self.kind == 'v' else 1.06)); continue
            e = ease_out_back(k / 0.32); a = min(1, k / 0.16) * (1 - out_k)
            sc = 0.86 + 0.14 * e
            im2 = im if abs(sc - 1) < 0.004 else im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.BILINEAR)
            if a < 0.999:
                al = im2.split()[3].point(lambda v: int(v * a)); im2 = im2.copy(); im2.putalpha(al)
            dy = (1 - e) * px * 0.35 - out_k * px * 0.2
            if self.kind == 'v': X = x - pad + (im.width - im2.width) * 0.0
            else: X = (self.W - im2.width) / 2
            Y = y - pad + dy + (im.height - im2.height) / 2
            canvas.alpha_composite(im2, (int(X), int(Y)))
            y += int(px * (1.08 if self.kind == 'v' else 1.06))

def main():
    lays = [Layout(k) for k in (['v', 'h'] if not A.only else [A.only])]
    times = [float(x) for x in A.times.split(',')] if A.times else None
    if times is None:
        n0, n1 = int(round(A.t0 * FPS)), int(round(A.t1 * FPS)); tl = [n / FPS for n in range(n0, n1)]
    else: tl = times
    encs = {}
    if not A.preview:
        for L in lays:
            out = os.path.join(HERE, 'out', 'master-%s.mkv' % ('vertical' if L.kind == 'v' else 'horizontal'))
            encs[L.kind] = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (L.W, L.H), '-r', str(FPS), '-i', '-',
                                             '-c:v', 'libx264', '-preset', 'slow', '-crf', '11', '-pix_fmt', 'yuv420p', '-tune', 'animation', out], stdin=subprocess.PIPE)
    rd = None; last_seg = None
    for fi, t in enumerate(tl):
        s = src_time(t)
        if rd is None or s < (rd.base + rd.n / FPS) - 0.02 or s > rd.base + rd.n / FPS + 6:
            if rd: rd.p.kill()
            rd = Reader(s)
        src = rd.get(s)
        for L in lays:
            c = L.frame(src, t, s); L.captions(c, t, s)
            if A.preview: c.convert('RGB').save(os.path.join(A.preview, '%s_%05.2f.png' % (L.kind, t)))
            else: encs[L.kind].stdin.write(c.convert('RGB').tobytes())
        if fi % 30 == 0: print('t=%.1f src=%.2f' % (t, s), flush=True)
    for e in encs.values(): e.stdin.close(); e.wait()
    if rd: rd.p.kill()

if __name__ == '__main__': main()
