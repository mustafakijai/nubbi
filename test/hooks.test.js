// Round-trip tests: a simulated Claude Code hook (stdin JSON -> nubbi-hook.sh -> HTTP
// server -> decision JSON on stdout), the fail-open path, and the settings.json installer.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { HookServer } = require('../src/hooks/server');
const installer = require('../src/hooks/installer');

const SRC_SCRIPT = path.join(__dirname, '..', 'src', 'hooks', 'nubbi-hook.sh');

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nubbi-home-')); }

/** Run the hook exactly as Claude Code would: `sh -c "<command>"` with JSON on stdin. */
function runHook(home, event, payload) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const cmd = `'${path.join(home, '.nubbi', 'nubbi-hook.sh')}' ${event}`;
    const p = spawn('sh', ['-c', cmd], { env: { ...process.env, HOME: home, TERM_PROGRAM: 'iTerm.app', __CFBundleIdentifier: 'com.googlecode.iterm2' } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err, ms: Date.now() - t0 }));
    p.stdin.end(JSON.stringify(payload));
  });
}

const PERM = (cmd, cwd = '/Users/me/korus') => ({
  session_id: 's1', cwd, hook_event_name: 'PermissionRequest', permission_mode: 'default',
  tool_name: 'Bash', tool_input: { command: cmd, description: 'Push' },
  permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: cmd }], behavior: 'allow', destination: 'localSettings' }],
});

async function withServer(fn, opts = {}) {
  const home = tmpHome();
  installer.installScript(SRC_SCRIPT, home);
  const srv = new HookServer({ dir: path.join(home, '.nubbi'), port: 48100 + Math.floor(Math.random() * 500), ...opts });
  await srv.start();
  try { await fn(srv, home); } finally { await srv.stop(); }
}

test('non-blocking event reaches the app with terminal metadata and prints nothing', async () => {
  await withServer(async (srv, home) => {
    const got = new Promise((r) => srv.once('event', r));
    const res = await runHook(home, 'UserPromptSubmit', { session_id: 's1', cwd: '/Users/me/korus', prompt: 'hi' });
    const ev = await got;
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.out, '');
    assert.strictEqual(ev.event, 'UserPromptSubmit');
    assert.strictEqual(ev.payload.cwd, '/Users/me/korus');
    assert.deepStrictEqual(ev.meta, { term: 'iTerm.app', bundle: 'com.googlecode.iterm2' });
  });
});

test('PermissionRequest blocks until Allow is clicked, then returns allow JSON', async () => {
  await withServer(async (srv, home) => {
    srv.once('event', (ev) => setTimeout(() => srv.decide(ev.id, 'allow'), 300));
    const res = await runHook(home, 'PermissionRequest', PERM('git push origin main'));
    assert.strictEqual(res.code, 0);
    assert.ok(res.ms >= 280, 'hook waited for the click');
    assert.deepStrictEqual(JSON.parse(res.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  });
});

test('Deny returns a deny decision with a message', async () => {
  await withServer(async (srv, home) => {
    srv.once('event', (ev) => srv.decide(ev.id, 'deny'));
    const res = await runHook(home, 'PermissionRequest', PERM('rm -rf build'));
    const d = JSON.parse(res.out).hookSpecificOutput.decision;
    assert.strictEqual(d.behavior, 'deny');
    assert.match(d.message, /Nubbi/);
  });
});

test('Always returns allow + updatedPermissions and auto-allows the same command next time', async () => {
  await withServer(async (srv, home) => {
    srv.once('event', (ev) => srv.decide(ev.id, 'always'));
    const first = JSON.parse((await runHook(home, 'PermissionRequest', PERM('npm test'))).out);
    assert.strictEqual(first.hookSpecificOutput.decision.behavior, 'allow');
    assert.strictEqual(first.hookSpecificOutput.decision.updatedPermissions[0].rules[0].ruleContent, 'npm test');
    let auto;
    srv.once('event', (ev) => (auto = ev.auto));
    const again = await runHook(home, 'PermissionRequest', PERM('npm test'));
    assert.strictEqual(JSON.parse(again.out).hookSpecificOutput.decision.behavior, 'allow');
    assert.strictEqual(auto, 'allow');
    assert.ok(again.ms < 1500);
  });
});

test('no click before the app timeout -> empty output (normal Claude prompt)', async () => {
  await withServer(async (srv, home) => {
    const res = await runHook(home, 'PermissionRequest', PERM('git push'));
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.out, '');
  }, { decisionTimeoutMs: 400 });
});

test('fails open fast when the app is not running', async () => {
  const home = tmpHome();
  installer.installScript(SRC_SCRIPT, home);
  fs.writeFileSync(path.join(home, '.nubbi', 'port'), '48999');
  fs.writeFileSync(path.join(home, '.nubbi', 'token'), 'x'.repeat(48));
  const res = await runHook(home, 'PermissionRequest', PERM('git push'));
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.out, '');
  assert.ok(res.ms < 1500, `took ${res.ms} ms`);
  // and with no port file at all
  fs.unlinkSync(path.join(home, '.nubbi', 'port'));
  const res2 = await runHook(home, 'Stop', { session_id: 's1' });
  assert.strictEqual(res2.code, 0); assert.strictEqual(res2.out, '');
});

