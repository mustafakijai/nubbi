#!/usr/bin/env python3
"""The director's 'hand': one XTEST pointer for the ad recording. Reads commands on stdin:
  move X Y DUR | down | up | click | drag FILE X1 Y1 DUR   (pixels, seconds)
Logs every pointer sample to argv[1] as 't x y buttons' so the compositor can draw a crisp macOS cursor.
Drag = a real XDND drag (same protocol code as e2e/xdnd_drag.py)."""
import ctypes as C, sys, time, urllib.parse, math, os
LOGF = open(sys.argv[1], 'a', buffering=1)
x = C.cdll.LoadLibrary('libX11.so.6'); xt = C.cdll.LoadLibrary('libXtst.so.6')
U, L, I, P = C.c_ulong, C.c_long, C.c_int, C.c_void_p
x.XOpenDisplay.restype = P; x.XOpenDisplay.argtypes = [C.c_char_p]
for f, r, a in [('XDefaultRootWindow', U, [P]), ('XInternAtom', U, [P, C.c_char_p, I]), ('XCreateSimpleWindow', U, [P, U, I, I, U, U, U, U, U]),
                ('XSetSelectionOwner', I, [P, U, U, U]), ('XGetSelectionOwner', U, [P, U]), ('XFlush', I, [P]), ('XPending', I, [P]),
                ('XNextEvent', I, [P, P]), ('XSendEvent', I, [P, U, I, L, P]), ('XSelectInput', I, [P, U, L]),
                ('XChangeProperty', I, [P, U, U, U, I, I, C.c_char_p, I]),
                ('XGetWindowProperty', I, [P, U, U, L, L, I, U, C.POINTER(U), C.POINTER(I), C.POINTER(U), C.POINTER(U), C.POINTER(P)]),
                ('XQueryTree', I, [P, U, C.POINTER(U), C.POINTER(U), C.POINTER(P), C.POINTER(C.c_uint)]),
                ('XQueryPointer', I, [P, U, C.POINTER(U), C.POINTER(U), C.POINTER(I), C.POINTER(I), C.POINTER(I), C.POINTER(I), C.POINTER(C.c_uint)])]:
    getattr(x, f).restype = r; getattr(x, f).argtypes = a
xt.XTestFakeMotionEvent.argtypes = [P, I, I, I, U]; xt.XTestFakeButtonEvent.argtypes = [P, C.c_uint, I, U]
d = x.XOpenDisplay(None); root = x.XDefaultRootWindow(d)
A = lambda n: x.XInternAtom(d, n.encode(), 0)
XdndAware, XdndSel, URI = A('XdndAware'), A('XdndSelection'), A('text/uri-list')
Enter, Pos, Status, Leave, Drop, Fin, Copy = (A('Xdnd' + n) for n in ('Enter', 'Position', 'Status', 'Leave', 'Drop', 'Finished', 'ActionCopy'))
src = x.XCreateSimpleWindow(d, root, -10, -10, 1, 1, 0, 0, 0)

class CM(C.Structure): _fields_ = [('type', I), ('serial', U), ('send_event', I), ('display', P), ('window', U), ('message_type', U), ('format', I), ('l', L * 5)]
class SR(C.Structure): _fields_ = [('type', I), ('serial', U), ('send_event', I), ('display', P), ('owner', U), ('requestor', U), ('selection', U), ('target', U), ('property', U), ('time', U)]
class SN(C.Structure): _fields_ = [('type', I), ('serial', U), ('send_event', I), ('display', P), ('requestor', U), ('selection', U), ('target', U), ('property', U), ('time', U)]
class EV(C.Union): _fields_ = [('type', I), ('cm', CM), ('sr', SR), ('sn', SN), ('pad', L * 24)]

def send(win, mtype, *l):
    e = EV(); e.cm.type = 33; e.cm.window = win; e.cm.message_type = mtype; e.cm.format = 32
    for i, v in enumerate(l): e.cm.l[i] = v
    x.XSendEvent(d, win, 0, 0, C.byref(e)); x.XFlush(d)

def aware(w):
    t, f, n, a, p = U(), I(), U(), U(), P()
    ok = x.XGetWindowProperty(d, w, XdndAware, 0, 1, 0, 0, C.byref(t), C.byref(f), C.byref(n), C.byref(a), C.byref(p)) == 0 and n.value > 0
    return C.cast(p, C.POINTER(U))[0] if ok else 0

def target():  # the XdndAware window really under the pointer (descend; X honours input shapes here)
    w = root; found = 0
    while True:
        r, c, a, b, e, f, m = U(), U(), I(), I(), I(), I(), C.c_uint()
        x.XQueryPointer(d, w, C.byref(r), C.byref(c), C.byref(a), C.byref(b), C.byref(e), C.byref(f), C.byref(m))
        if not c.value: return found
        w = c.value
        if VERBOSE and w != getattr(target, 'last', None) and found == 0 and r.value: target.last = w; log('top', hex(w), cx, cy)
        if aware(w): return w

