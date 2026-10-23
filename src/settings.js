// Settings persisted in userData/settings.json (0600). API keys are encrypted with Electron safeStorage
// (macOS Keychain-backed key) — one entry per provider; the renderer only ever sees "••••last4".
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { PROVIDERS, ORDER } = require('./providers');

const DEFAULT_SHORTCUTS = [
  { label: 'Stripe', url: 'https://dashboard.stripe.com', color: '#7d70d8' },
  { label: 'GitHub', url: 'https://github.com', color: '#4caf6f' },
  { label: 'n8n', url: 'https://app.n8n.cloud', color: '#e8845b' },
  { label: 'Vercel', url: 'https://vercel.com/dashboard', color: '#4f9fd8' },
];
const COLORS = ['mint', 'peach', 'lilac', 'sky', 'snow'];
const DEFAULTS = {
  provider: 'free', models: Object.fromEntries(ORDER.map((id) => [id, PROVIDERS[id].def])), ollamaUrl: 'http://127.0.0.1:11434',
  color: 'mint', email: '', sound: true, peekOnHover: true, notchWidth: 0, shortcuts: DEFAULT_SHORTCUTS, rules: [], onboarded: false,
};
const KEYED = ORDER.filter((id) => PROVIDERS[id].needsKey || PROVIDERS[id].optionalKey);

const file = () => path.join(app.getPath('userData'), 'settings.json');
let cache = null;

const enc = (v) => (safeStorage.isEncryptionAvailable() ? { e: safeStorage.encryptString(v).toString('base64') } : { p: Buffer.from(v, 'utf8').toString('base64') }); // {p} = no keyring (Linux CI only)
const dec = (o) => { try { if (o && o.e) return safeStorage.decryptString(Buffer.from(o.e, 'base64')); if (o && o.p) return Buffer.from(o.p, 'base64').toString('utf8'); } catch {} return ''; };

function read() {
  if (cache) return cache;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch {}
  const keys = {};
  for (const id of KEYED) keys[id] = dec((raw.keysEnc || {})[id]);
  if (!keys.claude && (raw.apiKeyEnc || raw.apiKeyPlain)) keys.claude = dec({ e: raw.apiKeyEnc, p: raw.apiKeyPlain }); // v2 single-key format
  const s = { ...DEFAULTS, ...raw, models: { ...DEFAULTS.models, ...(raw.models || {}) }, keys };
  if (raw.model && !(raw.models || {}).claude) s.models.claude = raw.model;
  for (const k of ['keysEnc', 'apiKeyEnc', 'apiKeyPlain', 'apiKey', 'model']) delete s[k];
  if (!PROVIDERS[s.provider]) s.provider = 'free';
  if (!COLORS.includes(s.color)) s.color = 'mint';
  if (!Array.isArray(s.shortcuts) || s.shortcuts.length !== 4) s.shortcuts = DEFAULT_SHORTCUTS;
  cache = s;
  return s;
}

function write(next) {
  const { keys = {}, ...rest } = next;
  const out = { ...rest, keysEnc: {} };
  for (const id of KEYED) if (keys[id]) out.keysEnc[id] = enc(keys[id]);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(out, null, 2), { mode: 0o600 });
  cache = { ...next, keys: { ...keys } };
  return cache;
}

/** p.keys: {provider: 'new key'}; p.clearKey: 'provider'; p.models: {provider: model} */
function patch(p = {}) {
  const cur = read();
  const next = { ...cur, ...p, keys: { ...cur.keys }, models: { ...cur.models, ...(p.models || {}) } };
  for (const [id, v] of Object.entries(p.keys || {})) {
    if (!KEYED.includes(id) || typeof v !== 'string') continue;
    const t = v.trim();
    if (t && !t.startsWith('••••')) next.keys[id] = t.slice(0, 400);
  }
  if (p.clearKey && KEYED.includes(p.clearKey)) next.keys[p.clearKey] = '';
  delete next.clearKey;
  if (p.provider !== undefined && !PROVIDERS[p.provider]) next.provider = cur.provider;
  if (p.color !== undefined && !COLORS.includes(p.color)) next.color = cur.color;
  if (p.ollamaUrl !== undefined && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(p.ollamaUrl)) next.ollamaUrl = cur.ollamaUrl; // local only
  if (Array.isArray(p.shortcuts)) {
    next.shortcuts = p.shortcuts.slice(0, 4).map((s, i) => ({
      label: String(s.label || DEFAULT_SHORTCUTS[i].label).slice(0, 18),
      url: /^https:\/\//.test(s.url) ? String(s.url) : DEFAULT_SHORTCUTS[i].url,
      color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : DEFAULT_SHORTCUTS[i].color,
    }));
  }
  return write(next);
}

/** What the renderer may see (never a key). */
function publicView() {
  const s = read();
  const { keys, ...rest } = s;
  const hasKey = {}, keyHint = {};
  for (const id of KEYED) { hasKey[id] = !!keys[id]; keyHint[id] = keys[id] ? '••••' + keys[id].slice(-4) : ''; }
  const p = PROVIDERS[s.provider];
  return { ...rest, hasKey, keyHint, ready: !p.needsKey || !!keys[s.provider], encrypted: safeStorage.isEncryptionAvailable() };
}

module.exports = { read, write, patch, publicView, DEFAULT_SHORTCUTS, COLORS, KEYED };
