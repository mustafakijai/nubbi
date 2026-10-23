// Stage API driven by the director.
(function () {
  // flowing light ribbons (original wallpaper art)
  const svg = document.getElementById('ribbons'); let h = '';
  for (let i = 0; i < 26; i++) {
    const y = 520 + i * 15, a = 160 + i * 9, c = `hsla(${250 + i * 3},90%,${70 + i % 3 * 6}%,${0.10 + (i % 5) * 0.025})`;
    h += `<path d="M-60 ${y + 200} C 300 ${y - a} 700 ${y + a * 0.9} 1100 ${y - 80 - i * 6} S 1500 ${y - 260} 1520 ${y - 300}" fill="none" stroke="${c}" stroke-width="${1.2 + (i % 4) * .7}"/>`;
  }
  svg.innerHTML = h;
  window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; });
  window.addEventListener('drop', (e) => e.preventDefault());

  const $ = (id) => document.getElementById(id);
  const body = $('tbody');
  let lines = [], spin = null, typing = null;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function render() { body.innerHTML = lines.slice(-13).map((l) => `<div>${l || '&nbsp;'}</div>`).join(''); }
  const SP = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
  const T = {
    clear() { lines = []; render(); },
    line(html) { T.unspin(); lines.push(html); render(); },
    last(html) { lines[lines.length - 1] = html; render(); },
    prompt(cwd) { T.line(`<span class="d">~/code/${cwd}</span> <span class="g">❯</span> <span class="caret"></span>`); },
    async type(text, ms = 45, pre = '') {
      const base = lines[lines.length - 1].replace('<span class="caret"></span>', '');
      for (let i = 1; i <= text.length; i++) { lines[lines.length - 1] = base + pre + esc(text.slice(0, i)) + '<span class="caret"></span>'; render(); await new Promise((r) => setTimeout(r, ms * (0.6 + Math.random() * 0.8))); }
      lines[lines.length - 1] = base + pre + esc(text); render();
    },
    welcome(cwd) {
      T.line('<span class="box">╭──────────────────────────────────────────╮</span>');
      T.line('<span class="box">│</span> <span class="o">✻</span> <b>Welcome to Claude Code!</b>                 <span class="box">│</span>');
      T.line(`<span class="box">│</span>   <span class="d">cwd: ~/code/${cwd.padEnd(26)}</span>  <span class="box">│</span>`);
      T.line('<span class="box">╰──────────────────────────────────────────╯</span>');
      T.line('');
    },
    userPrompt() { T.line('<span class="d">&gt;</span> <span class="caret"></span>'); },
    spin(text) {
      T.unspin(); lines.push(''); let k = 0, t0 = Date.now();
      const tick = () => { lines[lines.length - 1] = `<span class="o">${SP[k++ % SP.length]} ${esc(text)}</span> <span class="d">(${Math.round((Date.now() - t0) / 1000)}s · esc to interrupt)</span>`; render(); };
      tick(); spin = setInterval(tick, 110);
    },
    unspin() { if (spin) { clearInterval(spin); spin = null; lines.pop(); render(); } },
    tool(name, arg, cls = '') { T.line(`<span class="bul ${cls}">⏺</span> <b>${name}</b>(${esc(arg)})`); },
    out(text, cls = 'd') { T.line(`  <span class="d">⎿</span>  <span class="${cls}">${esc(text)}</span>`); },
    say(text) { T.line(`<span class="bul">⏺</span> ${esc(text)}`); },
    tabs(names, on) { const t = $('tabs'); t.className = 'tabs on'; t.innerHTML = names.map((n) => `<div class="${n === on ? 'on' : ''}">${n}</div>`).join(''); $('tTitle').textContent = `${on} — claude — 96×24`; },
  };
  const M = {
    show(m) { $('mTo').textContent = m.to; $('mSub').textContent = m.subject; $('mBody').textContent = m.body.replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n'); const e = $('mail'); e.className = 'win pop'; },
    press() { $('send').classList.add('press'); setTimeout(() => $('send').classList.remove('press'), 160); },
    send() { $('mail').classList.add('away'); setTimeout(() => { $('toast').className = ''; }, 380); setTimeout(() => { $('toast').className = 'hidden'; }, 2200); setTimeout(() => { $('mail').className = 'win hidden'; }, 700); },
    hide() { $('mail').className = 'win hidden'; },
    rect(id) { const r = $(id).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; },
  };
  const E = {
    show() {
      const ec = $('endcard'); ec.classList.remove('hidden'); requestAnimationFrame(() => requestAnimationFrame(() => ec.classList.add('on')));
      const m = Nubbi.create(260, 'bounce'); $('endMascot').innerHTML = ''; $('endMascot').appendChild(m);
      setTimeout(() => { m.classList.remove('bounce'); m.classList.add('happy'); }, 1600);
      setTimeout(() => { m.classList.remove('happy'); m.classList.add('bounce'); }, 2600);
    },
  };
  window.stage = { T, M, E, icon(id, cls, on) { $(id).classList.toggle(cls, on); } };
  T.prompt('korus');
})();
