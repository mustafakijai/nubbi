/* Nubbi renderer — island states, sessions, drop/ask flow, easter egg. */
(() => {
  const api = window.nubbi;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const base = (p) => String(p || '').replace(/\/+$/, '').split('/').pop() || 'Claude Code';

  let G = JSON.parse(new URLSearchParams(location.search).get('g') || '{}');
  const island = $('island'), content = $('content');
  let S = {}; // public settings
  let BRAND = { name: 'Nubbi', mascot: 'Nubbi' };
  let CAT = []; // provider catalog
  const prov = (id) => CAT.find((p) => p.id === (id || S.provider)) || { id: 'free', short: 'Free', label: 'Free', models: [] };
  let hooksInstalled = true;

  // ---------------------------------------------------------------- springs
  class Spring {
    constructor(v) { this.v = v; this.t = v; this.vel = 0; }
    step(dt, k = 430, z = 0.74) { const c = 2 * Math.sqrt(k) * z; const a = -k * (this.v - this.t) - c * this.vel; this.vel += a * dt; this.v += this.vel * dt; }
    get done() { return Math.abs(this.v - this.t) < 0.3 && Math.abs(this.vel) < 0.5; }
  }
  const sp = { w: new Spring(G.notchW || 190), h: new Spring(G.notchH || 32), r: new Spring(10) };
  let raf = 0, lastT = 0;
  function animate() {
    if (raf) return;
    lastT = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.032, (now - lastT) / 1000); lastT = now;
      // sub-step for stability
      for (let i = 0; i < 4; i++) for (const s of Object.values(sp)) s.step(dt / 4);
      paint();
      if (Object.values(sp).every((s) => s.done)) { for (const s of Object.values(sp)) { s.v = s.t; s.vel = 0; } paint(); raf = 0; return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function paint() {
    const w = Math.max(0, sp.w.v), hh = Math.max(0, sp.h.v);
    island.style.width = w.toFixed(2) + 'px';
    island.style.height = hh.toFixed(2) + 'px';
    island.style.setProperty('--r', Math.max(0, Math.min(sp.r.v, hh / 2)).toFixed(2) + 'px');
    reportHit();
  }
  let hitKey = '';
  function reportHit() {
    const r = island.getBoundingClientRect();
    const small = mode !== 'big';
    // Collapsed: a generous always-hit-testable strip around the notch (drops + hover land here). Open: hug the island.
    const padX = small ? 40 : 4, padB = small ? 16 : 6;
    const rect = { x: Math.round(r.left - padX), y: 0, w: Math.round(r.width + padX * 2), h: Math.round(r.height + padB) };
    const k = JSON.stringify(rect);
    if (k !== hitKey) { hitKey = k; api.hit(rect); }
  }

  // ---------------------------------------------------------------- geometry
  function applyGeometry(g) {
    G = g;
    document.documentElement.style.setProperty('--nh', g.notchH + 'px');
    document.body.classList.toggle('nonotch', !g.hasNotch);
    layout();
  }

  // ---------------------------------------------------------------- state
  let mode = 'collapsed';        // collapsed | wings | big
  let view = null;               // current big view name
  let pinned = false;            // opened by click/shortcut (vs hover)
  let viewEl = null;
  const sessions = new Map();    // session_id -> session
  const doc = { file: null, qa: [], busy: false, lastView: null };

  const VIEW_W = { panel: 640, drop: 520, upload: 500, ready: 560, answer: 600, nokey: 520, dizzy: 470, error: 520 };
  function targetW() {
    if (mode === 'collapsed') return G.notchW;
    if (mode === 'wings') return G.notchW + 2 * 48;
    if (view === 'peek') return G.notchW + 40;
    return Math.max(VIEW_W[view] || 600, G.notchW + 220);
  }
  function layout() {
    island.className = mode + (mode === 'big' ? ' big' : '') + (mode === 'wings' ? ' wings' : '');
    if (mode === 'big') island.classList.add('wings');
    const w = targetW();
    content.style.width = w + 'px';
    sp.w.t = w;
    sp.h.t = G.notchH + (mode === 'big' && viewEl ? viewEl.offsetHeight : 0);
    sp.r.t = mode === 'big' ? (view === 'peek' ? 24 : 28) : (G.hasNotch ? 10 : G.notchH / 2);
    animate();
    updateTop();
  }
  const ro = new ResizeObserver(() => { if (mode === 'big') { sp.h.t = G.notchH + (viewEl ? viewEl.offsetHeight : 0); animate(); } });

  function show(name, build) {
    const prev = viewEl;
    if (prev) { prev.classList.add('out'); ro.unobserve(prev); setTimeout(() => prev.remove(), 150); }
    view = name; mode = 'big';
    viewEl = build();
    viewEl.classList.add('view', name);
    content.appendChild(viewEl);
    ro.observe(viewEl);
    layout();
    return viewEl;
  }
  function collapse(sound = true) {
    if (window.__e2e) window.__e2e.push({ collapse: view, st: String(new Error().stack).split('\n').slice(2, 5).map((l) => l.trim().replace(/\(.*\//, '(')).join(' | '), t: Date.now() });
    if (mode === 'big' && sound && view !== 'peek') Sounds.play('zip');
    if (viewEl) { const v = viewEl; v.classList.add('out'); ro.unobserve(v); setTimeout(() => v.remove(), 150); viewEl = null; }
    if (view === 'ready' || view === 'answer' || view === 'upload') doc.lastView = view;
    view = null; pinned = false;
    mode = activeSessions().length ? 'wings' : 'collapsed';
    layout();
    renderWings();
    api.blur();
  }

  // ---------------------------------------------------------------- top bar
  const ICON_SOUND_ON = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.2 2.4 4 5.2H2a.8.8 0 0 0-.8.8v4c0 .4.4.8.8.8h2l3.2 2.8c.3.3.8 0 .8-.4V2.8c0-.4-.5-.7-.8-.4z"/><path d="M10.4 5.2a3.6 3.6 0 0 1 0 5.6M12.2 3.4a6.2 6.2 0 0 1 0 9.2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>';
  const ICON_SOUND_OFF = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.2 2.4 4 5.2H2a.8.8 0 0 0-.8.8v4c0 .4.4.8.8.8h2l3.2 2.8c.3.3.8 0 .8-.4V2.8c0-.4-.5-.7-.8-.4z"/><path d="m10.5 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  function updateTop() {
    const n = activeSessions().length;
    $('running').textContent = n ? `${n} running` : '';
    $('icSound').innerHTML = Sounds.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
    $('icSound').title = Sounds.muted ? 'Unmute sounds' : 'Mute sounds';
    $('icHome').classList.toggle('on', view === 'panel');
    $('icAsk').classList.toggle('on', ['drop', 'upload', 'ready', 'answer', 'nokey'].includes(view));
  }
  $('icHome').onclick = () => openPanel(true);
  $('icAsk').onclick = () => openDocView();
  $('icAdd').onclick = async () => { const p = await api.pick(); if (p) startUpload(p, base(p)); };
  $('icSound').onclick = () => { api.setSettings({ sound: Sounds.muted }); Sounds.setMuted(!Sounds.muted); Sounds.play('tick'); updateTop(); };
  $('icGear').onclick = () => { api.openSettings(); collapse(false); };

  // wings (collapsed with activity)
  const wingNubbi = Nubbi.create(22, 'no-follow');
  $('wingNubbi').appendChild(wingNubbi);
  function renderWings() {
    const act = activeSessions();
    const perm = act.filter((s) => s.state === 'permission').length;
    const working = act.some((s) => s.state === 'working');
    const done = act.some((s) => s.state === 'done' || s.state === 'success');
    const wc = $('wingCount');
    if (perm) { wc.innerHTML = `<span class="pip orange">${perm}</span>`; Nubbi.setBadge(wingNubbi, null); }
    else if (working) { wc.innerHTML = `<span class="pip blue"></span>`; }
    else if (done) { wc.innerHTML = `<span class="pip green">✓</span>`; }
    else wc.innerHTML = `<span style="color:#8e8e96">${act.length}</span>`;
    if (mode !== 'big') { mode = act.length ? 'wings' : 'collapsed'; layout(); }
    updateTop();
  }

  // ---------------------------------------------------------------- panel (sessions)
  function activeSessions() { return [...sessions.values()].filter((s) => !s.ended).sort((a, b) => b.created - a.created); }
  function pillsHTML() {
    return `<div class="pills">${(S.shortcuts || []).map((p, i) => `<button class="pill" data-url="${esc(p.url)}" style="--c:${esc(p.color)}"><i>${esc((p.label || '?')[0].toUpperCase())}</i>${esc(p.label)}</button>`).join('')}</div>`;
  }
  function bindPills(el) { el.querySelectorAll('.pill').forEach((b) => (b.onclick = () => { Sounds.play('boop'); api.openUrl(b.dataset.url); })); }

  function openPanel(pin) {
    if (pin) { pinned = true; api.focus(); }
    if (view === 'panel') { renderPanel(); return; }
    if (mode !== 'big') Sounds.play('plop');
    show('panel', () => h('<div></div>'));
    renderPanel();
  }

  function sessionCard(s, first) {
    const el = h(`<div class="card ${s.state}" data-sid="${esc(s.id)}"></div>`);
    const m = Nubbi.create(60);
    bindNubbi(m);
    const info = h('<div class="info"></div>');
    const glow = { working: 'blue', permission: 'orange', success: 'green', done: 'green', error: 'red', attention: 'orange' }[s.state];
    if (glow) m.classList.add('glow-' + glow);
    if (s.state === 'working') Nubbi.setBadge(m, 'blue');
    else if (s.state === 'permission' || s.state === 'attention') Nubbi.setBadge(m, 'orange', '1');
    else if (s.state === 'success' || s.state === 'done') { Nubbi.setBadge(m, 'green'); m.classList.add('happy'); }
    else if (s.state === 'error') Nubbi.setBadge(m, 'red', '!');

    if (s.state === 'permission') {
      info.innerHTML = `<div class="headrow"><span class="ttl">${esc(s.name)}</span><span class="sub">needs permission</span></div>
        <div class="cmd">${esc(s.perm.text)}</div>
        <div class="row">
          <button class="btn" data-d="deny">Deny <span class="kbd">N</span></button>
          <button class="btn" data-d="always">Always</button>
          <button class="btn primary" data-d="allow">Allow <span class="kbd">Y</span></button>
        </div>`;
      info.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => decide(s, b.dataset.d)));
    } else if (s.state === 'success') {
      info.innerHTML = `<div class="headrow"><span class="ttl">${esc(s.verb)} — ${esc(s.okText)}</span><span class="okpill">OK</span></div>
        <div class="sub">${esc(s.name)} · Claude Code</div>
        <div class="row"><button class="btn" data-a="term">Open terminal</button></div>`;
    } else if (s.state === 'done') {
      info.innerHTML = `<div class="headrow"><span class="ttl">${esc(s.name)}</span><span class="okpill">✓ Done</span></div>
        <div class="summary">${esc(s.summary || 'Claude finished — your turn.')}</div>
        <div class="row"><button class="btn" data-a="term">Open terminal</button><button class="btn ok" data-a="ok">OK</button></div>`;
    } else if (s.state === 'attention') {
      info.innerHTML = `<div class="ttl">${esc(s.name)}</div><div class="sub">${esc(s.note || 'Claude needs your input in the terminal')}</div>
        <div class="row"><button class="btn primary" data-a="term">Open terminal</button></div>`;
    } else if (s.state === 'error') {
      info.innerHTML = `<div class="ttl">${esc(s.name)}</div><div class="sub">${esc(s.note || 'Stopped with an error')}</div>
        <div class="row"><button class="btn" data-a="term">Open terminal</button><button class="btn ghost" data-a="ok">Dismiss</button></div>`;
    } else {
      info.innerHTML = `<div class="ttl">${esc(s.name)}</div><div class="sub">Claude Code</div>
        <div class="line ${s.state === 'working' ? 'shimmer' : ''}">${esc(s.state === 'working' ? (s.tool || 'Thinking…') : (s.note || 'Ready — waiting for a prompt'))}</div>`;
    }
    info.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
      Sounds.play('boop');
      if (b.dataset.a === 'term') api.openTerminal(s.meta || {});
      if (b.dataset.a === 'ok') { s.state = 'idle'; s.note = 'Waiting for your next prompt'; renderPanel(); renderWings(); }
    }));
    el.append(m, info);
    if (first && s.state !== 'permission') { el.insertAdjacentHTML('beforeend', pillsHTML()); bindPills(el); }
    if (s.isNew) { el.classList.add('slide'); s.isNew = false; }
    return el;
  }
  function idleCard() {
    const el = h(`<div class="card idle"></div>`);
    const m = Nubbi.create(60); bindNubbi(m);
    const info = h(`<div class="info"><div class="ttl">Hi, I’m Nubbi!</div>
      <div class="sub">${hooksInstalled ? 'No Claude Code session running.' : 'Connect Claude Code to see sessions here.'}</div>
      <div class="line" style="color:#8e8e96">Drop a file on the notch to ask about it.</div></div>`);
    if (!hooksInstalled) {
      const row = h('<div class="row"><button class="btn primary">Connect Claude Code</button></div>');
      row.firstChild.onclick = async () => { const r = await api.hooksInstall(); hooksInstalled = !!(r.status && r.status.installed); Sounds.play(r.ok ? 'success' : 'bonk'); renderPanel(); };
      info.appendChild(row);
    }
    el.append(m, info); el.insertAdjacentHTML('beforeend', pillsHTML()); bindPills(el);
    return el;
  }
  function renderPanel() {
    if (view !== 'panel' || !viewEl) return;
    const act = activeSessions();
    viewEl.innerHTML = '';
    if (!act.length) viewEl.appendChild(idleCard());
    // permission requests first, then newest
    const order = [...act].sort((a, b) => (b.state === 'permission') - (a.state === 'permission') || b.created - a.created);
    order.slice(0, 4).forEach((s, i) => viewEl.appendChild(sessionCard(s, i === 0)));
    if (order.length > 4) viewEl.appendChild(h(`<div class="sub" style="text-align:center;margin-top:8px">+${order.length - 4} more</div>`));
    updateTop();
  }

  // ---------------------------------------------------------------- hook events
  function describe(tool, input = {}) {
    if (!tool) return 'Working…';
    const f = input.file_path || input.notebook_path || input.path;
    switch (tool) {
      case 'Bash': return input.description || input.command || 'Running a command';
      case 'Read': return `Reading ${base(f)}`;
      case 'Edit': case 'MultiEdit': return `Editing ${base(f)}`;
      case 'Write': return `Writing ${base(f)}`;
      case 'Grep': return `Searching for “${input.pattern || ''}”`;
      case 'Glob': return `Finding ${input.pattern || 'files'}`;
      case 'WebFetch': return `Reading ${input.url || 'the web'}`;
      case 'WebSearch': return `Searching the web for “${input.query || ''}”`;
      case 'Task': case 'Agent': return input.description ? `Agent: ${input.description}` : 'Running a sub-agent';
      case 'TodoWrite': return 'Updating the plan';
      default: return tool.replace(/^mcp__/, '').replace(/__/g, ' · ');
    }
  }
  function permText(tool, input = {}) {
    if (tool === 'Bash') return input.command || '';
    const f = input.file_path || input.notebook_path;
    if (f) return `${tool} ${f}`;
    if (input.url) return `${tool} ${input.url}`;
    const j = JSON.stringify(input); return `${tool} ${j.length > 160 ? j.slice(0, 160) + '…' : j}`;
  }
  const verbOf = (tool) => ({ Bash: 'Execute', Edit: 'Edit', MultiEdit: 'Edit', Write: 'Write', WebFetch: 'Fetch', Read: 'Read' }[tool] || tool);

  function session(payload, meta) {
    const id = payload.session_id || 'default';
    let s = sessions.get(id);
    if (!s || s.ended) {
      s = { id, name: base(payload.cwd), cwd: payload.cwd, state: 'idle', created: Date.now(), isNew: true, meta };
      sessions.set(id, s);
    }
    if (meta && (meta.term || meta.bundle)) s.meta = meta;
    if (payload.cwd) { s.cwd = payload.cwd; s.name = base(payload.cwd); }
    return s;
  }

  function onHook({ event, payload = {}, meta = {}, id, auto }) {
    const s = session(payload, meta);
    const wasNew = s.isNew;
    switch (event) {
      case 'SessionStart': s.state = 'idle'; s.note = payload.source === 'resume' ? 'Resumed — waiting for a prompt' : 'Ready — waiting for a prompt'; break;
      case 'UserPromptSubmit': s.state = 'working'; s.tool = 'Thinking…'; s.prompt = payload.prompt; break;
      case 'PreToolUse': if (s.state !== 'permission') { s.state = 'working'; s.tool = describe(payload.tool_name, payload.tool_input); } break;
      case 'PermissionRequest': {
        const text = permText(payload.tool_name, payload.tool_input);
        if (auto) { s.state = 'working'; s.tool = `Allowed by your rule · ${text}`; break; }
        s.state = 'permission'; s.perm = { id, tool: payload.tool_name, text };
        Sounds.play('chime');
        if (mode !== 'big' || view === 'panel') openPanel(false); else flashWings();
        break;
      }
      case 'PostToolUse':
        if (s.allowed && s.allowed.tool === payload.tool_name) {
          s.state = 'success'; s.verb = verbOf(payload.tool_name); s.okText = s.allowed.text; s.allowed = null; Sounds.play('success');
        } else if (s.state !== 'permission' && s.state !== 'success') { s.state = 'working'; s.tool = 'Thinking…'; }
        break;
      case 'PostToolUseFailure': if (s.state !== 'permission') { s.state = 'working'; s.tool = `${payload.tool_name || 'Tool'} failed — Claude is adjusting`; } break;
      case 'Notification':
        if (s.state === 'permission') break;
        if (payload.notification_type === 'idle_prompt') { s.state = 'attention'; s.note = 'Waiting for your input'; }
        else if (payload.notification_type === 'permission_prompt') { s.state = 'attention'; s.note = payload.message || 'Claude needs your permission in the terminal'; Sounds.play('chime'); }
        else { s.note = payload.message; }
        break;
      case 'Stop': s.state = 'done'; s.summary = firstLines(payload.last_assistant_message); Sounds.play('success'); break;
      case 'StopFailure': s.state = 'error'; s.note = payload.error || 'Stopped with an API error'; Sounds.play('bonk'); break;
      case 'SessionEnd': s.ended = true; break;
    }
    if (wasNew && event === 'SessionStart' && mode !== 'big') peek();
    renderPanel(); renderWings();
  }
  function firstLines(t) { if (!t) return ''; const x = String(t).replace(/```[\s\S]*?```/g, '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim(); return x.length > 220 ? x.slice(0, 220) + '…' : x; }
  function flashWings() { island.classList.add('shake'); setTimeout(() => island.classList.remove('shake'), 500); }

  async function decide(s, d) {
    if (!s.perm) return;
    const p = s.perm; s.perm = null;
    Sounds.play(d === 'deny' ? 'boop' : 'tick');
    await api.decide(p.id, d);
    if (d === 'deny') { s.state = 'working'; s.tool = `Denied · ${p.text}`; }
    else { s.state = 'working'; s.tool = `Running · ${p.text}`; s.allowed = { tool: p.tool, text: p.text }; }
    renderPanel(); renderWings();
    if (!pinned && !activeSessions().some((x) => x.state === 'permission')) setTimeout(() => { if (!pinned && view === 'panel' && !hovering) collapse(); }, 2600);
  }
  api.onResolved(({ id, why }) => {
    for (const s of sessions.values()) if (s.perm && s.perm.id === id) {
      s.perm = null; s.state = 'working'; s.tool = why === 'timeout' ? 'Asked in the terminal instead' : 'Answered in the terminal';
    }
    renderPanel(); renderWings();
  });

  // ---------------------------------------------------------------- Nubbi clicks / dizzy egg
  let clicks = [];
  function bindNubbi(m) {
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = Date.now();
      clicks = clicks.filter((t) => now - t < 2600); clicks.push(now);
      if (clicks.length >= 7) { clicks = []; dizzy(); return; }
      Sounds.play('boop');
      m.classList.add('squint'); clearTimeout(m._sq); m._sq = setTimeout(() => m.classList.remove('squint'), 230);
    });
  }
  let dizzyUntil = 0;
  function dizzy() {
    if (Date.now() < dizzyUntil) return;
    dizzyUntil = Date.now() + 4200;
    Sounds.play('bonk');
    const v = show('dizzy', () => h(`<div><div class="dizzy-card shake"><div class="info"><div class="ttl">Too many hits at once.</div>
      <div class="sub">Give me a sec — back to work in three seconds.</div></div></div></div>`));
    const m = Nubbi.create(64, 'dizzy no-follow');
    v.firstChild.prepend(m);
    setTimeout(() => { m.classList.remove('dizzy'); m.classList.add('happy'); v.querySelector('.ttl').textContent = 'Okay, I’m good!'; v.querySelector('.sub').textContent = 'Back to work.'; v.firstChild.style.background = 'rgba(255,255,255,.06)'; v.firstChild.style.borderColor = 'rgba(255,255,255,.08)'; Sounds.play('success'); }, 3000);
    setTimeout(() => { if (view === 'dizzy') collapse(); }, 3900);
  }

  // ---------------------------------------------------------------- peek
  let peeking = false;
  function peek() {
    if (peeking || mode === 'big') return;
    peeking = true;
    Sounds.play('plop');
    const v = show('peek', () => h('<div></div>'));
    const m = Nubbi.create(50, 'no-follow');
    bindNubbi(m); v.appendChild(m);
    const T = (ms, f) => setTimeout(() => { if (view === 'peek') f(); }, ms);
    T(650, () => m.classList.add('look-l'));
    T(1150, () => { m.classList.remove('look-l'); m.classList.add('look-r'); });
    T(1650, () => { m.classList.remove('look-r'); m.classList.add('happy'); });
    T(2250, () => { Sounds.play('zip'); m.classList.add('retract'); });
    setTimeout(() => { peeking = false; if (view === 'peek') collapse(false); }, 2520);
  }

  // ---------------------------------------------------------------- drag & drop
  const TYPES = [
    ['PDF', '<path d="M4 1.5h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"/><path d="M9 1.5v3h3"/>'],
    ['Images', '<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6"/><circle cx="5.5" cy="6" r="1.2"/><path d="m2.5 12 3.6-3.4 2.6 2.3 2-1.7 2.8 2.6"/>'],
    ['Text', '<path d="M3 3.5h10M3 6.5h10M3 9.5h7M3 12.5h5"/>'],
    ['Docs', '<rect x="3" y="1.5" width="10" height="13" rx="1.4"/><path d="M5.5 5h5M5.5 7.8h5M5.5 10.6h3"/>'],
  ];
  let dragDepth = 0, preDragView = null, dragLeaveT = 0, osDragT = 0, dropped = false;
  function showDrop(sub) {
    if (view === 'drop') return;
    preDragView = view; dropped = false;
    Sounds.play('whoosh');
    const v = show('drop', () => h(`<div><div class="dropzone"><div class="info"><div class="dz-title">Drop your files here</div>
      <div class="dz-sub">${esc(sub || `${BRAND.mascot} reads it and answers your questions.`)}</div>
      <div class="types">${TYPES.map(([n, p]) => `<span class="type"><svg viewBox="0 0 16 16">${p}</svg>${n}</span>`).join('')}</div>
      <div class="dz-alt"><button class="btn" id="dzPick">Choose file…</button><span class="kbd">${esc(keyLabel(S.pickShortcut || 'Control+Alt+O'))}</span><span class="dz-or">or drop on the menu-bar icon</span></div></div></div></div>`));
    const m = Nubbi.create(64, 'lookdown no-follow'); v.firstChild.prepend(m);
    v.querySelector('#dzPick').onclick = () => pickFile();
  }
  const keyLabel = (a) => String(a).replace('Control', '⌃').replace('Alt', '⌥').replace('Shift', '⇧').replace(/CommandOrControl|Command/, '⌘').replace(/\+/g, '');
  async function pickFile() { pinned = true; const p = await api.pick(); if (p) startUpload(p, base(p)); else if (view === 'drop') openPanel(true); }
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].some((t) => t === 'Files' || t === 'application/x-moz-file' || t === 'text/uri-list');
  function endDrag() { document.body.classList.remove('over', 'osdrag'); if (view === 'drop' && !dropped) { if (preDragView === 'panel') openPanel(false); else collapse(false); } }
  // Every drag event is accepted (preventDefault) so the OS shows the copy cursor and actually delivers the drop.
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; clearTimeout(dragLeaveT); clearTimeout(osDragT); document.body.classList.add('over'); showDrop(); });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; clearTimeout(dragLeaveT); if (view !== 'drop') showDrop(); });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragLeaveT = setTimeout(endDrag, 220);
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; dropped = true; document.body.classList.remove('over', 'osdrag'); clearTimeout(dragLeaveT); clearTimeout(osDragT);
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    const f = files[0];
    if (!f) return showError('That app didn’t hand over a real file. Save it to Finder first, then drop it — or use Choose file….');
    const p = api.pathFor(f);
    if (!p) return showError('That app only offers a “promised” file (no path on disk yet). Save it to Finder first, then drop it — or use Choose file….');
    pinned = true; api.focus();
    startUpload(p, f.name, files.length > 1 ? `Reading the first of ${files.length} files.` : '');
  });
  // Main process: an OS drag is heading for the notch (magnet band) or ended.
  api.onOsDrag(({ active }) => {
    clearTimeout(osDragT);
    if (active) { document.body.classList.add('osdrag'); showDrop(); return; }
    osDragT = setTimeout(() => { if (dragDepth === 0) endDrag(); }, 450); // give the drop event time to arrive
  });
  // Tray icon drop / ⌃⌥O picker / Finder "Open with"
  api.onExternalFile(({ path: p, name }) => { pinned = true; api.focus(); startUpload(p, name); });

  // ---------------------------------------------------------------- upload / ready / ask
  let uploadSeq = 0;
  async function startUpload(p, name, note) {
    const seq = ++uploadSeq; dropped = true;
    pinned = true;
    api.resetDoc(); doc.file = null; doc.qa = [];
    const v = show('upload', () => h(`<div><div class="card upl"><div class="info"><div class="upl top"><span class="sub" style="color:#c7c7cc">Uploading <b style="color:#fff">${esc(name)}</b></span><span class="pct">0%</span></div><div class="bar"><i></i></div></div></div></div>`));
    const m = Nubbi.create(46, 'thinking no-follow'); v.firstChild.prepend(m);
    const pct = v.querySelector('.pct'), bar = v.querySelector('.bar i');
    let real = 0, shown = 0; const t0 = performance.now(); const MIN = 1100;
    const off = api.onFileProgress((x) => { real = x; });
    let finished = false, result = null, error = null;
    api.prepare(p).then((r) => { result = r; real = 1; }, (e) => { error = e; }).finally(() => { finished = true; off(); });
    await new Promise((res) => {
      const step = () => {
        if (seq !== uploadSeq) return res();
        if (error) return res();
        const cap = Math.min(real, (performance.now() - t0) / MIN); // never faster than MIN, never ahead of the real read
        shown += (cap - shown) * 0.18;
        if (cap >= 1 && 1 - shown < 0.004) shown = 1;
        pct.textContent = Math.round(shown * 100) + '%'; bar.style.width = (shown * 100).toFixed(1) + '%';
        if (shown >= 1 && finished) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    if (seq !== uploadSeq) return;
    if (error) return showError(clean(error));
    doc.file = result; doc.note = note || '';
    Sounds.play('chime');
    showReady();
  }
  const clean = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // Provider picker chip inside the ask box (Free / Gemini / Groq / OpenRouter / Ollama / Claude)
  function providerChip() {
    const c = h(`<button class="chip" title="Choose the AI that answers"><span class="dot ${S.ready ? '' : 'warn'}"></span><span class="nm">${esc(prov().short)}</span><svg viewBox="0 0 10 10"><path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>`);
    c.onclick = (e) => { e.stopPropagation(); togglePicker(c); };
    return c;
  }
  function togglePicker(anchor) {
    const old = document.querySelector('.picker'); if (old) { old.remove(); return; }
    const box = h(`<div class="picker"><div class="ph">Who answers?</div>${CAT.map((p) => {
      const ok = !p.needsKey || (S.hasKey && S.hasKey[p.id]);
      const tag = p.id === 'free' ? '<span class="tag free">no key</span>' : p.id === 'ollama' ? '<span class="tag">local</span>' : ok ? '<span class="tag ok">key saved</span>' : '<span class="tag">free key</span>';
      return `<button class="opt ${p.id === S.provider ? 'on' : ''}" data-id="${p.id}"><span class="ck">${p.id === S.provider ? '✓' : ''}</span><span class="pl">${esc(p.label)}</span>${p.id === 'claude' && !ok ? '<span class="tag">paid key</span>' : tag}</button>`;
    }).join('')}<button class="opt more" data-id="__settings"><span class="ck"></span><span class="pl">Keys & models in Settings…</span></button></div>`);
    (viewEl || content).appendChild(box); // inline under the card: the island grows to fit (ResizeObserver)
    box.querySelectorAll('.opt').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation(); box.remove();
      if (b.dataset.id === '__settings') return api.openSettings();
      Sounds.play('tick');
      S = await api.setSettings({ provider: b.dataset.id }); S.brand = BRAND;
      document.querySelectorAll('.chip .nm').forEach((n) => (n.textContent = prov().short));
      document.querySelectorAll('.chip .dot').forEach((n) => n.classList.toggle('warn', !S.ready));
      if (view === 'answer') { const sub = viewEl.querySelector('#aSub'); if (sub) sub.textContent = subLine(); }
    }));
    setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!box.contains(ev.target)) { box.remove(); } document.removeEventListener('pointerdown', off, true); }, true), 0);
  }

  function askField(placeholder, onSubmit) {
    const f = h(`<div class="field"><input placeholder="${esc(placeholder)}" spellcheck="false"><button class="send" disabled title="Ask"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg></button></div>`);
    const inp = f.querySelector('input'), b = f.querySelector('button');
    inp.addEventListener('input', () => { b.disabled = !inp.value.trim(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); onSubmit(inp.value.trim()); } e.stopPropagation(); if (e.key === 'Escape') collapse(); });
    inp.addEventListener('pointerdown', () => api.focus());
    b.onclick = () => inp.value.trim() && onSubmit(inp.value.trim());
    f.prepend(providerChip());
    return f;
  }
  function showReady() {
    const f = doc.file;
    const v = show('ready', () => h(`<div><div class="card"><div class="info"><div class="ttl">${esc(f.name)} is ready.</div><div class="sub">${esc(doc.note || 'What do you want to do with it?')}</div><div class="askbox"></div></div></div></div>`));
    const m = Nubbi.create(58, 'happy'); bindNubbi(m); v.firstChild.prepend(m);
    const box = v.querySelector('.askbox');
    box.appendChild(askField('Ask a question about it', ask));
    const c = h('<button class="btn ghost">Cancel</button>'); c.onclick = () => { api.resetDoc(); doc.file = null; doc.lastView = null; collapse(); };
    box.appendChild(c);
    setTimeout(() => { api.focus(); const i = v.querySelector('input'); i && i.focus(); }, 80);
  }
  function openDocView() {
    pinned = true; api.focus();
    if (doc.file && doc.qa.length) return renderAnswer(false, true);
    if (doc.file) return showReady();
    showDrop(); preDragView = 'panel';
    const v = viewEl; v.querySelector('.dz-sub').textContent = 'Drag a file onto the notch — or choose one.';
  }

  let ansNubbi = null;
  function renderAnswer(streaming, rebuild) {
    if (view !== 'answer' || rebuild) {
      const v = show('answer', () => h(`<div><div class="card"><div class="info" style="min-width:0"><div class="headrow"><span class="ttl" id="aTitle"></span></div>
        <div class="sub" id="aSub"></div><div class="ans" id="ans"></div><div id="aFoot"></div></div></div></div>`));
      ansNubbi = Nubbi.create(52); bindNubbi(ansNubbi); v.firstChild.prepend(ansNubbi);
      v.querySelector('#ans').addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) { e.preventDefault(); api.openUrl(a.href); } });
    }
    const Q = (sel) => viewEl.querySelector(sel);
    const last = doc.qa[doc.qa.length - 1] || {};
    Q('#aTitle').textContent = doc.qa.length > 1 ? doc.qa[0].q : (last.q || '');
    Q('#aSub').textContent = subLine();
    const ans = Q('#ans');
    const stick = ans.scrollHeight - ans.scrollTop - ans.clientHeight < 40;
    ans.innerHTML = doc.qa.map((x, i) => `<div class="qa">${i > 0 || doc.qa.length > 1 ? `<div class="q">${esc(x.q)}</div>` : ''}<div class="md ${streaming && i === doc.qa.length - 1 ? 'caret' : ''}">${x.a ? window.renderMarkdown(x.a) : (streaming && i === doc.qa.length - 1 ? `<span class="line shimmer" style="display:inline-block">Reading ${esc(doc.file.name)}…</span>` : '')}</div></div>`).join('');
    // put the caret inside the last block element
    const md = ans.querySelector('.caret'); if (md && md.lastElementChild) { md.classList.remove('caret'); md.lastElementChild.classList.add('caret'); }
    if (stick || streaming) ans.scrollTop = ans.scrollHeight;
    ansNubbi.classList.toggle('bounce', !!streaming);
    ansNubbi.classList.toggle('thinking', !!streaming);
    const foot = Q('#aFoot');
    if (doc.err && !streaming) {
      foot.innerHTML = '';
      const e = doc.err; const p = prov(e.provider);
      const row = h('<div class="row errrow"></div>');
      if (e.keyUrl && ['NO_KEY', 'AUTH', 'RATE_LIMIT', 'NO_VISION', 'NO_TEXT', 'OFFLINE'].includes(e.code)) {
        const target = ['NO_VISION', 'NO_TEXT'].includes(e.code) && e.provider !== 'gemini' ? prov('gemini') : p;
        const g = h(`<button class="btn primary">${e.code === 'OFFLINE' && e.provider === 'ollama' ? 'Get Ollama ↗' : `Get a free ${esc(target.short)} key ↗`}</button>`);
        if (target.id === 'claude') g.textContent = 'Get a Claude key ↗';
        g.onclick = () => api.openUrl(e.keyUrl); row.appendChild(g);
      }
      if (e.provider !== 'free' && !['NO_VISION', 'NO_TEXT'].includes(e.code)) { const f = h('<button class="btn">Use Free instead</button>'); f.onclick = async () => { S = await api.setSettings({ provider: 'free' }); retry(); }; row.appendChild(f); }
      const t = h('<button class="btn">Try again</button>'); t.onclick = () => retry(); row.appendChild(t);
      const st = h('<button class="btn ghost">Settings</button>'); st.onclick = () => api.openSettings(); row.appendChild(st);
      foot.appendChild(row);
      const box = h('<div class="askbox" style="margin-top:8px"></div>'); box.appendChild(askField('Ask something else…', ask)); foot.appendChild(box);
      return;
    }
    if (streaming) {
      if (!foot.querySelector('.stop')) { foot.innerHTML = ''; const r = h('<div class="row"><button class="btn ghost stop">Stop</button></div>'); r.firstChild.onclick = () => api.stop(); foot.appendChild(r); }
    } else if (!foot.querySelector('.askbox')) {
      foot.innerHTML = '';
      const box = h('<div class="askbox"></div>');
      box.appendChild(askField('Continue…', ask));
      const copy = h('<button class="btn" title="Copy answer">Copy</button>');
      copy.onclick = async () => { await api.copy(doc.qa.map((x) => (doc.qa.length > 1 ? `Q: ${x.q}\n\n` : '') + x.a).join('\n\n---\n\n')); copy.textContent = 'Copied'; Sounds.play('tick'); setTimeout(() => (copy.textContent = 'Copy'), 1400); };
      const mail = h('<button class="btn" title="Email this answer">Email</button>');
      mail.onclick = () => { Sounds.play('boop'); api.mail({ to: S.email || '', subject: `Nubbi — ${doc.file.name}`, body: doc.qa.map((x) => `Q: ${x.q}\n\n${x.a}`).join('\n\n---\n\n') + `\n\n— sent from Nubbi` }); };
      const done = h('<button class="btn ghost">Done</button>'); done.onclick = () => { api.resetDoc(); doc.file = null; doc.qa = []; doc.lastView = null; collapse(); };
      box.append(copy, mail, done);
      foot.appendChild(box);
    }
  }
  function modelLabel(id, m) {
    const p = prov(id); const hit = (p.models || []).find(([mid]) => mid === m);
    return hit ? hit[1].replace(/\s*\(.*?\)\s*$/, '').replace(/\s+—.*$/, '') : (m || '').split('/').pop().replace(/:free$/, '');
  }
  function subLine() {
    const last = doc.qa[doc.qa.length - 1] || {};
    const id = last.provider || S.provider, m = last.model || (S.models || {})[id];
    return `${doc.file ? doc.file.name : ''} · ${prov(id).short}${m ? ' · ' + modelLabel(id, m) : ''}`;
  }
  function retry() {
    const last = doc.qa.pop(); doc.err = null; if (last) ask(last.q);
  }

  async function ask(q) {
    if (doc.busy || !doc.file) return;
    if (!S.ready) { doc.pendingQ = q; return showNoKey(); }
    doc.busy = true; doc.err = null;
    doc.qa.push({ q, a: '', provider: S.provider, model: (S.models || {})[S.provider] });
    renderAnswer(true, view !== 'answer');
    let pending = '', rafId = 0;
    const off = api.onDelta((t) => { pending += t; if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; doc.qa[doc.qa.length - 1].a += pending; pending = ''; renderAnswer(true); }); });
    const offS = api.onStatus(({ wait }) => {
      const md = viewEl && viewEl.querySelector('.qa:last-child .md');
      if (md && !doc.qa[doc.qa.length - 1].a) md.innerHTML = wait ? `<span class="line shimmer" style="display:inline-block">The free service is busy — waiting ${wait}s for a slot…</span>` : `<span class="line shimmer" style="display:inline-block">Reading ${esc(doc.file.name)}…</span>`;
    });
    const r = await api.ask(q).catch((e) => ({ ok: false, error: { code: 'SERVICE', message: clean(e) } }));
    cancelAnimationFrame(rafId); rafId = 0; off(); offS(); doc.busy = false;
    const cur = doc.qa[doc.qa.length - 1];
    if (r.ok) { cur.a = r.text; cur.model = r.model; pending = ''; Sounds.play('success'); }
    else if (r.error.code === 'NO_KEY') { doc.qa.pop(); doc.pendingQ = q; return showNoKey(); }
    else if (r.error.code === 'ABORTED') cur.a = (cur.a || '') + '\n\n*Stopped.*';
    else { cur.a = (cur.a ? cur.a + '\n\n' : '') + `**Couldn’t get an answer.** ${r.error.message}`; doc.err = r.error; Sounds.play('bonk'); }
    renderAnswer(false);
    setTimeout(() => { const i = viewEl && viewEl.querySelector('#aFoot input'); if (i) { api.focus(); i.focus(); } }, 60);
  }
  function showNoKey() {
    const p = prov();
    const v = show('nokey', () => h(`<div><div class="card"><div class="info"><div class="ttl">${esc(p.short)} needs a free API key</div>
      <div class="sub">Takes a minute. It’s stored encrypted in your Keychain.</div>
      <div class="keyrow"><input id="nkI" type="password" placeholder="Paste your ${esc(p.keyName || 'API key')}" spellcheck="false"><button class="btn primary" id="nkSave">Save</button></div>
      <div class="row"><button class="btn" id="nkG">Get a free ${esc(p.short)} key ↗</button><button class="btn" id="nkF">Use Free (no key)</button><button class="btn ghost" id="nkC">Not now</button></div></div></div></div>`));
    if (p.id === 'claude') v.querySelector('#nkG').textContent = 'Get a Claude key ↗';
    const m = Nubbi.create(56); bindNubbi(m); v.firstChild.prepend(m);
    const inp = v.querySelector('#nkI');
    inp.addEventListener('pointerdown', () => api.focus()); inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') v.querySelector('#nkSave').click(); });
    v.querySelector('#nkSave').onclick = async () => { const k = inp.value.trim(); if (!k) return inp.focus(); S = await api.setSettings({ keys: { [p.id]: k } }); Sounds.play('chime'); afterKey(); };
    v.querySelector('#nkG').onclick = () => api.openUrl(p.keyUrl);
    v.querySelector('#nkF').onclick = async () => { S = await api.setSettings({ provider: 'free' }); afterKey(); };
    v.querySelector('#nkC').onclick = () => collapse();
    setTimeout(() => { api.focus(); inp.focus(); }, 80);
  }
  function afterKey() { if (!doc.file) return collapse(); if (doc.pendingQ) { const q = doc.pendingQ; doc.pendingQ = null; return ask(q); } doc.qa.length ? renderAnswer(false, true) : showReady(); }
  function showError(msg) {
    Sounds.play('bonk');
    const v = show('error', () => h(`<div><div class="card error"><div class="info"><div class="ttl">Hmm, that didn’t work</div><div class="sub" style="white-space:normal">${esc(msg)}</div>
      <div class="row"><button class="btn" id="erO">OK</button></div></div></div></div>`));
    const m = Nubbi.create(56, 'squint'); bindNubbi(m); v.firstChild.prepend(m);
    v.querySelector('#erO').onclick = () => collapse();
  }

  // ---------------------------------------------------------------- hover / click / focus
  let hovering = false, hoverT = 0, leaveT = 0;
  api.onCursor(({ x, y, inside }) => {
    Nubbi.follow(x, y);
    if (inside !== hovering) {
      hovering = inside;
      clearTimeout(hoverT); clearTimeout(leaveT);
      if (inside && mode !== 'big' && S.peekOnHover !== false) hoverT = setTimeout(() => { if (hovering && mode !== 'big') openPanel(false); }, 140);
      if (!inside && mode === 'big' && !pinned && view !== 'peek' && view !== 'dizzy' && view !== 'drop' && !doc.busy) leaveT = setTimeout(() => { if (!hovering && !pinned && mode === 'big' && !activeSessions().some((s) => s.state === 'permission')) collapse(); }, 650);
    }
  });
  island.addEventListener('pointerdown', () => {
    if (mode !== 'big') { pinned = true; api.focus(); doc.lastView && doc.file ? (doc.qa.length ? renderAnswer(false, true) : showReady()) : openPanel(true); return; }
    if (!pinned) { pinned = true; api.focus(); }
  });
  api.onToggle(({ open, blur }) => {
    if (blur) { if (mode === 'big' && pinned && view !== 'dizzy' && view !== 'drop' && view !== 'upload' && !doc.busy && !activeSessions().some((s) => s.state === 'permission')) collapse(); else pinned = false; return; }
    if (open === 'toggle' ? mode === 'big' && view !== 'peek' : open === false) return collapse();
    pinned = true; api.focus();
    if (doc.file && doc.lastView) doc.qa.length ? renderAnswer(false, true) : showReady(); else openPanel(true);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return collapse();
    if (view !== 'panel') return;
    const s = activeSessions().find((x) => x.state === 'permission');
    if (!s) return;
    const k = e.key.toLowerCase();
    if (k === 'y') decide(s, 'allow'); else if (k === 'n') decide(s, 'deny'); else if (k === 'a') decide(s, 'always');
  });

  // ---------------------------------------------------------------- settings / boot
  function applySettings(s) { S = s; if (s.brand) BRAND = s.brand; document.body.dataset.color = s.color || 'mint'; Nubbi.setColor && Nubbi.setColor(s.color || 'mint'); Sounds.setMuted(!s.sound); if (view === 'panel') renderPanel(); updateTop(); }
  api.onSettings((s) => { applySettings(s); api.hooksStatus().then((st) => { hooksInstalled = !!st.installed; if (view === 'panel') renderPanel(); }); });
  api.onGeometry(applyGeometry);
  api.onHook(onHook);

  // test/screenshot driver (only used when NUBBI_SCREENSHOT is set)
  api.onDemo(async (c) => {
    if (c.cmd === 'peek') peek();
    if (c.cmd === 'peekFreeze') { peek(); setTimeout(() => { const m = viewEl.querySelector('.nubbi'); m.classList.add('look-l'); }, 700); }
    if (c.cmd === 'open') openPanel(true);
    if (c.cmd === 'collapse') collapse(false);
    if (c.cmd === 'drag') showDrop();
    if (c.cmd === 'picker') { const chip = viewEl && viewEl.querySelector('.chip'); if (chip) togglePicker(chip); }
    if (c.cmd === 'nokey') showNoKey();
    if (c.cmd === 'upload') startUpload(c.path, c.name);
    if (c.cmd === 'ask') ask(c.q);
    if (c.cmd === 'clicks') { const m = viewEl.querySelector('.nubbi'); for (let i = 0; i < c.n; i++) { m.click(); await new Promise((r) => setTimeout(r, 90)); } }
    if (c.cmd === 'cursor') Nubbi.follow(c.x, c.y);
    if (c.cmd === 'freezeUpload') uploadSeq++;
  });

  (async () => {
    applyGeometry(G);
    CAT = await api.providers();
    applySettings(await api.getSettings());
    try { hooksInstalled = !!(await api.hooksStatus()).installed; } catch {}
    paint();
    setTimeout(peek, 600); // say hi on launch
  })();
})();
