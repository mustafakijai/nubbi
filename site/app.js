/* Nubbi landing — tiny, dependency-free. */
(() => {
  'use strict';
  const C = window.NUBBI_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- toast ---------- */
  const toastEl = $('.toast'); let toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), 3600); }

  /* ---------- download + architecture ---------- */
  const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent) && !/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;
  let arch = 'arm64'; // most Macs sold since 2020 are Apple Silicon
  const placeholder = (u) => !u || /REPLACE_ME|example\.com/.test(u);
  function url() { return arch === 'x64' ? C.DOWNLOAD_X64 : C.DOWNLOAD_ARM64; }
  function render() {
    const u = url();
    $$('.js-download').forEach((a) => { a.href = u || '#download'; a.dataset.arch = arch; });
    $$('.js-arch-label').forEach((e) => (e.textContent = arch === 'x64' ? 'For Intel Macs' : 'For Apple Silicon (M1–M4)'));
    $$('.js-arch-toggle').forEach((b) => (b.textContent = arch === 'x64' ? 'Have an Apple Silicon Mac?' : 'Have an Intel Mac?'));
    $$('.js-size').forEach((e) => (e.textContent = arch === 'x64' ? C.SIZE_X64 : C.SIZE_ARM64));
    $$('.js-version').forEach((e) => (e.textContent = C.VERSION));
    const one = $('.js-oneliner');
    if (one) one.textContent = `curl -fL "${u}" -o /tmp/Nubbi.zip && rm -rf /tmp/Nubbi && ditto -xk /tmp/Nubbi.zip /tmp/Nubbi && rm -rf /Applications/Nubbi.app && mv /tmp/Nubbi/Nubbi.app /Applications/ && open /Applications/Nubbi.app`;
  }
  $$('.js-arch-toggle').forEach((b) => b.addEventListener('click', () => { arch = arch === 'x64' ? 'arm64' : 'x64'; render(); }));
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.js-download');
    if (!a) return;
    if (a.closest('.nav') || a.closest('.steps')) { if (!isMac || placeholder(url())) { e.preventDefault(); $('#download').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); } }
    if (placeholder(url())) { e.preventDefault(); toast('Download link not set yet — add it in NUBBI_CONFIG at the top of index.html.'); return; }
    if (!isMac) { toast('Nubbi is a Mac app — open this page on your Mac to download it.'); }
    else setTimeout(() => toast('Downloading… then drag Nubbi into Applications and right-click → Open.'), 300);
  });
  async function detect() {
    try {
      const d = navigator.userAgentData;
      if (d && d.getHighEntropyValues) {
        const v = await d.getHighEntropyValues(['architecture']);
        if (v.architecture === 'arm') return 'arm64';
        if (v.architecture === 'x86') return 'x64';
      }
    } catch (_) {}
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        if (/Apple M\d|Apple GPU/i.test(r)) return 'arm64'; // Safari reports "Apple GPU"
        if (/Intel|AMD|Radeon|NVIDIA/i.test(r)) return 'x64';
      }
    } catch (_) {}
    return null;
  }
  render();
  if (!isMac) $$('.not-mac').forEach((e) => (e.hidden = false));
  else (window.requestIdleCallback || setTimeout)(() => detect().then((a) => { if (a) { arch = a; render(); } }));

  /* ---------- copy ---------- */
  $$('.js-copy').forEach((b) => b.addEventListener('click', async () => {
    const t = b.parentElement.querySelector('code').textContent;
    try { await navigator.clipboard.writeText(t); b.textContent = 'Copied'; } catch (_) { b.textContent = 'Select & copy'; }
    setTimeout(() => (b.textContent = 'Copy'), 1800);
  }));

  /* ---------- hero notch story ---------- */
  const notch = $('.notch');
  const nubbi = $('.js-poke');
  const bubble = $('.js-bubble');
  const states = ['peek', 'ask', 'done', 'answer'];
  const dwell = { peek: 3600, ask: 3600, done: 2400, answer: 3600 };
  let si = 0, storyT, paused = false;
  function setState(s) {
    notch.dataset.state = s;
    nubbi.classList.toggle('happy', s === 'done');
    if (s === 'peek') { setTimeout(() => bubble.classList.add('show'), 700); setTimeout(() => bubble.classList.remove('show'), 3000); }
  }
  function next() { if (paused) return; si = (si + 1) % states.length; setState(states[si]); storyT = setTimeout(next, dwell[states[si]]); }
  if (!reduce) { setState('peek'); storyT = setTimeout(next, dwell.peek); } else { setState('ask'); }
  window.nubbiDemo = { pause() { paused = true; clearTimeout(storyT); }, set: setState }; // handy for screenshots
  document.addEventListener('visibilitychange', () => { clearTimeout(storyT); if (!document.hidden && !reduce && !paused) storyT = setTimeout(next, 1500); });

  /* eyes follow the cursor (like the app) */
  const look = $('.m-look', nubbi);
  let raf = 0;
  addEventListener('pointermove', (e) => {
    if (reduce || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = nubbi.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * .63);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
      look.style.transform = `translate(${(dx / d * 7 * k).toFixed(2)}px, ${(dy / d * 5 * k).toFixed(2)}px)`;
    });
  }, { passive: true });

  /* poke easter egg: 5 quick pokes → dizzy */
  let hits = [], dizzyT;
  nubbi.addEventListener('click', () => {
    if (nubbi.classList.contains('dizzy')) return;
    const now = Date.now(); hits = hits.filter((t) => now - t < 1600); hits.push(now);
    nubbi.classList.remove('squish'); void nubbi.offsetWidth; nubbi.classList.add('squish');
    clearTimeout(storyT); paused = true; si = 0; setState('peek'); nubbi.style.animation = 'none';
    if (hits.length >= 5) {
      hits = []; nubbi.classList.add('dizzy'); bubble.textContent = 'Too many hits at once.'; bubble.classList.add('show');
      clearTimeout(dizzyT);
      dizzyT = setTimeout(() => { nubbi.classList.remove('dizzy'); bubble.classList.remove('show'); resume(); }, 3200);
    } else {
      bubble.textContent = ['hey!', 'hehe', 'that tickles', 'okay okay!'][hits.length - 1] || 'hey!';
      bubble.classList.add('show'); clearTimeout(dizzyT); dizzyT = setTimeout(() => { bubble.classList.remove('show'); resume(); }, 2200);
    }
  });
  function resume() { paused = false; bubble.textContent = "hi! I'm Nubbi"; nubbi.style.animation = ''; if (!reduce) storyT = setTimeout(next, 2500); }

  /* ---------- colour swatches ---------- */
  const shot = $('.js-color-shot');
  const palettes = { mint: ['#e3fff4', '#8debc8', '#42bf93', '#5be0b3'], lilac: ['#f4eeff', '#c3b0ff', '#8d72ef', '#b9a2ff'], peach: ['#fff0e8', '#ffb898', '#f0805c', '#ffa98a'], sky: ['#ecf8ff', '#97d4ff', '#4ea3e8', '#7cc8ff'], snow: ['#ffffff', '#eef1f6', '#c4cad6', '#e8eef5'] };
  const shots = { lilac: 'lilac', peach: 'peach', sky: 'sky' };
  $$('.swatches button').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.color, p = palettes[c];
    $$('.swatches button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    const n = notch.style; n.setProperty('--n1', p[0]); n.setProperty('--n2', p[1]); n.setProperty('--n3', p[2]);
    document.documentElement.style.setProperty('--accent', p[3]);
    if (shots[c] && shot) { shot.style.opacity = 0; setTimeout(() => { shot.src = `assets/shots/${shots[c]}.webp`; shot.alt = `Nubbi in ${c}`; shot.style.opacity = 1; }, 160); }
    toast(`Nubbi is now ${c}. Look up! ↑`);
  }));

  /* ---------- demo video: wide on desktop, vertical on phones; play only when visible ---------- */
  const v = $('.js-video'), snd = $('.js-sound');
  if (v) {
    const tall = matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
    v.poster = tall ? v.dataset.posterTall : v.dataset.posterWide;
    if (tall) { v.width = 1080; v.height = 1920; }
    let loaded = false;
    const io = new IntersectionObserver(([en]) => {
      if (en.isIntersecting) {
        if (!loaded) { v.src = tall ? v.dataset.srcTall : v.dataset.srcWide; v.preload = 'auto'; loaded = true; }
        if (!reduce) v.play().catch(() => {});
      } else v.pause();
    }, { rootMargin: '200px 0px', threshold: .15 });
    io.observe(v);
    if (reduce) v.controls = true;
    snd.addEventListener('click', () => {
      v.muted = !v.muted; snd.setAttribute('aria-pressed', String(!v.muted)); snd.setAttribute('aria-label', v.muted ? 'Turn sound on' : 'Turn sound off');
      if (!v.muted) { v.currentTime = 0; v.play().catch(() => {}); }
    });
  }

  /* ---------- reveal on scroll ---------- */
  if (!reduce && 'IntersectionObserver' in window) {
    const els = $$('.card, .steps li, .priv, .note, .terminal, .qa details');
    els.forEach((e) => e.classList.add('reveal'));
    const ro = new IntersectionObserver((ens) => ens.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); ro.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => ro.observe(e));
  }
})();