import os; VERBOSE = bool(os.environ.get('XDND_VERBOSE'))
payload = b''
accepted = False; finished = False; waiting = False  # XDND: one XdndPosition in flight until XdndStatus
def pump():
    global accepted, finished, waiting
    while x.XPending(d):
        e = EV(); x.XNextEvent(d, C.byref(e))
        if VERBOSE: log('ev', e.type, e.cm.message_type if e.type == 33 else '', list(e.cm.l) if e.type == 33 else '')
        if e.type == 33 and e.cm.message_type == Status: accepted = bool(e.cm.l[1] & 1); waiting = False
        elif e.type == 33 and e.cm.message_type == Fin: finished = True
        elif e.type == 30:  # SelectionRequest -> hand over the uri-list
            r = e.sr; prop = r.property or r.target
            if VERBOSE: x.XGetAtomName.restype = C.c_char_p; x.XGetAtomName.argtypes = [P, U]; log('selreq', x.XGetAtomName(d, r.target), x.XGetAtomName(d, prop) if prop else None, hex(r.requestor))
            x.XChangeProperty(d, r.requestor, prop, r.target, 8, 0, payload, len(payload))
            n = EV(); n.sn.type = 31; n.sn.requestor = r.requestor; n.sn.selection = r.selection; n.sn.target = r.target; n.sn.property = prop; n.sn.time = r.time
            x.XSendEvent(d, r.requestor, 0, 0, C.byref(n)); x.XFlush(d)


VERBOSE = bool(os.environ.get('XDND_VERBOSE'))
def log(*a): print(*a, file=sys.stderr, flush=True)
cx, cy, btn = 0, 0, 0
KEEP = [0, 0]
x.XRaiseWindow.argtypes = [P, U]
def mark():
    LOGF.write('%.4f %d %d %d\n' % (time.time(), cx, cy, btn))
def warp(px, py):
    global cx, cy
    KEEP[1] += 1
    if KEEP[0] and KEEP[1] % 6 == 0: x.XRaiseWindow(d, KEEP[0])
    cx, cy = int(round(px)), int(round(py)); xt.XTestFakeMotionEvent(d, -1, cx, cy, 0); x.XFlush(d); mark()
def ease(t): return 4 * t * t * t if t < .5 else 1 - (-2 * t + 2) ** 3 / 2
def path(x1, y1, dur, each=None, arc=0.12):
    x0, y0 = cx, cy; n = max(1, int(dur * 90)); dx, dy = x1 - x0, y1 - y0
    # gentle arc: offset perpendicular to the motion, like a real hand
    px_, py_ = -dy * arc, dx * arc
    t0 = time.time()
    for i in range(1, n + 1):
        u = ease(i / n); b = 4 * u * (1 - u)
        warp(x0 + dx * u + px_ * b, y0 + dy * u + py_ * b)
        if each: each()
        sl = t0 + dur * i / n - time.time()
        if sl > 0: time.sleep(sl)
def button(v):
    global btn
    btn = v; xt.XTestFakeButtonEvent(d, 1, v, 0); x.XFlush(d); mark()
def drag(f, x1, y1, dur):
    global payload, accepted, finished, waiting
    payload = ('file://' + urllib.parse.quote(f) + '\r\n').encode(); accepted = finished = waiting = False
    button(1); time.sleep(0.12)
    x.XSetSelectionOwner(d, XdndSel, src, 0); x.XFlush(d)
    st = {'cur': 0}
    def each():
        global accepted, waiting
        t = target()
        if t != st['cur']:
            if st['cur']: send(st['cur'], Leave, src)
            if VERBOSE: log('target', hex(t), cx, cy)
            st['cur'] = t; accepted = False; waiting = False
            if t: send(t, Enter, src, 5 << 24, URI, 0, 0)
        if st['cur'] and not waiting: send(st['cur'], Pos, src, 0, (cx << 16) | cy, 0, Copy); waiting = True
        pump()
    path(x1, y1, dur, each, arc=0.18)
    for _ in range(12): each(); time.sleep(0.03)   # settle over the target
    for _ in range(20):
        pump(); time.sleep(0.03)
        if not waiting: break
    button(0)
    if st['cur'] and accepted:
        send(st['cur'], Drop, src, 0, 0)
        for _ in range(80):
            pump(); time.sleep(0.03)
            if finished: break
        return 'dropped'
    if st['cur']: send(st['cur'], Leave, src)
    return 'lost'
warp(int(os.environ.get('HAND_X', 1440)), int(os.environ.get('HAND_Y', 1500)))
print('ready', flush=True)
for line in sys.stdin:
    a = line.split()
    if not a: continue
    r = 'ok'
    try:
        if a[0] == 'move': path(float(a[1]), float(a[2]), float(a[3]))
        elif a[0] == 'down': button(1)
        elif a[0] == 'up': button(0)
        elif a[0] == 'click': button(1); time.sleep(0.07); button(0)
        elif a[0] == 'drag': r = drag(a[1], float(a[2]), float(a[3]), float(a[4]))
        elif a[0] == 'pump': pump()
        elif a[0] == 'top': KEEP[0] = int(a[1], 0); x.XRaiseWindow(d, KEEP[0]); x.XFlush(d)
    except Exception as e: r = 'err ' + str(e)
    print(r, flush=True)
