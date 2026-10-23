// All sounds are synthesized live with Web Audio (no audio files).
(function () {
  let ctx = null, muted = false, master = null;
  function ac() {
    if (!ctx) { ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(type, f0, f1, t0, dur, vol, attack = 0.005) {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  let noiseBuf = null;
  function noise(t0, dur, fA, fB, vol, q = 1.2, shape = 'swell') {
    const c = ac();
    if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = c.createBufferSource(); s.buffer = noiseBuf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(fA, t0); bp.frequency.exponentialRampToValueAtTime(fB, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0);
    if (shape === 'rise') { g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.92); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); }
    else { g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); }
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.02);
  }
  const SOUNDS = {
    plop(t) { tone('sine', 620, 170, t, 0.16, 0.6, 0.004); tone('sine', 1250, 900, t, 0.05, 0.12); },
    zip(t) { // reverse zip: a rising ratchet of clicks into a hard stop
      noise(t, 0.24, 700, 5200, 0.35, 2.5, 'rise');
      for (let i = 0; i < 9; i++) tone('square', 1800 + i * 260, 1800 + i * 260, t + i * 0.024, 0.012, 0.025 + i * 0.006);
    },
    chime(t) { tone('triangle', 1318.5, 1318.5, t, 0.5, 0.32); tone('sine', 1975.5, 1975.5, t + 0.11, 0.65, 0.26); tone('sine', 2637, 2637, t + 0.11, 0.4, 0.05); },
    success(t) { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone('sine', f, f, t + i * 0.075, 0.42 - i * 0.04, 0.24)); },
    boop(t) { tone('sine', 900, 480, t, 0.09, 0.45, 0.003); },
    bonk(t) { tone('triangle', 210, 70, t, 0.32, 0.8, 0.002); tone('square', 120, 60, t, 0.1, 0.12); noise(t, 0.08, 1800, 400, 0.4, 0.8); tone('sine', 1600, 1500, t + 0.02, 0.35, 0.05); },
    whoosh(t) { noise(t, 0.42, 280, 2600, 0.45, 0.9); },
    tick(t) { tone('sine', 1400, 1400, t, 0.03, 0.08); },
  };
  window.Sounds = {
    play(name) { if (muted || !SOUNDS[name]) return; try { SOUNDS[name](ac().currentTime + 0.01); } catch {} },
    setMuted(m) { muted = !!m; },
    get muted() { return muted; },
  };
})();
