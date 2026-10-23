// Installs / removes Nubbi's Claude Code hooks in ~/.claude/settings.json.
// Rules: back up first, merge (never touch anyone else's hooks or settings),
// refuse to write over a file we can't parse, write atomically.
// Migration: entries left by earlier builds (Coucou Notch, Notchling — see brand.json "legacy") are removed
// in the same backed-up write, so Claude Code never calls two relays.
const fs = require('fs');
const path = require('path');
const os = require('os');

const brand = require('../brand.json');
const MARKER = `${brand.hookDir}/${brand.hookScript}`;
const LEGACY = (brand.legacy || []).map((l) => l.hookMarker);
const EVENTS = [
  ['SessionStart', 10], ['SessionEnd', 10], ['UserPromptSubmit', 10],
  ['PreToolUse', 10], ['PostToolUse', 10], ['PostToolUseFailure', 10],
  ['PermissionRequest', 120], ['Notification', 10], ['Stop', 10], ['StopFailure', 10],
];

function paths(home = os.homedir()) {
  return {
    settings: path.join(home, '.claude', 'settings.json'),
    dir: path.join(home, brand.hookDir),
    script: path.join(home, brand.hookDir, brand.hookScript),
  };
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes(MARKER);
const isLegacy = (h) => h && typeof h.command === 'string' && LEGACY.some((m) => h.command.includes(m));
const isAnyOfOurs = (h) => isOurs(h) || isLegacy(h);

function readSettings(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { data: {}, raw: null }; throw e; }
  if (!raw.trim()) return { data: {}, raw };
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error(`~/.claude/settings.json isn't valid JSON (${e.message}). Fix it first — nothing was changed.`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('~/.claude/settings.json is not a JSON object — nothing was changed.');
  if (data.hooks !== undefined && (typeof data.hooks !== 'object' || Array.isArray(data.hooks))) throw new Error('"hooks" in settings.json has an unexpected type — nothing was changed.');
  return { data, raw };
}

function withoutOurs(data, match = isAnyOfOurs) {
  const out = JSON.parse(JSON.stringify(data));
  if (!out.hooks) return out;
  for (const ev of Object.keys(out.hooks)) {
    const groups = out.hooks[ev];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const hs = g.hooks.filter((h) => !match(h));
      if (hs.length === g.hooks.length) kept.push(g);
      else if (hs.length) kept.push({ ...g, hooks: hs });
    }
    if (kept.length) out.hooks[ev] = kept; else delete out.hooks[ev];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

function withOurs(data, script) {
  const out = withoutOurs(data);
  out.hooks = out.hooks || {};
  for (const [ev, timeout] of EVENTS) {
    const entry = { hooks: [{ type: 'command', command: `${shq(script)} ${ev}`, timeout }] };
    if (ev === 'PermissionRequest') entry.hooks[0].statusMessage = `Waiting for ${brand.name}…`;
    out.hooks[ev] = [...(Array.isArray(out.hooks[ev]) ? out.hooks[ev] : []), entry];
  }
  return out;
}

function backup(file, raw) {
  if (raw === null) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const b = `${file}.${brand.slug}-backup-${stamp}`;
  fs.writeFileSync(b, raw, { mode: 0o600 });
  return b;
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode = 0o600;
  try { mode = fs.statSync(file).mode & 0o777; } catch {}
  const tmp = `${file}.${brand.slug}-tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

/** Count legacy (pre-rename) hook entries in parsed settings. */
function legacyCount(data) {
  let n = 0;
  for (const groups of Object.values((data && data.hooks) || {})) if (Array.isArray(groups)) for (const g of groups) if (g && Array.isArray(g.hooks)) n += g.hooks.filter(isLegacy).length;
  return n;
}
const legacyNames = (data) => (brand.legacy || []).filter((l) => JSON.stringify((data && data.hooks) || {}).includes(l.hookMarker)).map((l) => l.name);

/** Copy the relay script into ~/.nubbi (always refreshed). */
function installScript(srcScript, home) {
  const p = paths(home);
  fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(p.script, fs.readFileSync(srcScript), { mode: 0o755 });
  fs.chmodSync(p.script, 0o755);
  return p.script;
}

function install({ home = os.homedir(), srcScript }) {
  const p = paths(home);
  if (srcScript) installScript(srcScript, home);
  const { data, raw } = readSettings(p.settings);
  const migrated = legacyCount(data); const names = legacyNames(data);
  const next = withOurs(data, p.script);
  const text = JSON.stringify(next, null, 2) + '\n';
  if (raw !== null && raw === text) return { changed: false, backup: null, settings: p.settings, migrated: 0, legacyNames: [] };
  const b = backup(p.settings, raw);
  atomicWrite(p.settings, text);
  return { changed: true, backup: b, settings: p.settings, migrated, legacyNames: names };
}

function uninstall({ home = os.homedir() } = {}) {
  const p = paths(home);
  const { data, raw } = readSettings(p.settings);
  if (raw === null) return { changed: false, backup: null, settings: p.settings };
  const next = withoutOurs(data);
  if (JSON.stringify(next) === JSON.stringify(data)) return { changed: false, backup: null, settings: p.settings };
  const b = backup(p.settings, raw);
  atomicWrite(p.settings, JSON.stringify(next, null, 2) + '\n');
  return { changed: true, backup: b, settings: p.settings };
}

function status({ home = os.homedir() } = {}) {
  const p = paths(home);
  let installed = false, events = [], error = null;
  try {
    const { data } = readSettings(p.settings);
    for (const [ev, groups] of Object.entries(data.hooks || {})) {
      if (Array.isArray(groups) && groups.some((g) => g && Array.isArray(g.hooks) && g.hooks.some(isOurs))) events.push(ev);
    }
    installed = EVENTS.every(([ev]) => events.includes(ev));
  } catch (e) { error = e.message; }
  let legacy = 0; try { legacy = legacyCount(readSettings(p.settings).data); } catch {}
  return { installed, events, error, legacy, settings: p.settings, script: p.script, scriptPresent: fs.existsSync(p.script) };
}

module.exports = { install, uninstall, status, installScript, paths, withOurs, withoutOurs, legacyCount, EVENTS, MARKER, LEGACY };
