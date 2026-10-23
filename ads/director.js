// Ad director: records the REAL Nubbi app on a mock macOS desktop (Xvfb + picom + x11grab), driving it like a person.
// node ads/director.js [outdir]   -> outdir/raw.mkv, cursor.log, markers.jsonl, e2e.log
const { spawn, execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'rec'));
const ONLY = process.env.ONLY || '';
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['raw.mkv', 'cursor.log', 'markers.jsonl', 'e2e.log']) try { fs.unlinkSync(path.join(OUT, f)); } catch {}
const DISP = ':5', W = 2880, H = 2160;
const HOME = '/tmp/adhome';
const ELECTRON = path.join(ROOT, 'node_modules/.bin/electron');
const env = { ...process.env, DISPLAY: DISP };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (name, extra = {}) => { fs.appendFileSync(path.join(OUT, 'markers.jsonl'), JSON.stringify({ t: Date.now(), name, ...extra }) + '\n'); console.log('[mark]', name); };
const procs = [];
let FF = null;
function kill() { if (FF) try { FF.stdin.write('q'); } catch {} for (const p of procs) try { p.kill('SIGTERM'); } catch {} }
process.on('exit', kill); process.on('SIGINT', () => { kill(); process.exit(1); });

function channel(cmd, args, opts, name) {
  const p = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] }); procs.push(p);
  const waiters = new Map(); let buf = '', seq = 0; let readyRes; const ready = new Promise((r) => (readyRes = r));
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.startsWith('@@')) { const m = JSON.parse(line.slice(2)); if (m.id === 'ready') readyRes(); const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m.result); } }
      else if (process.env.VERBOSE) console.log(`[${name}]`, line);
    }
  });
  p.stderr.on('data', (d) => { const s = String(d); if (process.env.VERBOSE || /Error|error:/.test(s) && !/dbus|Gtk|libva|viz|gpu|GLES|Fontconfig/.test(s)) process.stderr.write(`[${name}!] ` + s); });
  return { p, ready, send(obj) { const id = name + ++seq; return new Promise((r) => { waiters.set(id, r); p.stdin.write(JSON.stringify({ id, ...obj }) + '\n'); }); } };
}

// --- the hand (XTEST pointer + real XDND drags) ---
function startHand() {
  const p = spawn('python3', [path.join(__dirname, 'stage/hand.py'), path.join(OUT, 'cursor.log')], { env: { ...env, HAND_X: '2400', HAND_Y: '1700' }, stdio: ['pipe', 'pipe', 'inherit'] }); procs.push(p);
  const q = []; let buf = '';
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); const w = q.shift(); if (w) w(l); } });
  const cmd = (s) => new Promise((r) => { q.push(r); p.stdin.write(s + '\n'); });
  const ready = new Promise((r) => q.push(r));
  return { ready, cmd, move: (x, y, dur = 0.6) => cmd(`move ${Math.round(x)} ${Math.round(y)} ${dur}`), click: () => cmd('click'), drag: (f, x, y, dur) => cmd(`drag ${f} ${Math.round(x)} ${Math.round(y)} ${dur}`) };
}

function hook(event, payload) {
  return new Promise((resolve) => {
    const p = spawn('sh', [path.join(HOME, '.nubbi', 'nubbi-hook.sh'), event], { env: { ...process.env, HOME, TERM_PROGRAM: 'Apple_Terminal' } });
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.on('close', (code) => resolve({ code, out })); p.stdin.end(JSON.stringify({ hook_event_name: event, transcript_path: '/tmp/t.jsonl', ...payload }));
  });
}
const xtype = (s, delay = 55) => execSync(`xdotool type --delay ${delay} -- ${JSON.stringify(s)}`, { env });
const xkey = (k) => execSync(`xdotool key ${k}`, { env });

