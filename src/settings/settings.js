(() => {
  const api = window.nubbi, $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const m = Nubbi.create(54); $('hm').appendChild(m);
  m.addEventListener('click', () => { m.classList.add('squint'); setTimeout(() => m.classList.remove('squint'), 220); });
  document.addEventListener('mousemove', (e) => Nubbi.follow(e.clientX, e.clientY));
  let S;

  let CAT = [], cur = null;
  const COLORS = { mint: '#8debc8', peach: '#ffb898', lilac: '#c3b0ff', sky: '#97d4ff', snow: '#eef1f6' };
  const kbd = (sc) => sc.split('+').map((k) => `<kbd>${{ Control: '⌃ Control', Alt: '⌥ Option', Space: 'Space', Shift: '⇧ Shift' }[k] || k}</kbd>`).join('');
  async function load() {
    S = await api.getSettings();
    CAT = await api.providers();
    document.body.dataset.color = S.color || 'mint';
    $('ver').textContent = 'v' + S.version;
    $('email').value = S.email || '';
    $('sound').checked = !!S.sound; $('peek').checked = S.peekOnHover !== false;
    $('nw').value = S.notchWidth || 0; nwLabel();
    $('sc').innerHTML = kbd(S.shortcut); $('sc2').innerHTML = kbd(S.pickShortcut || 'Control+Alt+O');
    $('colors').innerHTML = Object.entries(COLORS).map(([k, c]) => `<button class="swatch ${k === S.color ? 'on' : ''}" data-c="${k}" title="${k}" style="background:${c}"></button>`).join('');
    $('colors').querySelectorAll('.swatch').forEach((b) => (b.onclick = async () => { await save({ color: b.dataset.c }); document.body.dataset.color = b.dataset.c; $('colors').querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b)); }));
    renderProviders(); renderPills(); renderRules(); hooks();
  }
  function renderProviders() {
    $('provs').innerHTML = CAT.map((p) => {
      const has = S.hasKey[p.id];
      const badge = p.id === 'free' ? 'No key' : p.id === 'ollama' ? 'Local' : has ? 'Key saved' : p.id === 'claude' ? 'Paid key' : 'Free key';
      return `<button class="prov ${p.id === S.provider ? 'on' : ''}" data-id="${p.id}"><b>${esc(p.short)}</b><small class="${has || p.id === 'free' ? 'good' : ''}">${badge}</small></button>`;
    }).join('');
    $('provs').querySelectorAll('.prov').forEach((b) => (b.onclick = async () => { await save({ provider: b.dataset.id }); renderProviders(); }));
    showProvider(CAT.find((p) => p.id === S.provider) || CAT[0]);
  }
  async function showProvider(p, fresh) {
    cur = p;
    $('pNote').textContent = p.note;
    const keyed = p.needsKey || p.optionalKey;
    $('keyItem').hidden = !keyed; $('keyLinkRow').hidden = !keyed;
    $('ollamaRow').hidden = p.id !== 'ollama';
    if (keyed) {
      $('keyTitle').textContent = p.keyName || 'API key';
      $('keySub').textContent = (p.optionalKey ? 'Optional — unlocks image reading and higher limits. ' : '') + (S.encrypted ? 'Stored encrypted in your macOS Keychain.' : 'Stored locally (Keychain unavailable).');
      $('key').value = ''; $('key').placeholder = S.hasKey[p.id] ? `Saved (${S.keyHint[p.id]})` : 'Paste key';
      $('keyDel').hidden = !S.hasKey[p.id];
      $('keyLink').textContent = p.id === 'claude' ? 'Get a Claude key ↗' : p.optionalKey ? 'Get a free key (optional) ↗' : `Get a free ${p.short} key ↗`;
      $('keyLinkTxt').textContent = p.id === 'claude' ? 'console.anthropic.com → API keys (billed to your account).' : `Free, about a minute: ${p.keyUrl.replace('https://', '')}`;
    }
    const sel = $('model');
    const fill = (models, def) => {
      const want = (S.models || {})[p.id] || def;
      sel.innerHTML = models.map(([id, l]) => `<option value="${esc(id)}">${esc(l)}</option>`).join('') || '<option value="">(no models found)</option>';
      if (want && !models.some(([id]) => id === want)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(want)}">${esc(want)}</option>`);
      sel.value = want || '';
    };
    fill(p.models || [], p.def);
    $('modelSub').textContent = p.id === 'openrouter' ? 'Only free (“:free”) models are listed.' : 'Used for questions about dropped files.';
    if (['ollama', 'openrouter', 'groq'].includes(p.id)) {
      if (p.id === 'ollama') { $('olUrl').value = S.ollamaUrl || ''; $('olSub').textContent = 'Looking for Ollama on this Mac…'; }
      const r = await api.models(p.id, fresh).catch((e) => ({ error: e.message }));
      if (cur !== p || !r) return;
      if (r.models && r.models.length) fill(r.models, r.def);
      if (p.id === 'ollama') $('olSub').innerHTML = r.available ? `Found Ollama — ${r.models.length} model${r.models.length === 1 ? '' : 's'} installed.` : `${esc(r.error || 'Not running.')} <a href="https://ollama.com/download" target="_blank">Get Ollama</a>, then “ollama pull gemma4”.`;
      else if (r.error) $('modelSub').textContent = 'Couldn’t refresh the list: ' + r.error;
    }
  }
  function nwLabel() { const v = +$('nw').value; $('nwLabel').textContent = v ? `${v} pt` : 'Auto (fits your MacBook’s notch)'; }
  const save = (p) => api.setSettings(p).then((s) => { S = { ...S, ...s }; });

  $('keySave').onclick = async () => { const v = $('key').value.trim(); if (!v || !cur) return; await save({ keys: { [cur.id]: v } }); renderProviders(); };
  $('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('keySave').click(); });
  $('keyDel').onclick = async () => { if (!cur) return; await save({ clearKey: cur.id }); renderProviders(); };
  $('keyLink').onclick = () => cur && api.openUrl(cur.keyUrl);
  $('model').onchange = () => cur && save({ models: { [cur.id]: $('model').value } });
  $('modelRefresh').onclick = (e) => { e.preventDefault(); cur && showProvider(cur, true); };
  $('olScan').onclick = async () => { await save({ ollamaUrl: $('olUrl').value.trim() }); $('olUrl').value = S.ollamaUrl; showProvider(cur, true); };
  $('email').onchange = () => save({ email: $('email').value.trim() });
  $('sound').onchange = () => save({ sound: $('sound').checked });
  $('peek').onchange = () => save({ peekOnHover: $('peek').checked });
  $('nw').oninput = nwLabel;
  $('nw').onchange = () => save({ notchWidth: +$('nw').value < 120 ? 0 : +$('nw').value });

  function renderPills() {
    $('pills').innerHTML = S.shortcuts.map((p, i) => `<div class="prow" data-i="${i}"><input type="color" value="${esc(p.color)}"><input type="text" value="${esc(p.label)}" maxlength="18"><input type="url" value="${esc(p.url)}" placeholder="https://"></div>`).join('');
    $('pills').querySelectorAll('input').forEach((inp) => (inp.onchange = () => {
      const rows = [...$('pills').querySelectorAll('.prow')].map((r) => { const [c, l, u] = r.querySelectorAll('input'); return { color: c.value, label: l.value, url: u.value }; });
      save({ shortcuts: rows }).then(renderPills);
    }));
  }
  function renderRules() {
    const rules = S.rules || [];
    $('rules').innerHTML = rules.length ? rules.map((r, i) => { const [cwd, tool, what] = r.split('\u0000'); return `<li><span class="proj">${esc((cwd || '').split('/').pop() || '—')}</span><code title="${esc(what || tool)}">${esc(tool === 'Bash' ? what : tool)}</code><button class="btn ghost" data-i="${i}">Remove</button></li>`; }).join('') : '<li class="empty">Nothing yet.</li>';
    $('rules').querySelectorAll('button').forEach((b) => (b.onclick = async () => { await api.removeRule(rules[+b.dataset.i]); S = await api.getSettings(); renderRules(); }));
  }
  async function hooks(msg) {
    const st = await api.hooksStatus();
    $('hkTitle').innerHTML = st.installed ? '<span class="ok-dot"></span>Connected' : '<span class="off-dot"></span>Not connected';
    $('hkSub').textContent = st.error ? st.error : st.installed ? `${st.events.length} hooks in ${st.settings}` : `Adds hooks to ${st.settings} (backed up first, merged — nothing else changes).`;
    $('hkInstall').textContent = st.installed ? 'Reinstall' : 'Install hooks';
    $('hkRemove').hidden = !st.installed;
    $('hkMsgRow').hidden = !msg; $('hkMsg').textContent = msg || '';
  }
  $('hkInstall').onclick = async () => { const r = await api.hooksInstall(); hooks(r.ok ? (r.changed ? `Installed. Backup saved to ${r.backup || '(new file, nothing to back up)'}. Start a new Claude Code session to see it in the notch.` : 'Already up to date.') : `Couldn’t install: ${r.error}`); };
  $('hkRemove').onclick = async () => { const r = await api.hooksUninstall(); hooks(r.ok ? 'Removed Nubbi’s hooks. Your other hooks were left untouched.' : `Couldn’t remove: ${r.error}`); };
  api.onSettings(() => api.getSettings().then((s) => { S = s; renderRules(); renderProviders(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.closeSettings(); });
  load();
})();
