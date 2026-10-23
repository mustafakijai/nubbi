// Nubbi by Nexora — a notch buddy for Claude Code and your files. https://github.com/mustafakijai/nubbi (MIT)
const { app, BrowserWindow, ipcMain, shell, clipboard, screen, Tray, Menu, nativeImage, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const settings = require('./settings');
const installer = require('./hooks/installer');
const { HookServer } = require('./hooks/server');
const { prepareFile } = require('./files');
const providers = require('./providers');
const { DragWatch, inMagnet } = require('./dragwatch');
const brand = require('./brand.json');

const isMac = process.platform === 'darwin';
const ENV = (k) => process.env[`${brand.envPrefix}_${k}`] || '';
const SHOT = ENV('SCREENSHOT');
const HOME = ENV('HOME') || os.homedir();
const HOOK_DIR = path.join(HOME, brand.hookDir);
const SRC_SCRIPT = path.join(__dirname, 'hooks', brand.hookScript);
const W = 780, H = 660;
const SHORTCUT = 'Control+Alt+Space';
const PICK_SHORTCUT = 'Control+Alt+O';
app.setName(brand.name);

// ---------- CLI: --install-hooks / --uninstall-hooks (used by install.sh) ----------
const cli = process.argv.find((a) => a === '--install-hooks' || a === '--uninstall-hooks' || a === '--hooks-status');
if (cli) {
  try {
    let r;
    if (cli === '--install-hooks') r = installer.install({ home: HOME, srcScript: SRC_SCRIPT });
    else if (cli === '--uninstall-hooks') r = installer.uninstall({ home: HOME });
    else r = installer.status({ home: HOME });
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(0);
  } catch (e) { process.stderr.write(`${brand.name}: ${e.message}\n`); process.exit(1); }
}

if (!SHOT && !ENV('E2E') && !app.requestSingleInstanceLock()) { app.quit(); }
if (SHOT || ENV('E2E')) { app.commandLine.appendSwitch('force-device-scale-factor', '2'); app.setPath('userData', path.join(HOME, 'userData')); }

let notch, settingsWin, tray, hookServer;
let hitRect = { x: 0, y: 0, w: 0, h: 0 };
let ignoring = true;

function targetDisplay() {
  const ds = screen.getAllDisplays();
  return ds.find((d) => d.internal) || screen.getPrimaryDisplay();
}
function geometry() {
  const d = targetDisplay();
  const menuBar = Math.max(0, d.workArea.y - d.bounds.y);
  const fake = process.env.NUBBI_FAKE_NOTCH === '1'; // screenshots on Linux
  const hasNotch = fake || (isMac && !!d.internal && menuBar >= 30); // notched MacBooks have a ~37–38 pt menu bar
  const s = settings.read();
  return {
    hasNotch,
    notchW: s.notchWidth || (hasNotch ? 185 : 196),
    notchH: fake ? 37 : hasNotch ? menuBar : 32,
    bounds: { x: Math.round(d.bounds.x + (d.bounds.width - W) / 2), y: d.bounds.y, width: W, height: H },
    platform: process.platform,
  };
}

function createNotch() {
  const g = geometry();
  notch = new BrowserWindow({
    ...g.bounds,
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    roundedCorners: false, enableLargerThanScreen: true, backgroundColor: '#00000000',
    ...(isMac ? { type: 'panel' } : {}),
    title: brand.name,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  notch.setAlwaysOnTop(true, 'screen-saver');
  notch.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  notch.setIgnoreMouseEvents(true, { forward: true });
  notch.loadFile(path.join(__dirname, 'notch', 'notch.html'), { query: { g: JSON.stringify(g) } });
  notch.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  notch.webContents.on('will-navigate', (e) => e.preventDefault());
  notch.once('ready-to-show', () => {
    notch.showInactive();
    notch.setBounds(g.bounds); // macOS may nudge a window below the menu bar on first show
  });
  notch.on('blur', () => notch.webContents.send('toggle', { blur: true }));
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  startCursorLoop();
}

function reposition() {
  if (!notch) return;
  const g = geometry();
  notch.setBounds(g.bounds);
  notch.webContents.send('geometry', g);
}

// Click-through except where UI is: poll the cursor (~30 Hz) and toggle mouse capture.
// The renderer reports hitRect = island + a margin, so the strip around the notch is always hit-testable.
// While an OS drag is in progress (DragWatch), a wider "magnet" band under the notch also captures, so
// macOS delivers the drag session to our window instead of the app underneath.
let osDrag = false, magnetOn = false, dragWatch = null;
function startCursorLoop() {
  let last = '';
  setInterval(() => {
    if (!notch || notch.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = notch.getBounds();
    const x = p.x - b.x, y = p.y - b.y;
    const inHit = x >= hitRect.x && x <= hitRect.x + hitRect.w && y >= hitRect.y && y <= hitRect.y + hitRect.h;
    const magnet = osDrag && inMagnet(x, y, b.width);
    if (magnet !== magnetOn) { magnetOn = magnet; if (magnet) notch.webContents.send('os-drag', { active: true, near: true }); }
    const capture = inHit || magnet || (osDrag && magnetOn);
    if (capture === ignoring) { ignoring = !capture; notch.setIgnoreMouseEvents(ignoring, { forward: true }); }
    const key = `${x},${y}`;
    if (key !== last) { last = key; notch.webContents.send('cursor', { x, y, inside: inHit }); }
  }, 33);
}
function startDragWatch() {
  if (ENV('NO_DRAGWATCH')) return;
  dragWatch = new DragWatch();
  dragWatch.on('ready', () => console.log('dragwatch: ready'));
  dragWatch.on('exit', (c) => console.warn('dragwatch: helper exited', c));
  dragWatch.start();
  dragWatch.on('drag', (active) => {
    console.log('dragwatch:', active ? 'drag started' : 'drag ended');
    osDrag = active;
    if (!active) { magnetOn = false; if (notch) notch.webContents.send('os-drag', { active: false }); }
  });
}

// ---------- tray ----------
function trayMenu() {
  const s = settings.read();
  const st = installer.status({ home: HOME });
  return Menu.buildFromTemplate([
    { label: `Open ${brand.name}`, accelerator: SHORTCUT, click: () => toggleNotch(true) },
    { label: 'Ask about a file…', accelerator: PICK_SHORTCUT, click: () => pickAndAsk() },
    { label: 'Settings…', accelerator: 'CommandOrControl+,', click: openSettings },
    { type: 'separator' },
    { label: 'Mute sounds', type: 'checkbox', checked: !s.sound, click: (i) => { settings.patch({ sound: !i.checked }); broadcastSettings(); } },
    st.installed
      ? { label: 'Claude Code hooks: on', enabled: false }
      : { label: 'Connect Claude Code…', click: () => doInstallHooks(true) },
    { type: 'separator' },
    { label: `About ${brand.name}`, click: showAbout },
    { label: `Quit ${brand.name}`, accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ]);
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip(`${brand.trayTooltip} — drop a file here to ask about it`);
  const refresh = () => tray.setContextMenu(trayMenu());
  refresh();
  tray.on('mouse-enter', refresh);
  // macOS: files dropped on the menu-bar icon go straight to the notch (fallback when the notch is hard to hit).
  tray.on('drop-files', (_e, files) => { if (files && files[0]) sendFile(files[0]); });
  tray.on('drag-enter', () => toggleNotch(true));
  return refresh;
}

function sendFile(p) { if (notch && p) notch.webContents.send('external-file', { path: p, name: path.basename(p) }); }
async function pickFile() {
  if (isMac) app.focus({ steal: true });
  const r = await dialog.showOpenDialog({ title: 'Ask Nubbi about a file', properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'csv', 'json', 'docx', 'pptx', 'xlsx', 'odt', 'rtf', 'html', 'js', 'ts', 'py'] }, { name: 'All files', extensions: ['*'] }] });
  return r.canceled ? null : r.filePaths[0];
}
async function pickAndAsk() { const p = await pickFile(); if (p) sendFile(p); }
function showAbout() {
  dialog.showMessageBox({ message: `${brand.displayName} ${app.getVersion()}`, detail: `${brand.tagline}.\n\nCopyright ${brand.copyright}. Free and open source (MIT).\n${brand.repo.replace('https://', '')}`, buttons: ['OK', 'Open on GitHub', 'Licenses'] })
    .then((r) => { if (r.response === 1) shell.openExternal(brand.repo); else if (r.response === 2) shell.openPath(path.join(process.resourcesPath, 'LICENSE.txt')); });
}
function toggleNotch(open) { if (notch) notch.webContents.send('toggle', { open: open !== undefined ? open : 'toggle' }); }

// ---------- settings window ----------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); if (isMac) app.focus({ steal: true }); return settingsWin; }
  settingsWin = new BrowserWindow({
    width: 620, height: 760, minWidth: 560, minHeight: 560, show: false, title: `${brand.name} — Settings`,
    backgroundColor: '#111114', titleBarStyle: isMac ? 'hiddenInset' : 'default', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings', 'settings.html'));
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWin.once('ready-to-show', () => { settingsWin.show(); if (isMac) app.focus({ steal: true }); });
  return settingsWin;
}
function broadcastSettings() {
  const v = settings.publicView();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings-changed', v);
  if (notch) reposition();
}

function doInstallHooks(fromTray) {
  try {
    const r = installer.install({ home: HOME, srcScript: SRC_SCRIPT });
    if (fromTray) dialog.showMessageBox({ message: 'Claude Code is connected', detail: `Hooks added to ${r.settings}${r.backup ? `\nBackup: ${r.backup}` : ''}${r.migrated ? `\nRemoved ${r.migrated} old hook entr${r.migrated === 1 ? 'y' : 'ies'} from ${r.legacyNames.join(', ')}.` : ''}\n\nStart a new Claude Code session to see it in the notch.` });
    return { ok: true, ...r, status: installer.status({ home: HOME }) };
  } catch (e) {
    if (fromTray) dialog.showErrorBox(`${brand.name} couldn’t install the hooks`, e.message);
    return { ok: false, error: e.message, status: installer.status({ home: HOME }) };
  }
}

// ---------- hook server ----------
async function startHookServer() {
  installer.installScript(SRC_SCRIPT, HOME); // keep the relay script fresh
  try { if (installer.status({ home: HOME }).legacy > 0) { const r = doInstallHooks(false); console.log('migrated legacy hooks:', r.migrated, r.backup); } } catch {}
  hookServer = new HookServer({ dir: HOOK_DIR, rules: settings.read().rules || [] });
  hookServer.on('event', (ev) => notch && notch.webContents.send('hook', ev));
  hookServer.on('resolved', (r) => notch && notch.webContents.send('hook-resolved', r));
  hookServer.on('rules', (rules) => { settings.patch({ rules }); broadcastSettings(); });
  await hookServer.start();
}

// ---------- IPC ----------
ipcMain.on('notch:hit', (_e, r) => { if (r && typeof r.x === 'number') hitRect = r; });
ipcMain.on('notch:focus', () => { if (!notch) return; if (isMac) app.focus({ steal: true }); notch.focus(); });
ipcMain.on('notch:blur', () => { if (notch && notch.isFocused()) notch.blur(); });
ipcMain.handle('perm:decide', (_e, id, d) => (hookServer ? hookServer.decide(id, d) : false));
ipcMain.handle('term:open', (_e, meta = {}) => {
  if (!isMac) return false;
  const byTerm = { Apple_Terminal: 'Terminal', 'iTerm.app': 'iTerm', vscode: 'Visual Studio Code', WarpTerminal: 'Warp', ghostty: 'Ghostty', WezTerm: 'WezTerm', Hyper: 'Hyper', Tabby: 'Tabby' };
  if (meta.bundle && /^[\w.-]+$/.test(meta.bundle)) execFile('open', ['-b', meta.bundle]);
  else execFile('open', ['-a', byTerm[meta.term] || 'Terminal']);
  return true;
});
ipcMain.handle('url:open', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });
ipcMain.handle('settings:open', () => { openSettings(); });
ipcMain.on('settings:close', () => settingsWin && settingsWin.close());
ipcMain.handle('settings:get', () => ({ ...settings.publicView(), shortcut: SHORTCUT, pickShortcut: PICK_SHORTCUT, version: app.getVersion(), brand }));
ipcMain.handle('settings:set', (_e, p) => { settings.patch(p || {}); broadcastSettings(); return settings.publicView(); });
ipcMain.handle('providers:catalog', () => providers.catalog());
const modelCache = {};
ipcMain.handle('providers:models', async (_e, id, fresh) => {
  if (!providers.PROVIDERS[id]) return null;
  if (!fresh && modelCache[id] && Date.now() - modelCache[id].t < 5 * 60e3) return modelCache[id].v;
  const s = settings.read();
  const v = await providers.listModels(id, { key: s.keys[id], ollamaUrl: s.ollamaUrl });
  modelCache[id] = { t: Date.now(), v };
  return v;
});
ipcMain.handle('hooks:status', () => installer.status({ home: HOME }));
ipcMain.handle('hooks:install', () => doInstallHooks(false));
ipcMain.handle('hooks:uninstall', () => { try { return { ok: true, ...installer.uninstall({ home: HOME }), status: installer.status({ home: HOME }) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('rules:remove', (_e, rule) => { if (hookServer) hookServer.rules.delete(rule); settings.patch({ rules: (settings.read().rules || []).filter((r) => r !== rule) }); broadcastSettings(); return true; });

// Dropped file -> prepared once, kept in main (base64 never round-trips through the renderer).
let doc = null; let currentAbort = null;
ipcMain.handle('file:prepare', async (e, p) => {
  doc = null;
  const f = await prepareFile(p, (v) => e.sender.send('file:progress', v));
  doc = { ...f, path: p, history: [] };
  return { name: f.name, size: f.size, kind: f.kind, pages: f.pages, hasText: !!f.text };
});
ipcMain.handle('file:pick', () => pickFile());
ipcMain.handle('doc:reset', () => { doc = null; if (currentAbort) currentAbort.abort(); return true; });
ipcMain.handle('ai:ask', async (e, question) => {
  const s = settings.read();
  if (!doc) return { ok: false, error: { code: 'NO_FILE', message: 'Drop a file first.' } };
  const id = s.provider;
  currentAbort = new AbortController();
  try {
    let model = s.models[id];
    if (id === 'ollama' && (!model || !(modelCache.ollama && modelCache.ollama.v.visionIds))) {
      const v = await providers.listModels('ollama', { ollamaUrl: s.ollamaUrl }); modelCache.ollama = { t: Date.now(), v };
      if (!v.available) throw new providers.ProviderError('OFFLINE', 'Ollama isn’t running — open the Ollama app (or run “ollama serve”) and try again.', { provider: 'ollama', keyUrl: providers.PROVIDERS.ollama.keyUrl });
      if (!model || !v.models.some(([m]) => m === model)) model = v.def;
    }
    const cache = modelCache[id] && modelCache[id].v;
    const r = await providers.ask({
      provider: id, model, key: s.keys[id], ollamaUrl: s.ollamaUrl, visionIds: cache && cache.visionIds,
      doc, history: doc.history, question, signal: currentAbort.signal,
      onDelta: (t) => e.sender.send('ai:delta', t), onStatus: (st) => e.sender.send('ai:status', st),
    });
    doc.history.push({ q: question, a: r.text });
    return { ok: true, text: r.text, model: r.model, provider: id };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: { code: 'ABORTED', message: 'Stopped.' } };
    const j = err instanceof providers.ProviderError ? err.toJSON() : { code: 'SERVICE', message: err.message };
    return { ok: false, error: { ...j, provider: j.provider || id } };
  } finally { currentAbort = null; }
});
ipcMain.handle('ai:stop', () => { if (currentAbort) currentAbort.abort(); return true; });
ipcMain.handle('mail:open', (_e, { to, subject, body }) => {
  const max = 7000;
  const b = body.length > max ? body.slice(0, max) + '\n\n…(truncated — the full answer is on your clipboard)' : body;
  if (body.length > max) clipboard.writeText(body);
  if (ENV('E2E')) return require('./e2e').mail(ENV, { to, subject, body: b }); // recorded instead of opening a mail app
  return shell.openExternal(`mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`);
});
ipcMain.handle('clip:copy', (_e, t) => { clipboard.writeText(String(t)); return true; });

// ---------- lifecycle ----------
app.on('second-instance', () => toggleNotch(true));
app.whenReady().then(async () => {
  if (isMac && app.dock) app.dock.hide();
  try { await startHookServer(); } catch (e) { console.error('hook server:', e.message); }
  createNotch();
  createTray();
  startDragWatch();
  if (!SHOT && !globalShortcut.register(SHORTCUT, () => toggleNotch())) console.warn('shortcut taken:', SHORTCUT);
  if (!SHOT && !globalShortcut.register(PICK_SHORTCUT, () => pickAndAsk())) console.warn('shortcut taken:', PICK_SHORTCUT);
  if (ENV('E2E')) require('./e2e').run({ notch, ENV, settings, broadcastSettings, getState: () => ({ osDrag, magnetOn, ignoring, hitRect }) });
  if (SHOT) require('./demo').run({ notch, openSettings, trayMenu, hookServer, HOME, settings, broadcastSettings, out: SHOT });
});
app.on('window-all-closed', (e) => e.preventDefault && e.preventDefault()); // live in the menu bar
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (hookServer) hookServer.stop(); if (dragWatch) dragWatch.stop(); });
