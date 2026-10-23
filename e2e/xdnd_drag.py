#!/usr/bin/env python3
"""Minimal XDND drag *source* for the Xvfb e2e test (what Finder is to the Mac build).
Presses the mouse via XTEST, owns XdndSelection, walks the pointer from (x0,y0) to (x1,y1) sending
XdndEnter/Position to whatever XdndAware top-level window is *really* under the pointer (input shapes
respected, so a click-through window is skipped exactly like on macOS), then releases and drops
text/uri-list for FILE.  Usage: xdnd_drag.py FILE x0 y0 x1 y1"""
import ctypes as C, sys, time, urllib.parse
FILE, X0, Y0, X1, Y1 = sys.argv[1], *map(int, sys.argv[2:6])
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
        if aware(w): return w

import os; VERBOSE = bool(os.environ.get('XDND_VERBOSE'))
payload = ('file://' + urllib.parse.quote(FILE) + '\r\n').encode()
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

def log(*a): print(*a, flush=True)
xt.XTestFakeMotionEvent(d, -1, X0, Y0, 0); xt.XTestFakeButtonEvent(d, 1, 1, 0); x.XFlush(d); time.sleep(0.3)
x.XSetSelectionOwner(d, XdndSel, src, 0); x.XFlush(d)
cur = 0; steps = 40
for i in range(1, steps + 16):
    k = min(i, steps); px, py = X0 + (X1 - X0) * k // steps, Y0 + (Y1 - Y0) * k // steps + (i > steps) * (i % 2)
    xt.XTestFakeMotionEvent(d, -1, px, py, 0); x.XFlush(d); time.sleep(0.06)
    t = target()
    if t != cur:
        if cur: send(cur, Leave, src); log('leave', hex(cur))
        cur = t; accepted = False; waiting = False
        if cur: send(cur, Enter, src, 5 << 24, URI, 0, 0); log('enter', hex(cur), 'at', px, py)
    if cur and not waiting: send(cur, Pos, src, 0, (px << 16) | py, 0, Copy); waiting = True
    pump()
for _ in range(20):
    pump(); time.sleep(0.05)
    if not waiting: break
xt.XTestFakeButtonEvent(d, 1, 0, 0); x.XFlush(d)
if cur and accepted:
    send(cur, Drop, src, 0, 0); log('drop ->', hex(cur))
    for _ in range(60):
        pump(); time.sleep(0.05)
        if finished: break
    log('finished' if finished else 'no XdndFinished')
else:
    if cur: send(cur, Leave, src)
    log('no accepting target under the pointer at release -> drop lost (target=%s)' % hex(cur))
