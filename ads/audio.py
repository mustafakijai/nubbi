#!/usr/bin/env python3
"""Original soundtrack + re-synthesized Nubbi UI sounds for the ad, mapped through the EDL.
Everything here is synthesized from scratch (numpy/scipy) — no samples, no third-party assets."""
import json, os, subprocess
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile
from edl import *

SR = 48000; N = int(SR * DUR); HERE = os.path.dirname(os.path.abspath(__file__)); REC = os.path.join(HERE, SRC)
rng = np.random.default_rng(7)
def T(d): return np.arange(int(SR * d)) / SR
def add(buf, t, x, g=1.0):
    i = int(round(t * SR))
    if i >= len(buf) or i + len(x) <= 0: return
    if i < 0: x = x[-i:]; i = 0
    n = min(len(x), len(buf) - i); buf[i:i + n] += g * x[:n]
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def expsweep(f0, f1, d):
    t = T(d); f = f0 * (f1 / f0) ** (t / d); return 2 * np.pi * np.cumsum(f) / SR
def env(d, a=0.004, k=None):
    t = T(d); e = np.minimum(1, t / a) if a else np.ones_like(t)
    return e * np.exp(-t / (k or d / 5))
def saw(f, d, ph=0.0):
    t = T(d); return 2 * ((t * f + ph) % 1) - 1
def tri(ph): return 2 / np.pi * np.arcsin(np.sin(ph))
def noise(d): return rng.uniform(-1, 1, int(SR * d))

# ------------------------------------------------------------------ UI sounds (after src/notch/sounds.js)
def s_plop():
    a = np.sin(expsweep(620, 170, .16)) * env(.16, .004, .045) * .6
    b = np.sin(expsweep(1250, 900, .05)) * env(.05, .002, .015) * .12
    out = np.zeros(int(SR * .2)); out[:len(a)] += a; out[:len(b)] += b; return out
def s_zip():
    d = .24; n = noise(d); t = T(d); out = np.zeros_like(n)
    # sweeping band: process in chunks
    for k in range(12):
        sl = slice(int(k * len(n) / 12), int((k + 1) * len(n) / 12)); fc = 700 * (5200 / 700) ** (k / 11)
        out[sl] = bp(n, fc * .7, min(fc * 1.4, 20000))[sl]
    out *= np.sin(np.pi * t / d) ** .8 * .35
    for k in range(9):
        c = np.sign(np.sin(2 * np.pi * 2400 * T(.006))) * env(.006, 0, .002) * .06; add(out, k * d / 9, c)
    return out
def s_chime():
    d = .9; t = T(d)
    x = tri(2 * np.pi * 1318.5 * t) * .3 + np.sin(2 * np.pi * 1975.5 * t) * .12 + np.sin(2 * np.pi * 2637 * t) * .06
    return x * env(d, .005, .22)
def s_success():
    out = np.zeros(int(SR * .7))
    for i, f in enumerate([1046.5, 1318.5, 1568, 2093]):
        t = T(.3); add(out, i * .065, (np.sin(2 * np.pi * f * t) + .25 * tri(2 * np.pi * f * 2 * t)) * env(.3, .003, .08) * .22)
    return out
def s_boop(): return np.sin(expsweep(900, 480, .12)) * env(.12, .003, .04) * .4
def s_bonk():
    d = .3; x = tri(expsweep(210, 70, d)) * .55 + np.sign(np.sin(expsweep(210, 70, d))) * .08
    x = x * env(d, .002, .07); x[:int(SR * .03)] += lp(noise(.03), 2500) * env(.03, 0, .008) * .4; return x
def s_whoosh(d=.35, f0=280, f1=2600, g=.3):
    n = noise(d); out = np.zeros_like(n); t = T(d)
    for k in range(10):
        sl = slice(int(k * len(n) / 10), int((k + 1) * len(n) / 10)); fc = f0 * (f1 / f0) ** (k / 9)
        out[sl] = bp(n, fc * .6, min(fc * 1.6, 20000))[sl]
    return out * np.sin(np.pi * t / d) ** 1.5 * g
def s_tick(): return np.sin(2 * np.pi * 1400 * T(.03)) * env(.03, .001, .008) * .25
def s_click(): return (hp(noise(.012), 2500) * .5 + np.sin(2 * np.pi * 3200 * T(.012)) * .3) * env(.012, 0, .003) * .35
def s_key(): return hp(noise(.02), 1800) * env(.02, 0, .004) * (.12 + .06 * rng.random())
UI = dict(plop=s_plop, zip=s_zip, chime=s_chime, success=s_success, boop=s_boop, bonk=s_bonk, whoosh=s_whoosh, tick=s_tick)

