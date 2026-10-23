// Screenshot/integration driver. Only loaded when NUBBI_SCREENSHOT=<dir> is set.
// Drives the real UI through the real hook relay script + HTTP server, and the REAL keyless Free provider.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { BrowserWindow } = require('electron');
const installer = require('./hooks/installer');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[demo]', ...a);

function hook(HOME, event, payload, env = {}) {
  return new Promise((resolve) => {
    const script = path.join(HOME, '.nubbi', 'nubbi-hook.sh');
    const p = spawn('sh', [script, event], { env: { ...process.env, HOME, TERM_PROGRAM: 'iTerm.app', __CFBundleIdentifier: 'com.googlecode.iterm2', ...env } });
    let out = ''; p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(JSON.stringify(payload));
  });
}

function makePdf(file) {
  // Small valid one-page PDF "quote" (generated, no external assets)
  const text = 'BT /F1 22 Tf 72 720 Td (Quote #2026-114  -  Studio Lumen) Tj 0 -40 Td /F1 14 Tf (Design sprint 3 days ........ EUR 3,000) Tj 0 -22 Td (Prototype & handoff ......... EUR 1,050) Tj 0 -22 Td (VAT 20% ...................... EUR 810) Tj 0 -30 Td /F1 16 Tf (Total due: EUR 4,860 by 15 Nov 2026) Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  // pad with a comment stream so the progress bar has something to chew on (still a valid PDF)
  fs.writeFileSync(file, pdf + '%' + 'x'.repeat(2_000_000) + '\n');
}

