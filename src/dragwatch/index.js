// OS drag-session watcher. Emits 'drag' (true/false). macOS: persistent JXA helper (mac.js).
// Linux/X11: python ctypes helper (linux.py, used by the e2e test). Elsewhere: no-op.
// Why: the notch window is click-through except over the island, so a drag approaching the notch is
// delivered to whatever is *under* it. Knowing a drag is in progress lets main.js make the window
// hit-testable around the notch *before* the cursor arrives, so macOS routes the drag to us.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

function helperPath(name) {
  const p = path.join(__dirname, name);
  const unpacked = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : p;
}

class DragWatch extends EventEmitter {
  constructor({ platform = process.platform, command } = {}) {
    super(); this.platform = platform; this.command = command; this.active = false; this.files = false; this.restarts = 0; this.proc = null; this.stopped = false; this.ready = false;
  }
  spec() {
    if (this.command) return { cmd: this.command[0], args: this.command.slice(1) };
    if (this.platform === 'darwin') return { cmd: '/usr/bin/osascript', args: ['-l', 'JavaScript', helperPath('mac.js')] };
    if (this.platform === 'linux' && process.env.DISPLAY) return { cmd: 'python3', args: [helperPath('linux.py')] };
    return null;
  }
  start() {
    const s = this.spec();
    if (!s || this.stopped) return this;
    let p;
    try { p = spawn(s.cmd, s.args, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return this; }
    this.proc = p; let buf = '';
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); this.line(line); }
    });
    p.on('error', () => {});
    p.on('exit', (code) => {
      this.emit('exit', code);
      this.proc = null; if (this.active) { this.active = false; this.emit('drag', false); }
      if (!this.stopped && this.restarts++ < 5) setTimeout(() => this.start(), 1000 * this.restarts);
    });
    return this;
  }
  line(l) {
    if (l === 'ready') { this.ready = true; this.emit('ready'); }
    else if (l.startsWith('files ')) this.files = l.endsWith('1');
    else if (l === 'drag 1' && !this.active) { this.active = true; this.emit('drag', true, this.files); }
    else if (l === 'drag 0' && this.active) { this.active = false; this.emit('drag', false, false); }
  }
  stop() { this.stopped = true; if (this.proc) this.proc.kill(); }
}

/** Is a point (window coords) in the "magnet" band that catches drags heading for the notch? */
function inMagnet(x, y, winW, { width = 560, height = 140 } = {}) {
  return y >= -2 && y <= height && Math.abs(x - winW / 2) <= width / 2;
}

module.exports = { DragWatch, inMagnet };
