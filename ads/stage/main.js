// Ad stage: a fake macOS desktop (wallpaper, menu bar, hardware notch, Terminal, Mail) sitting UNDER the real Nubbi window.
// Commands arrive as JSON lines on stdin: {id, js} -> evaluated in the page; reply "@@{id,result}".
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(() => {
  const w = new BrowserWindow({ x: 0, y: 0, width: 1440, height: 1080, frame: false, focusable: false, resizable: false, show: false, backgroundColor: '#140c2e', enableLargerThanScreen: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  w.loadFile('desktop.html');
  w.once('ready-to-show', () => { w.showInactive(); w.setBounds({ x: 0, y: 0, width: 1440, height: 1080 }); setTimeout(() => process.stdout.write('@@{"id":"ready"}\n'), 400); });
  let buf = '';
  process.stdin.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
      const c = JSON.parse(line);
      w.webContents.executeJavaScript(c.js, true).then((r) => process.stdout.write('@@' + JSON.stringify({ id: c.id, result: r === undefined ? null : r }) + '\n'),
        (e) => process.stdout.write('@@' + JSON.stringify({ id: c.id, result: { error: String(e) } }) + '\n'));
    }
  });
});
