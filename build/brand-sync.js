// Single source of truth: src/brand.json -> package.json (name, version, appId, productName, artifact names, Info.plist strings).
// Run: node build/brand-sync.js  (also run automatically by `npm run build:mac`).
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const b = require(path.join(root, 'src', 'brand.json'));
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.name = b.slug; pkg.productName = b.name; pkg.version = b.version;
pkg.description = `${b.name} — ${b.tagline}. Free and open source (MIT). Inspired by ${b.inspiration.name} by ${b.inspiration.author} (MIT).`;
pkg.build.appId = b.appId; pkg.build.productName = b.name;
pkg.build.mac.artifactName = `${b.archivePrefix}-\${version}-mac-\${arch}.\${ext}`;
pkg.build.mac.extendInfo = { ...(pkg.build.mac.extendInfo || {}), LSUIElement: true, CFBundleDisplayName: b.name,
  NSAppleEventsUsageDescription: `${b.name} brings your terminal to the front when you click Open terminal.` };
// hook relay script: default dir + env override name
const hookPath = path.join(root, 'src', 'hooks', b.hookScript);
const hs = fs.readFileSync(hookPath, 'utf8').replace(/^DIR=.*$/m, `DIR="\${${b.envPrefix}_HOOK_DIR:-$HOME/${b.hookDir}}"`).replace(/^# \S+-hook — relays Claude Code hook events to the .* app\.$/m, `# ${b.slug}-hook — relays Claude Code hook events to the ${b.name} app.`);
fs.writeFileSync(hookPath, hs);
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`brand-sync: ${b.name} ${b.version} (${b.appId})`);