(async () => {
  // ---- display + compositor ----
  try { execSync(`pkill -f "Xvfb ${DISP} "`); } catch {}
  await wait(400);
  const xv = spawn('Xvfb', [DISP, '-screen', '0', `${W}x${H}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' }); procs.push(xv);
  await wait(1200);
  const pc = spawn('picom', ['--backend', 'xrender', '--config', '/dev/null', '--no-fading-openclose', '--no-vsync', '--no-frame-pacing', '--no-use-damage'], { env, stdio: 'ignore' }); procs.push(pc);
  await wait(600);

  // ---- fresh Nubbi home ----
  execSync(`rm -rf ${HOME} && mkdir -p ${HOME}/.claude ${HOME}/Desktop`);
  fs.writeFileSync(`${HOME}/.claude/settings.json`, JSON.stringify({ model: 'opus' }, null, 2));
  const { makePdf } = require('./lib/pdf');
  const PDF = `${HOME}/Desktop/quote.pdf`; makePdf(PDF);

  // ---- stage desktop ----
  const stage = channel(ELECTRON, [path.join(__dirname, 'stage'), '--no-sandbox', '--enable-transparent-visuals'], { env }, 'stage');
  await stage.ready; const S = (js) => stage.send({ js });
  const hand = startHand(); await hand.ready;
  await wait(500);

  // ---- record ----
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', `${W}x${H}`, '-thread_queue_size', '512', '-i', DISP,
    '-copyts', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', '-threads', '4', path.join(OUT, 'raw.mkv')], { stdio: ['pipe', 'inherit', 'inherit'] });
  FF = ff;
  await wait(1200); mark('rec');

  // ---- Nubbi (real app) ----
  const nub = channel(ELECTRON, [ROOT, '--no-sandbox', '--enable-transparent-visuals'], {
    env: { ...env, NUBBI_E2E: path.join(OUT, 'e2e.log'), NUBBI_HOME: HOME, NUBBI_FAKE_NOTCH: '1' } }, 'nubbi');
  mark('launch');
  await wait(900);
  await nub.send({ settings: { provider: 'free', color: 'mint', email: 'me@example.com', onboarded: true, sound: true } });
  const B = await nub.send({ bounds: true });
  console.log('notch bounds', B);
  const N = (js) => nub.send({ eval: js });
  const demo = (c) => nub.send({ demo: c });
  const VIEW = async () => String(await N("(document.querySelector('#content > .view:not(.out)')||{}).className||''"));
  // element centre in screen px
  async function el(sel, txt, nth = 0) {
    const r = await N(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => !e.closest('.view.out') && e.getClientRects().length ${txt ? `&& e.textContent.includes(${JSON.stringify(txt)})` : ''});
      const e = els[${nth}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
    if (!r) throw new Error('no element ' + sel + ' ' + (txt || ''));
    const b = await nub.send({ bounds: true });
    return { x: (b.x + r.x) * 2, y: (b.y + r.y) * 2, w: r.w * 2, h: r.h * 2 };
  }
  async function tap(sel, txt, dur = 0.55, nth = 0, dx = 0, dy = 0) { const e = await el(sel, txt, nth); await hand.move(e.x + dx, e.y + dy, dur); await wait(90); await hand.click(); return e; }
  const notchX = (B.x + B.width / 2) * 2;
  // Chromium lowers a window on blur when there is no window manager (XLowerWindow) — keep Nubbi above the stage like macOS would.
  let nubWin = null; for (let i = 0; i < 20 && !nubWin; i++) { try { nubWin = execSync('xdotool search --name "^Nubbi$"', { env }).toString().trim().split('\n')[0]; } catch { await wait(200); } }
  console.log('nubbi window', nubWin);
  await hand.cmd('top ' + nubWin);
  setInterval(() => { try { execSync(`xdotool windowraise ${nubWin}`, { env }); } catch {} }, 250);

  const s1 = { session_id: 's-korus', cwd: '/Users/me/code/korus' };
  const SKIP = !!process.env.DRAGTEST; if (SKIP) await wait(4500);
  if (!SKIP) {
  // ===== 1. HOOK: Nubbi pops out of the notch (launch peek) and looks around =====
  mark('hook');
  await hand.move(notchX - 360, 520, 0.9);
  await hand.move(notchX + 380, 430, 0.9);
  await hand.move(notchX - 120, 330, 0.7);
  await wait(900);
  mark('hook_end');

  // ===== 2. Claude Code session =====
  await hand.move(1500, 1000, 0.6);
  mark('typing_claude');
  await S(`stage.T.type('claude', 70)`); await wait(150);
  await S(`stage.T.line(''); stage.T.welcome('korus'); stage.T.userPrompt()`);
  await hook('SessionStart', { ...s1, source: 'startup' });
  await wait(500);
  mark('session');
  await S(`stage.T.type('Fix the flaky checkout test', 38)`); await wait(200);
  await S(`stage.T.line('')`);
  await hook('UserPromptSubmit', { ...s1, prompt: 'Fix the flaky checkout test' });
  await S(`stage.T.spin('Thinking…')`);
  await wait(700);
  await hook('PreToolUse', { ...s1, tool_name: 'Read', tool_input: { file_path: '/Users/me/code/korus/src/checkout.test.ts' } });
  await S(`stage.T.tool('Read', 'src/checkout.test.ts'); stage.T.out('Read 182 lines'); stage.T.spin('Reticulating…')`);
  // open the notch: hover then click
  await hand.move(notchX + 40, 38, 0.7); await wait(450); await hand.click();
  mark('panel_open');
  await wait(400);
  await hook('PreToolUse', { ...s1, tool_name: 'Edit', tool_input: { file_path: '/Users/me/code/korus/src/checkout.test.ts' } });
  await S(`stage.T.tool('Update', 'src/checkout.test.ts'); stage.T.out('Updated with 3 additions and 1 removal', 'g'); stage.T.spin('Pondering…')`);
  await hand.move(notchX + 300, 300, 0.6);
  await wait(1300);
  mark('session_end');

  // ===== 3. Permission =====
  const permPayload = { ...s1, tool_name: 'Bash', tool_input: { command: 'npm test -- checkout', description: 'Run checkout tests' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] };
  await hook('PreToolUse', { ...s1, tool_name: 'Bash', tool_input: permPayload.tool_input });
  const pending = hook('PermissionRequest', permPayload);
  await S(`stage.T.tool('Bash', 'npm test -- checkout'); stage.T.line('  <span class="y">Do you want to proceed?</span> <span class="d">❯ 1. Yes  2. No</span>')`);
  mark('perm');
  await wait(1300);
  await tap('[data-d=allow]', null, 0.75);
  mark('allow');
  const perm = await pending; console.log('perm reply', perm.out.slice(0, 120));
  await S(`stage.T.out('PASS  src/checkout.test.ts — 14 passing', 'g')`);
  await hook('PostToolUse', { ...s1, tool_name: 'Bash', tool_input: permPayload.tool_input, tool_response: { stdout: '14 passing' } });
  await wait(600);
  await hook('Stop', { ...s1, last_assistant_message: 'Fixed the flaky checkout test — the payment mock now resolves before assertions. 14/14 passing.' });
  await S(`stage.T.say('Fixed! The payment mock now resolves before the assertions.'); stage.T.prompt('korus')`);
  mark('done');
  await wait(1800);
  mark('perm_end');

  }
  // ===== 4. Drop a file & ask =====
  await demo({ cmd: 'collapse' });
  await wait(500);
  await S(`stage.icon('ic-pdf','sel',false)`);
  const icon = await S(`(() => { const r = document.querySelector('#ic-pdf .doc').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await hand.move(icon.x * 2, icon.y * 2, 0.8);
  await S(`stage.icon('ic-pdf','sel',true)`);
  await wait(250);
  mark('drag');
  let dr = await hand.drag(PDF, notchX, 60, 1.1);
  if (dr !== 'dropped') { mark('drag_retry'); await demo({ cmd: 'collapse' }); await wait(600); await hand.move(icon.x * 2, icon.y * 2, 0.8); await wait(300); mark('drag2'); dr = await hand.drag(PDF, notchX, 60, 1.1); }
  console.log('drag:', dr); if (process.env.PAUSE_LOST && dr !== 'dropped') { console.log('PAUSED'); await wait(90000); }
  mark('dropped', { dr });
  await S(`stage.icon('ic-pdf','sel',false)`);
  // wait for "ready"
  for (let i = 0; i < 80; i++) { const v = await N(`(document.querySelector('#content > .view:not(.out)')||{}).className||''`); if (/ready/.test(v)) break; await wait(100); }
  mark('ready');
  await wait(400);
  await tap('.view.ready input', null, 0.6, 0, -40, 0);
  await wait(250);
  mark('typing_q');
  xtype('What\u2019s the total?', 60);
  const typed = await N(`(document.querySelector('.view.ready input')||{}).value`); console.log('typed:', typed);
  if (!typed) { await N(`(() => { const i = document.querySelector('.view.ready input'); i.value = 'What’s the total?'; i.dispatchEvent(new Event('input')); })()`); }
  await wait(300);
  if (typed) xkey('Return'); else await demo({ cmd: 'ask', q: 'What’s the total?' });
  mark('ask');
  await hand.move(notchX + 520, 560, 0.8);
  let ans = null;
  for (let i = 0; i < 600; i++) {
    await wait(100);
    const st = await N(`(() => { const v = document.querySelector('.view.answer:not(.out)'); if (!v) return null; return { caret: !!v.querySelector('.caret'), text: (v.querySelector('.ans')||{}).innerText||'', err: !!v.querySelector('.errrow') }; })()`);
    if (st && !st.caret && (st.err || st.text.length > 10) && i > 5) { ans = st; break; }
  }
  console.log('answer:', JSON.stringify(ans));
  mark('answered', { ans });
  await wait(1600);

  // ===== 5. Provider picker =====
  await tap('.view.answer .chip', null, 0.7);
  mark('picker');
  await wait(500);
  for (const id of ['gemini', 'groq', 'openrouter', 'ollama', 'claude']) { const e = await el(`.picker .opt[data-id=${id}]`); await hand.move(e.x + 40, e.y, 0.22); await wait(170); }
  await wait(300);
  await tap('.picker .opt[data-id=free]', null, 0.45, 0, 40, 0);
  mark('picker_end');
  await wait(600);

  // ===== 6. Copy / Email =====
  await tap('.view.answer .btn', 'Copy', 0.6);
  mark('copy');
  await wait(900);
  await tap('.view.answer .btn', 'Email', 0.5);
  mark('email');
  await wait(250);
  let mail = null;
  for (let i = 0; i < 20 && !mail; i++) { const lines = fs.readFileSync(path.join(OUT, 'e2e.log'), 'utf8').trim().split('\n').reverse(); for (const l of lines) { if (l.includes('"mail"')) { mail = JSON.parse(l).mail; break; } } if (!mail) await wait(100); }
  await demo({ cmd: 'collapse' });
  await S(`stage.M.show(${JSON.stringify(mail || { to: 'me@example.com', subject: 'Nubbi — quote.pdf', body: '' })})`);
  mark('mail');
  await wait(900);
  const sb = await S(`stage.M.rect('send')`);
  await hand.move((sb.x + sb.w / 2) * 2, (sb.y + sb.h / 2) * 2, 0.7); await wait(120); await hand.click(); await S(`stage.M.press()`);
  await wait(120); await S(`stage.M.send()`);
  mark('sent');
  await wait(1700);
  // reset the doc so the panel shows sessions again
  await N(`(() => { const b = [...document.querySelectorAll('.btn')].find((b) => b.textContent === 'Done'); if (b) b.click(); })()`);

  // ===== 7. Multiple sessions =====
  await S(`stage.T.clear(); stage.T.tabs(['korus','landing','api'],'landing'); stage.T.welcome('landing'); stage.T.line('<span class="d">&gt;</span> Update the hero copy'); stage.T.spin('Brewing…')`);
  const s2 = { session_id: 's-landing', cwd: '/Users/me/code/landing' }, s3 = { session_id: 's-api', cwd: '/Users/me/code/api' };
  await hook('SessionStart', { ...s2, source: 'startup' }); await hook('UserPromptSubmit', { ...s2, prompt: 'Update the hero copy' });
  await hook('PreToolUse', { ...s2, tool_name: 'Edit', tool_input: { file_path: '/Users/me/code/landing/app/page.tsx' } });
  await hook('SessionStart', { ...s3, source: 'startup' }); await hook('UserPromptSubmit', { ...s3, prompt: 'Add rate limiting' });
  await hook('PreToolUse', { ...s3, tool_name: 'Grep', tool_input: { pattern: 'rateLimit' } });
  await hook('UserPromptSubmit', { ...s1, prompt: 'Now add a regression test' });
  await hook('PreToolUse', { ...s1, tool_name: 'Write', tool_input: { file_path: '/Users/me/code/korus/src/checkout.regression.test.ts' } });
  await wait(300);
  for (let i = 0; i < 40 && /peek/.test(await VIEW()); i++) await wait(100);
  await hand.move(notchX - 60, 36, 0.8); await wait(500);
  console.log('multi view(hover)', await VIEW());
  if (!/panel/.test(await VIEW())) { await hand.click(); await wait(500); }
  console.log('multi view', await VIEW(), await N("document.querySelectorAll('#content > .view:not(.out) .card').length"));
  mark('multi');
  { const pr = await el('#content > .view:not(.out) .card', null, 1); await hand.move(pr.x + 220, pr.y + 10, 0.7); }
  await wait(2400);
  mark('multi_end');

  // ===== 8. Colours =====
  mark('colors');
  for (const c of ['lilac', 'peach', 'sky']) { await nub.send({ settings: { color: c } }); mark('color_' + c); console.log('view', await N("(document.querySelector('#content > .view:not(.out)')||{}).className")); await wait(1050); }
  mark('colors_end');
  await nub.send({ settings: { color: 'mint' } });
  await wait(400);

  // ===== 9. Poke =====
  let vcls = await N("(document.querySelector('#content > .view:not(.out)')||{}).className||''");
  console.log('view before poke', vcls);
  if (!/panel/.test(String(vcls))) { await hand.move(notchX + 40, 38, 0.5); await wait(500); if (!/panel/.test(await VIEW())) await hand.click(); await wait(700); }
  const m = await el('#content > .view:not(.out) .card .nubbi');
  await hand.move(m.x, m.y, 0.6); await wait(200);
  mark('poke');
  for (let i = 0; i < 7; i++) { await hand.click(); await wait(95); }
  mark('dizzy');
  await hand.move(m.x + 160, m.y + 180, 0.5);
  await wait(3800);
  mark('poke_end');

  // ===== 10. End card =====
  await demo({ cmd: 'collapse' });
  await hand.move(2700, 2100, 0.3);
  mark('end');
  await S(`stage.E.show()`);
  await wait(4200);
  mark('end_end');
  FF = null; ff.stdin.write('q'); await new Promise((r) => ff.on('close', r));
  console.log('done');
  kill(); process.exit(0);
})().catch((e) => { console.error('DIRECTOR ERROR', e); try { mark('error', { e: String(e) }); } catch {} kill(); process.exit(1); });