# ------------------------------------------------------------------ music: 120 BPM, F#m – D – A – E
BEAT = .5; NOTE = lambda m: 440 * 2 ** ((m - 69) / 12)
PROG = [(42, [54, 57, 61]), (38, [50, 54, 57]), (45, [57, 61, 64]), (40, [52, 56, 59])]  # (bass midi, triad)
def chord_at(t): return PROG[int(t // 2) % 4]
DROP, BRK0, BRK1, END = 3.0, 31.0, 34.0, 38.0
kick = np.zeros(N); drums = np.zeros(N); bass = np.zeros(N); stabs = np.zeros(N); arp = np.zeros(N); fx = np.zeros(N)

def k_kick():
    d = .4; t = T(d); f = 44 + 106 * np.exp(-t / .03); ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * env(d, .001, .12) * .95; c = int(SR * .006); x[:c] += hp(noise(.006), 3000) * .2; return x
def k_hat(o=False): d = .18 if o else .05; return hp(noise(d), 7500) * env(d, .001, d / 4) * (.16 if o else .12)
def k_clap():
    out = np.zeros(int(SR * .25)); n = bp(noise(.25), 900, 3200)
    for i, o in enumerate([0, .011, .022]): add(out, o, n[:int(SR * .25) - int(o * SR)] * env(.25 - o, .001, .012 if i < 2 else .07) * .45)
    return out
def supersaw(midis, d, cut, g):
    t = T(d); x = np.zeros_like(t)
    for m in midis:
        for k, det in enumerate([-.19, -.11, -.04, 0, .04, .11, .19]):
            x += saw(NOTE(m) * 2 ** (det / 12), d, ph=rng.random()) / 7
    return lp(x, cut, 2) * g

kick_times = []
b = 0
while b * BEAT < END:
    t = b * BEAT
    full = DROP <= t < BRK0
    if full or (t >= BRK1 and t < BRK1 + .01):
        add(kick, t, k_kick()); kick_times.append(t)
    if full:
        add(drums, t + .25, k_hat(o=(b % 2 == 1)))
        if b % 2 == 1: add(drums, t, k_clap())
        root, tri3 = chord_at(t)
        for e in (0, .25):  # 8th-note offbeat-ish bass
            add(bass, t + e, lp(saw(NOTE(root), .22) * .7 + np.sin(2 * np.pi * NOTE(root - 12) * T(.22)) * .5, 900) * env(.22, .004, .12) * .55)
        if b % 4 in (0, 1) and (b % 8 != 1):  # syncopated stabs
            add(stabs, t + (.0 if b % 4 == 0 else .25), supersaw(tri3 + [tri3[0] + 12], .2, 3800 if t >= 18 else 2600, .32) * env(.2, .003, .07))
    if t < DROP:  # intro: hats building + snare roll
        if t >= 1.0: add(drums, t + .25, k_hat() * .8)
    b += 1
# snare/clap roll into the drop
for i in range(16):
    tt = 2.0 + i * (1.0 / 16); add(drums, tt, k_clap() * (.25 + .6 * i / 15))
# risers
def riser(t0, t1, g=.35):
    d = t1 - t0; n = noise(d); x = np.zeros_like(n)
    for k in range(24):
        sl = slice(int(k * len(n) / 24), int((k + 1) * len(n) / 24)); fc = 400 * (9000 / 400) ** (k / 23)
        x[sl] = bp(n, fc * .7, min(fc * 1.4, 20000))[sl]
    x *= (T(d) / d) ** 2 * g; add(fx, t0, x)
riser(0.0, DROP, .5); riser(BRK0 + 1.0, BRK1, .45)
# pluck arp (16ths) everywhere, quieter in intro/outro
s16 = 0
while s16 * BEAT / 4 < END - .1:
    t = s16 * BEAT / 4; root, tri3 = chord_at(t)
    seq = [tri3[0] + 12, tri3[1] + 12, tri3[2] + 12, tri3[1] + 24, tri3[2] + 12, tri3[0] + 24, tri3[1] + 12, tri3[2] + 12]
    m = seq[s16 % 8]; d = .16; tt = T(d)
    x = (np.sign(np.sin(2 * np.pi * NOTE(m) * tt)) * .3 + tri(2 * np.pi * NOTE(m) * tt) * .7) * env(d, .002, .045)
    g = .14 if DROP <= t < BRK0 else (.1 if t < DROP else .12)
    if t >= BRK1 + 1.0: g *= max(0, 1 - (t - BRK1 - 1.0) / 2.5)
    add(arp, t, lp(x, 5000) * g); s16 += 1
# breakdown pad + end hit
for t0 in (BRK0, BRK0 + 2):
    r, tri3 = chord_at(t0); d = 2.0 if t0 == BRK0 else 1.0
    add(stabs, t0, supersaw(tri3, d, 1800, .28) * np.minimum(1, T(d) / .15))
r, tri3 = PROG[0]
add(stabs, BRK1, supersaw(tri3 + [tri3[0] + 12, tri3[0] - 12], 4.0, 4200, .42) * env(4.0, .003, 1.2))
add(bass, BRK1, np.sin(2 * np.pi * NOTE(30) * T(3.5)) * env(3.5, .004, 1.0) * .6)
add(fx, BRK1, hp(noise(2.5), 5000) * env(2.5, .001, .6) * .25)  # crash
# sidechain
sc = np.ones(N); tt = np.arange(N) / SR
for k in kick_times:
    i0 = int(k * SR); n = min(int(SR * .45), N - i0); sc[i0:i0 + n] = np.minimum(sc[i0:i0 + n], 1 - .65 * np.exp(-np.arange(n) / SR / .11))
music = kick * .9 + drums + (bass + stabs + arp) * sc + fx
music = hp(music, 28)

# ------------------------------------------------------------------ UI layer from the real recording
ST = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', REC + '/raw.mkv']).decode())
ui = np.zeros(N); events = []
for l in open(REC + '/e2e.log'):
    if '"snd"' not in l: continue
    try: m = json.loads(l)
    except Exception: continue
    o = out_time(m['t'] / 1000 - ST)
    if o is not None: events.append((o, m['snd']))
cur = np.loadtxt(REC + '/cursor.log'); cur[:, 0] -= ST
presses = [cur[i, 0] for i in range(1, len(cur)) if cur[i, 3] == 1 and cur[i - 1, 3] == 0]
for p in presses:
    o = out_time(p)
    if o is not None: events.append((o, 'click'))
for c in cut_times(): events.append((c - .12, 'cutwhoosh'))
for a, b_ in ((6.40, 7.13), (25.40, 27.70)):
    s = a
    while s < b_:
        o = out_time(s)
        if o is not None: events.append((o, 'key'))
        s += .085 + .04 * rng.random()
o = out_time(40.16)
if o is not None: events.append((o, 'mailswoosh'))
events.append((out_time(59.5) if out_time(59.5) is not None else 34.3, 'plop'))
GAIN = dict(plop=1.0, zip=.8, chime=.8, success=.9, boop=.9, bonk=1.0, whoosh=.8, tick=.7, click=1.0, key=1.0, cutwhoosh=.45, mailswoosh=1.0)
for o, n in sorted(events):
    if n == 'click': x = s_click()
    elif n == 'key': x = s_key()
    elif n == 'cutwhoosh': x = s_whoosh(.3, 500, 6000, .3)
    elif n == 'mailswoosh': x = s_whoosh(.5, 300, 4000, .45)
    else: x = UI[n]()
    add(ui, o, x, GAIN[n])

# duck music under UI sounds (exclude cut whooshes / keys)
duck = np.ones(N)
for o, n in events:
    if n in ('cutwhoosh', 'key', 'click'): continue
    i0 = int(o * SR); a = int(.02 * SR); h = int(.25 * SR); r = int(.3 * SR)
    shape = np.r_[np.linspace(1, .55, a), np.full(h, .55), np.linspace(.55, 1, r)]
    i1 = max(0, i0 - a); seg = shape[i1 - (i0 - a):][:N - i1]; duck[i1:i1 + len(seg)] = np.minimum(duck[i1:i1 + len(seg)], seg)
mix = music * .55 * duck + ui * 1.25
fade = np.ones(N); fl = int(SR * 1.2); fade[-fl:] = np.linspace(1, 0, fl) ** 1.5; mix *= fade
mix = np.tanh(mix * 1.1) / 1.1
st = np.stack([mix, mix], 1)
# subtle stereo: delay arp/hats slightly on right
st[:, 1] = np.roll(mix, 9) * .5 + mix * .5
st /= np.max(np.abs(st)) + 1e-9; st *= .9
os.makedirs(HERE + '/out', exist_ok=True)
wavfile.write(HERE + '/out/mix_raw.wav', SR, (st * 32767).astype(np.int16))
subprocess.check_call(['ffmpeg', '-y', '-v', 'error', '-i', HERE + '/out/mix_raw.wav', '-af', 'loudnorm=I=-14:TP=-1.0:LRA=9', '-ar', '48000', HERE + '/out/mix.wav'])
json.dump(sorted(events), open(HERE + '/out/sound_events.json', 'w'), indent=0)
print('ok', len(events), 'events')
