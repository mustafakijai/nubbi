// Nubbi — the app's own mascot: a rounded gumdrop with an antenna + sparkle. Original design, inspired by the spirit of Coucou's mascot (Louis Raillé).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  // Gumdrop body: domed top, soft flat bottom (Nubbi's own silhouette)
  const BODY = 'M13 84 C13 47 32 27 60 27 C88 27 107 47 107 84 C107 95 98 99 60 99 C22 99 13 95 13 84 Z';
  function spiral(cx, cy) {
    let d = '';
    for (let i = 0; i <= 40; i++) { const t = i / 40 * Math.PI * 4.2, r = 0.6 + i * 0.16; d += (i ? 'L' : 'M') + (cx + r * Math.cos(t)).toFixed(2) + ' ' + (cy + r * Math.sin(t)).toFixed(2); }
    return d;
  }
  const star = (cx, cy, R, r) => { let d = ''; for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4, k = i % 2 ? r : R; d += (i ? 'L' : 'M') + (cx + k * Math.cos(a)).toFixed(2) + ' ' + (cy + k * Math.sin(a)).toFixed(2); } return d + 'Z'; };
  let uid = 0;
  const all = new Set();

  function create(size = 64, extra = '') {
    const id = 'm' + (++uid);
    const el = document.createElement('div');
    el.className = 'nubbi ' + extra;
    el.style.setProperty('--s', size + 'px');
    el.innerHTML = `
<svg viewBox="0 0 120 104" aria-hidden="true">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" style="stop-color:var(--n1,#d9fff1)"/><stop offset=".55" style="stop-color:var(--n2,#8debc8)"/><stop offset="1" style="stop-color:var(--n3,#4cc79c)"/></linearGradient>
    <linearGradient id="${id}r" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#ffc0b8"/><stop offset=".55" stop-color="#ff7468"/><stop offset="1" stop-color="#d9433a"/></linearGradient>
    <filter id="${id}s" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".35"/></filter>
  </defs>
  <g class="m-squash">
    <g class="m-antenna"><path d="M60 29 C60 20 64 14 70 11" fill="none" stroke="var(--n3,#4cc79c)" stroke-width="3" stroke-linecap="round"/>
      <path class="m-spark" d="${star(71, 9, 7.5, 2.6)}" fill="#ffe27a" stroke="#fff6c9" stroke-width=".8" stroke-linejoin="round"/></g>
    <path class="m-body" d="${BODY}" fill="url(#${id}b)" filter="url(#${id}s)"/>
    <path class="m-body-red" d="${BODY}" fill="url(#${id}r)"/>
    <path class="m-shine" d="M30 50 C32 40 40 34 49 33" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>
    <circle class="m-shine" cx="27" cy="58" r="2.6" fill="#fff" opacity=".6"/>
    <g class="m-cheeks"><circle cx="33" cy="76" r="2.2"/><circle cx="38.5" cy="78.5" r="2.2"/><circle cx="87" cy="76" r="2.2"/><circle cx="81.5" cy="78.5" r="2.2"/></g>
    <g class="m-look">
      <g class="m-eyes">
        <circle class="m-eye" cx="46" cy="66" r="6.2"/><circle class="m-eye" cx="74" cy="66" r="6.2"/>
        <circle class="m-glint" cx="48.2" cy="63.6" r="2.2"/><circle class="m-glint" cx="76.2" cy="63.6" r="2.2"/>
        <circle class="m-glint sm" cx="44" cy="68.6" r="1"/><circle class="m-glint sm" cx="72" cy="68.6" r="1"/>
      </g>
      <g class="m-squint"><path d="M40 62 L48 66 L40 70"/><path d="M80 62 L72 66 L80 70"/></g>
      <g class="m-happy"><path d="M40 68 Q46 59 52 68"/><path d="M68 68 Q74 59 80 68"/></g>
      <g class="m-spiral"><path class="sp1" d="${spiral(46, 65)}"/><path class="sp2" d="${spiral(74, 65)}"/></g>
      <path class="m-mouth" d="M55 75 Q57.5 78.5 60 75 Q62.5 78.5 65 75"/>
      <path class="m-mouth-o" d="M57 77 a3 3.4 0 1 0 6 0 a3 3.4 0 1 0 -6 0"/>
    </g>
  </g>
</svg>
<span class="m-badge"></span>`;
    el._look = el.querySelector('.m-look');
    all.add(el);
    return el;
  }

  // Eyes follow the cursor (window coordinates)
  function follow(x, y) {
    for (const el of all) {
      if (!el.isConnected) { all.delete(el); continue; }
      if (el.classList.contains('no-follow')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.52;
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 260);
      el._look.style.transform = `translate(${(dx / d * 7 * k).toFixed(2)}px, ${(dy / d * 5 * k).toFixed(2)}px)`;
    }
  }
  function setBadge(el, kind, text) {
    const b = el.querySelector('.m-badge');
    b.className = 'm-badge' + (kind ? ' on ' + kind : '');
    b.textContent = text || '';
  }
  window.Nubbi = { create, follow, setBadge };
})();