async function run({ notch, openSettings, trayMenu, hookServer, HOME, settings, broadcastSettings, out }) {
  const raw = path.join(out, 'raw'); fs.mkdirSync(raw, { recursive: true });
  const results = {};
  const js = (code) => notch.webContents.executeJavaScript(code, true);
  const demo = (c) => notch.webContents.send('demo', c);
  const shot = async (name, win = notch) => { await wait(60); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(raw, name + '.png'), img.toPNG()); log('captured', name, img.getSize()); };
  try {
    settings.patch({ provider: 'free', color: 'mint', email: 'me@example.com', onboarded: true });
    installer.install({ home: HOME, srcScript: path.join(__dirname, 'hooks', 'nubbi-hook.sh') });
    broadcastSettings();
    await new Promise((r) => (notch.webContents.isLoading() ? notch.webContents.once('did-finish-load', r) : r()));
    await wait(3600); // launch peek plays and retracts

    await shot('01-idle-notch');
    demo({ cmd: 'peek' }); await wait(820); demo({ cmd: 'cursor', x: 250, y: 60 }); await shot('02-nubbi-peek'); await wait(2200);

    const s1 = { session_id: 's-korus', cwd: '/Users/me/code/korus', transcript_path: '/tmp/t.jsonl' };
    await hook(HOME, 'SessionStart', { ...s1, hook_event_name: 'SessionStart', source: 'startup' });
    await wait(2900);
    await hook(HOME, 'UserPromptSubmit', { ...s1, hook_event_name: 'UserPromptSubmit', prompt: 'Fix the flaky checkout test' });
    await hook(HOME, 'PreToolUse', { ...s1, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/Users/me/code/korus/src/checkout.test.ts' } });
    demo({ cmd: 'open' }); await wait(900); demo({ cmd: 'cursor', x: 390, y: 160 });
    await shot('03-session-working');

    const s2 = { session_id: 's-landing', cwd: '/Users/me/code/landing' };
    await hook(HOME, 'SessionStart', { ...s2, hook_event_name: 'SessionStart', source: 'startup' });
    await hook(HOME, 'UserPromptSubmit', { ...s2, hook_event_name: 'UserPromptSubmit', prompt: 'Update hero copy' });
    await hook(HOME, 'PreToolUse', { ...s2, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/Users/me/code/landing/app/page.tsx' } });
    const permPayload = { ...s1, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test -- checkout', description: 'Run checkout tests' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] };
    const pending = hook(HOME, 'PermissionRequest', permPayload);
    await wait(1000);
    await shot('04-permission');
    await js(`document.querySelector('[data-d=allow]').click()`);
    const perm = await pending;
    results.permissionRoundTrip = perm.out;
    log('permission hook output:', perm.out);
    await hook(HOME, 'PostToolUse', { ...s1, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: permPayload.tool_input, tool_response: { stdout: '14 passing' } });
    await wait(700);
    await shot('05-success');

    // drag & drop flow (shots only; the real XDND drop is covered by e2e/run-all.sh)
    demo({ cmd: 'collapse' }); await wait(500);
    demo({ cmd: 'drag' }); await wait(800);
    await shot('06-drop-zone');
    const pdf = path.join(HOME, 'quote.pdf'); makePdf(pdf);
    demo({ cmd: 'upload', path: pdf, name: 'quote.pdf' });
    for (let i = 0; i < 100; i++) { const p = await js(`(document.querySelector('.view.upload:not(.out) .pct')||{}).textContent||''`); if (parseInt(p) >= 66) break; await wait(10); }
    demo({ cmd: 'freezeUpload' }); await wait(120);
    await shot('07-upload-progress');
    demo({ cmd: 'upload', path: pdf, name: 'quote.pdf' }); await wait(1900);
    await shot('08-file-ready');
    demo({ cmd: 'picker' }); await wait(700);
    await shot('08b-provider-picker');
    demo({ cmd: 'picker' }); await wait(400);

    // REAL answer from the keyless Free provider (live network, no mock)
    const q = 'What’s the total and when is it due?';
    const t0 = Date.now();
    demo({ cmd: 'ask', q });
    let liveText = '';
    for (let i = 0; i < 900; i++) {
      await wait(100);
      const st = await js(`(() => { const v = document.querySelector('.view.answer:not(.out)'); if (!v) return null;
        return { caret: !!v.querySelector('.caret'), text: (v.querySelector('.md') || {}).innerText || '', err: !!v.querySelector('.errrow'), sub: (v.querySelector('#aSub')||{}).textContent }; })()`);
      if (st && !st.caret && (st.err || st.text.length > 20)) { liveText = st.text; results.live = { ...st, ms: Date.now() - t0 }; break; }
    }
    log('live answer', JSON.stringify(results.live));
    await wait(600);
    await shot('09-answer-live');

    // no-key flow for a keyed provider
    settings.patch({ provider: 'gemini' }); broadcastSettings(); await wait(300);
    demo({ cmd: 'nokey' }); await wait(900);
    await shot('09b-no-key');
    settings.patch({ provider: 'free' }); broadcastSettings(); await wait(300);

    // colours
    for (const c of ['peach', 'lilac', 'sky']) {
      settings.patch({ color: c }); broadcastSettings();
      demo({ cmd: 'open' }); await wait(900); demo({ cmd: 'cursor', x: 300, y: 120 }); await wait(300);
      await shot('11-color-' + c);
    }
    settings.patch({ color: 'mint' }); broadcastSettings();

    // easter egg
    demo({ cmd: 'open' }); await wait(700);
    await js(`(async()=>{const m=document.querySelector('.view.panel:not(.out) .nubbi');for(let i=0;i<7;i++){m.dispatchEvent(new MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,80));}})()`);
    await wait(900);
    await shot('10-dizzy');
    await wait(3600);

    // tray menu (replica rendered from the real menu template)
    const items = trayMenu().items.map((i) => ({ type: i.type, label: i.label, checked: i.checked, enabled: i.enabled, acc: i.accelerator || '' }));
    fs.writeFileSync(path.join(raw, 'tray-items.json'), JSON.stringify(items, null, 2));

    const sw = openSettings();
    await new Promise((r) => sw.webContents.once('did-finish-load', r)); await wait(900);
    await sw.webContents.executeJavaScript(`document.querySelector('main').style.paddingTop='30px'`);
    await shot('12-settings', sw);
    const fullH = await sw.webContents.executeJavaScript('document.documentElement.scrollHeight');
    sw.setContentSize(620, Math.min(1400, fullH)); await wait(500);
    await shot('12b-settings-full', sw);
    await sw.webContents.executeJavaScript(`document.querySelector('#provs .prov[data-id=gemini]').click()`); await wait(700);
    await shot('12c-settings-gemini', sw);
    await sw.webContents.executeJavaScript(`document.querySelector('#provs .prov[data-id=free]').click()`); await wait(300);
    results.ok = true;
  } catch (e) { results.error = String(e.stack || e); log('ERROR', e); }
  fs.writeFileSync(path.join(raw, 'results.json'), JSON.stringify(results, null, 2));
  setTimeout(() => require('electron').app.exit(0), 300);
}
module.exports = { run };
