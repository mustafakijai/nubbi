const { contextBridge, ipcRenderer, webUtils } = require('electron');
const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
contextBridge.exposeInMainWorld('nubbi', {
  platform: process.platform,
  // notch window
  hit: (r) => ipcRenderer.send('notch:hit', r),
  focus: () => ipcRenderer.send('notch:focus'),
  blur: () => ipcRenderer.send('notch:blur'),
  onHook: on('hook'), onCursor: on('cursor'), onToggle: on('toggle'), onGeometry: on('geometry'),
  onSettings: on('settings-changed'), onResolved: on('hook-resolved'), onDemo: on('demo'), onFileProgress: on('file:progress'), onDelta: on('ai:delta'), onStatus: on('ai:status'),
  onOsDrag: on('os-drag'), onExternalFile: on('external-file'),
  decide: (id, d) => ipcRenderer.invoke('perm:decide', id, d),
  openTerminal: (meta) => ipcRenderer.invoke('term:open', meta),
  openUrl: (u) => ipcRenderer.invoke('url:open', u),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  pathFor: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  pick: () => ipcRenderer.invoke('file:pick'),
  prepare: (p) => ipcRenderer.invoke('file:prepare', p),
  ask: (q) => ipcRenderer.invoke('ai:ask', q),
  stop: () => ipcRenderer.invoke('ai:stop'),
  resetDoc: () => ipcRenderer.invoke('doc:reset'),
  mail: (m) => ipcRenderer.invoke('mail:open', m),
  copy: (t) => ipcRenderer.invoke('clip:copy', t),
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  hooksInstall: () => ipcRenderer.invoke('hooks:install'),
  hooksUninstall: () => ipcRenderer.invoke('hooks:uninstall'),
  removeRule: (r) => ipcRenderer.invoke('rules:remove', r),
  providers: () => ipcRenderer.invoke('providers:catalog'),
  models: (id, fresh) => ipcRenderer.invoke('providers:models', id, fresh),
  closeSettings: () => ipcRenderer.send('settings:close'),
});
