// Live check of the keyless default provider (real network). node e2e/live-free.js
const P = require('../src/providers');
const doc = { name: 'launch-note.txt', kind: 'text', mime: 'text/plain', text: 'Team note: the Nubbi launch moved from 28 November to 12 December because the icon pass slipped. Owner: Ana.' };
(async () => {
  let streamed = ''; const t = Date.now();
  try {
    const r = await P.ask({ provider: 'free', doc, history: [], question: 'When is the launch now, and why did it move?', onDelta: (d) => (streamed += d), onStatus: (s) => console.log('status', s) });
    console.log(JSON.stringify({ ok: true, ms: Date.now() - t, model: r.model, text: r.text, streamedChars: streamed.length }, null, 1));
  } catch (e) { console.log('ERR', e.code, e.message); process.exit(1); }
})();