test('wrong token is rejected and the hook still fails open', async () => {
  await withServer(async (srv, home) => {
    let fired = false; srv.on('event', () => (fired = true));
    fs.writeFileSync(path.join(home, '.nubbi', 'token'), 'nope');
    const res = await runHook(home, 'PermissionRequest', PERM('git push'));
    assert.strictEqual(res.out, ''); assert.strictEqual(res.code, 0); assert.strictEqual(fired, false);
  });
});

test('installer backs up, merges without clobbering, is idempotent, and uninstalls cleanly', () => {
  const home = tmpHome();
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = { model: 'claude-opus-5', permissions: { allow: ['Bash(ls)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/usr/local/bin/other-tool' }] }],
             FileChanged: [{ matcher: '.env', hooks: [{ type: 'command', command: 'keep-me' }] }] } };
  fs.writeFileSync(file, JSON.stringify(original, null, 2));

  const r1 = installer.install({ home, srcScript: SRC_SCRIPT });
  assert.ok(r1.changed && r1.backup && fs.existsSync(r1.backup));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(r1.backup, 'utf8')), original);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(s.model, 'claude-opus-5');
  assert.deepStrictEqual(s.permissions, original.permissions);
  assert.strictEqual(s.hooks.PreToolUse[0].hooks[0].command, '/usr/local/bin/other-tool');
  assert.strictEqual(s.hooks.PreToolUse.length, 2);
  assert.deepStrictEqual(s.hooks.FileChanged, original.hooks.FileChanged);
  assert.strictEqual(s.hooks.PermissionRequest[0].hooks[0].timeout, 120);
  assert.ok(installer.status({ home }).installed);
  assert.ok(fs.statSync(path.join(home, '.nubbi', 'nubbi-hook.sh')).mode & 0o100);

  const r2 = installer.install({ home, srcScript: SRC_SCRIPT });
  assert.strictEqual(r2.changed, false, 'second install is a no-op');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse.length, 2);

  const r3 = installer.uninstall({ home });
  assert.ok(r3.changed && fs.existsSync(r3.backup));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
  assert.strictEqual(installer.status({ home }).installed, false);
});

test('installer refuses to touch invalid JSON', () => {
  const home = tmpHome();
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ "model": "x", }');
  assert.throws(() => installer.install({ home, srcScript: SRC_SCRIPT }), /valid JSON/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ "model": "x", }');
});

test('installer creates settings.json when there is none', () => {
  const home = tmpHome();
  const r = installer.install({ home, srcScript: SRC_SCRIPT });
  assert.ok(r.changed); assert.strictEqual(r.backup, null);
  assert.ok(installer.status({ home }).installed);
});

test('installer migrates old Coucou Notch / Notchling hooks (backed up first, others untouched)', () => {
  const home = tmpHome();
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = (ev) => ({ type: 'command', command: `"$HOME/.coucou-notch/coucou-hook.sh" ${ev}`, timeout: 10 });
  const original = { theme: 'dark', hooks: {
    PreToolUse: [{ matcher: '*', hooks: [old('PreToolUse')] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] }],
    Stop: [{ hooks: [old('Stop'), { type: 'command', command: 'say done' }] }],
    Notification: [{ hooks: [{ type: 'command', command: '"$HOME/.notchling/notchling-hook.sh" Notification' }] }] } };
  fs.writeFileSync(file, JSON.stringify(original, null, 2));
  assert.strictEqual(installer.status({ home }).legacy, 3);
  const r = installer.install({ home, srcScript: SRC_SCRIPT });
  assert.strictEqual(r.migrated, 3);
  assert.deepStrictEqual(r.legacyNames.sort(), ['Coucou Notch', 'Notchling']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(r.backup, 'utf8')), original, 'backup is the pre-migration file');
  const txt = fs.readFileSync(file, 'utf8');
  assert.ok(!/coucou-hook|notchling-hook/.test(txt), 'legacy hooks removed');
  const s = JSON.parse(txt);
  assert.strictEqual(s.theme, 'dark');
  assert.ok(s.hooks.PreToolUse.some((g) => g.hooks.some((h) => h.command === 'mine')));
  assert.ok(s.hooks.Stop.some((g) => g.hooks.some((h) => h.command === 'say done')), 'non-Nubbi hook sharing a group survives');
  assert.ok(/\.nubbi\/nubbi-hook\.sh/.test(txt));
  assert.strictEqual(installer.status({ home }).legacy, 0);
  assert.ok(/nubbi-backup-/.test(r.backup));
});
