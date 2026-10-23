// Local hook server: Claude Code hooks (via nubbi-hook.sh) POST their JSON here.
// Pure Node so it can be tested without Electron.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DEFAULT_PORT = 47823;
const DECISION_TIMEOUT_MS = 110 * 1000; // hook timeout is 120 s; answer before it

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
function ensureToken(dir) {
  ensureDir(dir);
  const p = path.join(dir, 'token');
  try { const t = fs.readFileSync(p, 'utf8').trim(); if (t.length >= 32) return t; } catch {}
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(p, t, { mode: 0o600 });
  return t;
}

/** The rule key used by "Always". Bash: exact command. Other tools: the tool itself. */
function ruleKey(cwd, tool, input) {
  const what = tool === 'Bash' ? String((input && input.command) || '') : '';
  return `${cwd || ''}\u0000${tool}\u0000${what}`;
}

class HookServer extends EventEmitter {
  constructor({ dir, port = DEFAULT_PORT, decisionTimeoutMs = DECISION_TIMEOUT_MS, rules = [] } = {}) {
    super();
    this.dir = dir;
    this.basePort = port;
    this.decisionTimeoutMs = decisionTimeoutMs;
    this.pending = new Map(); // id -> { res, timer, payload }
    this.rules = new Set(rules);
    this.server = null;
    this.port = null;
  }

  async start() {
    this.token = ensureToken(this.dir);
    for (let p = this.basePort; p < this.basePort + 12; p++) {
      try { await this._listen(p); this.port = p; break; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
    }
    if (!this.port) throw new Error('No free port for the hook server');
    fs.writeFileSync(path.join(this.dir, 'port'), String(this.port), { mode: 0o600 });
    return this.port;
  }

  _listen(port) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this._handle(req, res));
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', () => { srv.removeListener('error', reject); this.server = srv; resolve(); });
    });
  }

  stop() {
    for (const id of [...this.pending.keys()]) this._finish(id, null);
    try { if (this.port && fs.readFileSync(path.join(this.dir, 'port'), 'utf8').trim() === String(this.port)) fs.unlinkSync(path.join(this.dir, 'port')); } catch {}
    return new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  _handle(req, res) {
    const host = String(req.headers.host || '');
    const okHost = host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
    const m = /^\/hook\/([A-Za-z]+)$/.exec(req.url || '');
    if (req.method !== 'POST' || !m || !okHost || req.headers['x-nubbi-token'] !== this.token) {
      res.writeHead(403); return res.end();
    }
    const event = m[1];
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch {}
      payload.hook_event_name = payload.hook_event_name || event;
      const meta = { term: String(req.headers['x-nubbi-term'] || ''), bundle: String(req.headers['x-nubbi-bundle'] || '') };
      if (event === 'PermissionRequest') return this._permission(payload, meta, req, res);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(''); // no output -> no decision
      this.emit('event', { event, payload, meta });
    });
  }

  _permission(payload, meta, req, res) {
    const key = ruleKey(payload.cwd, payload.tool_name, payload.tool_input);
    if (this.rules.has(key)) {
      this._write(res, { behavior: 'allow' });
      this.emit('event', { event: 'PermissionRequest', payload, meta, auto: 'allow' });
      return;
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => this._finish(id, null, 'timeout'), this.decisionTimeoutMs);
    this.pending.set(id, { res, timer, payload });
    // If Claude Code gives up on the hook (user answered in the terminal), drop the card.
    res.on('close', () => { if (this.pending.has(id)) this._finish(id, null, 'closed'); });
    this.emit('event', { event: 'PermissionRequest', payload, meta, id });
  }

  /** decision: 'allow' | 'deny' | 'always' */
  decide(id, decision) {
    const p = this.pending.get(id);
    if (!p) return false;
    const { payload } = p;
    if (decision === 'always') {
      this.rules.add(ruleKey(payload.cwd, payload.tool_name, payload.tool_input));
      this.emit('rules', [...this.rules]);
      const sugg = Array.isArray(payload.permission_suggestions) && payload.permission_suggestions.length
        ? payload.permission_suggestions
        : [{ type: 'addRules', rules: [payload.tool_name === 'Bash' && payload.tool_input && payload.tool_input.command
            ? { toolName: 'Bash', ruleContent: payload.tool_input.command } : { toolName: payload.tool_name }],
            behavior: 'allow', destination: 'localSettings' }];
      return this._finish(id, { behavior: 'allow', updatedPermissions: sugg });
    }
    if (decision === 'allow') return this._finish(id, { behavior: 'allow' });
    if (decision === 'deny') return this._finish(id, { behavior: 'deny', message: 'Denied from the Nubbi notch.' });
    return this._finish(id, null); // 'ask' -> fall back to the terminal prompt
  }

  _finish(id, decision, why) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    try { if (!p.res.writableEnded) this._write(p.res, decision); } catch {}
    if (why) this.emit('resolved', { id, why });
    return true;
  }

  _write(res, decision) {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (!decision) return res.end('');
    res.end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
  }
}

module.exports = { HookServer, ruleKey, ensureToken, DEFAULT_PORT };
