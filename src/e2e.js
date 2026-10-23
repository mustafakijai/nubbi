// End-to-end probe (only loaded when NUBBI_E2E=<logfile>): logs the notch's view + drag state as JSON lines
// so the Xvfb drag test can assert what happened. Inert in normal use.
const fs = require('fs');
exports.run = ({ notch, ENV, getState, settings, broadcastSettings }) => {
  const file = ENV('E2E'); let last = '';
  const log = (o) => fs.appendFileSync(file, JSON.stringify({ t: Date.now(), ...o }) + '\n');
  log({ ev: 'start' });
  notch.webContents.once('did-finish-load', () => notch.webContents.executeJavaScript(`window.__e2e = [];
    for (const t of ['dragenter', 'dragover', 'dragleave', 'drop']) window.addEventListener(t, (e) => { const k = t + ':' + [...(e.dataTransfer ? e.dataTransfer.types : [])].join(',');
      if (window.__e2e[window.__e2e.length - 1] !== k) window.__e2e.push(k); }, true);
    if (window.Sounds) { const p0 = window.Sounds.play.bind(window.Sounds); window.Sounds.play = (n) => { if (!window.Sounds.muted) window.__e2e.push({ snd: n, t: Date.now() }); return p0(n); }; }`).catch(() => {}));
  // Director channel (ads / demo recording): JSON lines on stdin -> {id, settings} | {id, demo} | {id, eval}; replies "@@{id,result}" on stdout.
  let inBuf = '';
  process.stdin.on('data', (d) => {
    inBuf += d; let i;
    while ((i = inBuf.indexOf('\n')) >= 0) {
      const line = inBuf.slice(0, i).trim(); inBuf = inBuf.slice(i + 1); if (!line) continue;
      let c; try { c = JSON.parse(line); } catch { continue; }
      (async () => {
        let result = null;
        try {
          if (c.settings) { settings.patch(c.settings); broadcastSettings(); result = true; }
          if (c.demo) { notch.webContents.send('demo', c.demo); result = true; }
          if (c.eval) result = await notch.webContents.executeJavaScript(c.eval, true);
          if (c.bounds) result = notch.getBounds();
        } catch (e) { result = { error: String(e) }; }
        process.stdout.write('@@' + JSON.stringify({ id: c.id, result }) + '\n');
      })();
    }
  });
  setInterval(async () => { const ev = await notch.webContents.executeJavaScript('window.__e2e ? window.__e2e.splice(0) : []').catch(() => []); for (const e of ev) log(typeof e === 'string' ? { dom: e } : e); }, 100);
  setInterval(async () => {
    if (notch.isDestroyed()) return;
    const dom = await notch.webContents.executeJavaScript(`(() => { const v = document.querySelector('#content > .view:not(.out)');
      return { view: v ? [...v.classList].filter(c => c !== 'view')[0] : null, over: document.body.classList.contains('over'), osdrag: document.body.classList.contains('osdrag'),
        title: (v && (v.querySelector('.ttl') || v.querySelector('.dz-title') || {}).textContent) || '' }; })()`).catch(() => ({}));
    const st = getState(); const { screen } = require('electron'); const snap = { ...dom, cur: screen.getCursorScreenPoint(), b: notch.getBounds(), osDrag: st.osDrag, magnet: st.magnetOn, ignoring: st.ignoring, hit: st.hitRect };
    const key = JSON.stringify(snap);
    if (key !== last) { last = key; log(snap); }
  }, 50);
};
exports.mail = (ENV, m) => require('fs').appendFileSync(ENV('E2E'), JSON.stringify({ t: Date.now(), mail: m }) + '\n');
