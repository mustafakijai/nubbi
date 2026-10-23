// Renders build/icon.png (1024²) from the real Nubbi SVG. Run: electron build/iconrender
const { app, BrowserWindow } = require('electron'); const fs = require('fs'); const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadFile(path.join(__dirname, 'icon.html')); await new Promise((r) => setTimeout(r, 800));
  const img = await w.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG()); console.log('icon', img.getSize()); app.exit(0);
});
