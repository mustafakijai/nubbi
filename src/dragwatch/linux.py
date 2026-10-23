#!/usr/bin/env python3
# X11 drag watcher (Linux, used by the Xvfb end-to-end test; same protocol as mac.js).
# "drag 1" when button 1 is held and the XdndSelection owner changed since the press; "drag 0" on release.
import ctypes, sys, time
x = ctypes.cdll.LoadLibrary('libX11.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
x.XDefaultRootWindow.restype = ctypes.c_ulong; x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x.XInternAtom.restype = ctypes.c_ulong; x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x.XGetSelectionOwner.restype = ctypes.c_ulong; x.XGetSelectionOwner.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
U = ctypes.c_ulong; I = ctypes.c_int; UI = ctypes.c_uint
x.XQueryPointer.argtypes = [ctypes.c_void_p, U, ctypes.POINTER(U), ctypes.POINTER(U), ctypes.POINTER(I), ctypes.POINTER(I), ctypes.POINTER(I), ctypes.POINTER(I), ctypes.POINTER(UI)]
d = x.XOpenDisplay(None)
if not d: sys.exit(1)
root = x.XDefaultRootWindow(d); atom = x.XInternAtom(d, b'XdndSelection', 0)
def emit(s): sys.stdout.write(s + '\n'); sys.stdout.flush()
emit('ready')
was_down = False; owner_at_down = 0; dragging = False
while True:
    r, c = U(), U(); rx, ry, wx, wy = I(), I(), I(), I(); m = UI()
    x.XQueryPointer(d, root, ctypes.byref(r), ctypes.byref(c), ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(m))
    down = bool(m.value & (1 << 8)); owner = x.XGetSelectionOwner(d, atom)
    if down and not was_down: owner_at_down = owner
    if down and not dragging and owner and owner != owner_at_down:
        dragging = True; emit('files 1'); emit('drag 1')
    if not down and dragging:
        dragging = False; emit('drag 0')
    was_down = down
    time.sleep(0.04)
