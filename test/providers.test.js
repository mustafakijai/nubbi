const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const P = require('../src/providers');

const txtDoc = { name: 'notes.txt', kind: 'text', text: 'The secret word is pineapple.' };
const pdfDoc = { name: 'inv.pdf', kind: 'pdf', mime: 'application/pdf', data: 'JVBERi0x', text: '--- Page 1 ---\nInvoice total: 4,860 EUR' };
const scanned = { ...pdfDoc, text: '' };
const imgDoc = { name: 'shot.png', kind: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' };

// One mock server speaking all five wire formats; records requests.
function mock(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        const r = { method: req.method, url: req.url, headers: req.headers, body: b ? JSON.parse(b) : null }; seen.push(r);
        handler(r, res);
      });
    }).listen(0, '127.0.0.1', () => resolve({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const sse = (res, lines) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const l of lines) res.write(l + '\n\n'); res.end(); };
function streamFor(r, res) {
  if (r.url.startsWith('/openai') || r.url.includes('/chat/completions')) return sse(res, [': OPENROUTER PROCESSING', 'data: {"choices":[{"delta":{"reasoning":"hmm"}}]}', 'data: {"choices":[{"delta":{"content":"Pine"}}]}', 'data: {"choices":[{"delta":{"content":"apple."}}]}', 'data: [DONE]']);
  if (r.url.includes(':streamGenerateContent')) return sse(res, ['data: {"candidates":[{"content":{"parts":[{"text":"thinking…","thought":true}]}}]}', 'data: {"candidates":[{"content":{"parts":[{"text":"Pineapple."}]},"finishReason":"STOP"}]}']);
  if (r.url === '/v1/messages') return sse(res, ['event: message_start\ndata: {"type":"message_start"}', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Pineapple."}}', 'data: {"type":"message_stop"}']);
  if (r.url === '/api/chat') { res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.write('{"message":{"content":"Pine"},"done":false}\n{"message":{"content":"apple."},"done":false}\n'); return res.end('{"done":true}\n'); }
  res.writeHead(404); res.end('{}');
}
const envAll = (base) => { for (const k of ['FREE_BASE', 'FREE_KEY_BASE', 'GEMINI_BASE', 'GROQ_BASE', 'OPENROUTER_BASE', 'API_BASE', 'OLLAMA_BASE']) process.env['NUBBI_' + k] = base; };

test('every provider streams an answer in its own wire format (reasoning/thought parts ignored)', async () => {
  const m = await mock(streamFor); envAll(m.base);
  try {
    for (const [provider, model] of [['free'], ['gemini'], ['groq'], ['openrouter'], ['ollama', 'gemma4:latest'], ['claude']]) {
      let streamed = '';
      const r = await P.ask({ provider, model, key: provider === 'free' || provider === 'ollama' ? '' : 'k-123', doc: txtDoc, history: [], question: 'What is the secret word?', onDelta: (d) => (streamed += d) });
      assert.strictEqual(r.text, 'Pineapple.', provider); assert.strictEqual(streamed, 'Pineapple.');
    }
    const by = (s) => m.seen.find((r) => r.url.includes(s));
    const free = by('/openai'); assert.strictEqual(free.body.model, 'openai-fast'); assert.ok(!free.headers.authorization); assert.strictEqual(free.body.stream, true);
    assert.match(free.body.messages[1].content, /<file name="notes.txt">\nThe secret word is pineapple/);
    const gem = by(':streamGenerateContent'); assert.strictEqual(gem.headers['x-goog-api-key'], 'k-123'); assert.match(gem.url, /\/v1beta\/models\/[^/]+:streamGenerateContent\?alt=sse/);
    assert.ok(gem.body.system_instruction.parts[0].text); assert.strictEqual(gem.body.contents[0].role, 'user');
    const groq = by('/openai/v1/chat/completions'); assert.strictEqual(groq.headers.authorization, 'Bearer k-123');
    const or = by('/api/v1/chat/completions'); assert.ok(or.headers['http-referer'] && or.headers['x-title'] === 'Nubbi');
    const ol = by('/api/chat'); assert.strictEqual(ol.body.model, 'gemma4:latest'); assert.strictEqual(ol.body.options.num_ctx, 16384);
    const cl = by('/v1/messages'); assert.strictEqual(cl.headers['anthropic-version'], '2023-06-01'); assert.strictEqual(cl.headers['x-api-key'], 'k-123');
  } finally { m.srv.close(); }
});

test('native attachments: Gemini/Claude get PDF+image inline, Groq switches to its vision model, Ollama gets images[]', () => {
  const g = P.buildRequest({ provider: 'gemini', key: 'k', doc: pdfDoc, question: 'q' });
  assert.deepStrictEqual(g.body.contents[0].parts[0], { inline_data: { mime_type: 'application/pdf', data: 'JVBERi0x' } });
  const c = P.buildRequest({ provider: 'claude', key: 'k', doc: pdfDoc, question: 'q' });
  assert.strictEqual(c.body.messages[0].content[0].type, 'document');
  const ci = P.buildRequest({ provider: 'claude', key: 'k', doc: imgDoc, question: 'q' });
  assert.strictEqual(ci.body.messages[0].content[0].source.media_type, 'image/png');
  const gr = P.buildRequest({ provider: 'groq', key: 'k', model: 'openai/gpt-oss-120b', doc: imgDoc, question: 'q' });
  assert.strictEqual(gr.model, P.PROVIDERS.groq.visionModel); assert.strictEqual(gr.body.messages[1].content[1].type, 'image_url');
  assert.match(gr.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  const ol = P.buildRequest({ provider: 'ollama', model: 'llava', doc: imgDoc, question: 'q', visionIds: ['llava'] });
  assert.deepStrictEqual(ol.body.messages[1].images, ['iVBORw0KGgo=']);
  // text-only providers get the extracted PDF text
  const f = P.buildRequest({ provider: 'free', doc: pdfDoc, question: 'q' });
  assert.strictEqual(f.mode, 'text'); assert.match(f.body.messages[1].content, /Invoice total: 4,860 EUR/);
});

test('friendly errors: no key, images on keyless free, scanned PDF, too big for Groq', () => {
  const code = (fn) => { try { fn(); } catch (e) { return [e.code, e.keyUrl]; } return null; };
  assert.deepStrictEqual(code(() => P.buildRequest({ provider: 'gemini', doc: txtDoc, question: 'q' })), ['NO_KEY', 'https://aistudio.google.com/apikey']);
  assert.deepStrictEqual(code(() => P.buildRequest({ provider: 'free', doc: imgDoc, question: 'q' })), ['NO_VISION', 'https://aistudio.google.com/apikey']);
  assert.strictEqual(code(() => P.buildRequest({ provider: 'groq', key: 'k', doc: scanned, question: 'q' }))[0], 'NO_TEXT');
  assert.strictEqual(code(() => P.buildRequest({ provider: 'ollama', doc: txtDoc, question: 'q' }))[0], 'NO_MODEL');
  assert.strictEqual(code(() => P.buildRequest({ provider: 'groq', key: 'k', doc: { ...imgDoc, data: 'x'.repeat(5e6) }, question: 'q' }))[0], 'TOO_BIG');
  // long text is trimmed to the provider's free-tier budget, with a visible note
  const big = P.buildRequest({ provider: 'groq', key: 'k', doc: { ...txtDoc, text: 'a'.repeat(100000) }, question: 'q' });
  assert.ok(big.body.messages[1].content.length < 24000); assert.match(big.body.messages[1].content, /truncated/);
});

test('HTTP errors map to codes with retry hints; free tier auto-waits once on 429', async () => {
  let n = 0;
  const m = await mock((r, res) => {
    if (r.url === '/openai') { if (n++ === 0) { res.writeHead(429, { 'retry-after': '1' }); return res.end('{"error":"Queue full"}'); } return streamFor(r, res); }
    if (r.url.startsWith('/openai/v1')) { res.writeHead(401); return res.end('{"error":{"message":"Invalid API Key"}}'); }
    if (r.url.includes(':streamGenerateContent')) { res.writeHead(429); return res.end('[{"error":{"code":429,"message":"Resource exhausted","details":[{"retryDelay":"17s"}]}}]'); }
    if (r.url === '/v1/messages') { res.writeHead(529); return res.end('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'); }
    res.writeHead(404); res.end('{"error":{"message":"No endpoints found for x:free"}}');
  });
  envAll(m.base);
  try {
    const waits = [];
    const r = await P.ask({ provider: 'free', doc: txtDoc, question: 'q', onStatus: (s) => waits.push(s.wait) });
    assert.strictEqual(r.text, 'Pineapple.'); assert.deepStrictEqual(waits, [1, 0]);
    const err = async (o) => { try { await P.ask({ doc: txtDoc, question: 'q', key: 'k', ...o }); } catch (e) { return e; } };
    const groq = await err({ provider: 'groq' }); assert.strictEqual(groq.code, 'AUTH'); assert.strictEqual(groq.keyUrl, 'https://console.groq.com/keys');
    const gem = await err({ provider: 'gemini' }); assert.strictEqual(gem.code, 'RATE_LIMIT'); assert.strictEqual(gem.retryAfter, 17);
    const cl = await err({ provider: 'claude' }); assert.strictEqual(cl.code, 'SERVICE');
    const or = await err({ provider: 'openrouter', model: 'x:free' }); assert.strictEqual(or.code, 'MODEL');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(gem)).code, 'RATE_LIMIT', 'serialisable over IPC');
  } finally { m.srv.close(); }
  process.env.NUBBI_OLLAMA_BASE = 'http://127.0.0.1:9';
  const off = await P.ask({ provider: 'ollama', model: 'x', doc: txtDoc, question: 'q' }).catch((e) => e);
  assert.strictEqual(off.code, 'OFFLINE'); assert.match(off.message, /Ollama/);
});

test('follow-ups resend the file in the first turn so you can switch provider mid-chat', () => {
  const h = [{ q: 'Total?', a: '4,860 EUR' }];
  const r = P.buildRequest({ provider: 'gemini', key: 'k', doc: pdfDoc, history: h, question: 'Due when?' });
  assert.deepStrictEqual(r.body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.ok(r.body.contents[0].parts[0].inline_data); assert.strictEqual(r.body.contents[2].parts[0].text, 'Due when?');
});

test('model discovery: Ollama tags + vision capability, OpenRouter :free only (guards filtered)', async () => {
  const m = await mock((r, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (r.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'gemma4:latest' }, { name: 'qwen3:8b' }] }));
    if (r.url === '/api/show') return res.end(JSON.stringify({ capabilities: r.body.model.startsWith('gemma') ? ['completion', 'vision'] : ['completion'] }));
    if (r.url === '/api/v1/models') return res.end(JSON.stringify({ data: [
      { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)', context_length: 262144, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
      { id: 'meta/llama-guard-4:free', architecture: { output_modalities: ['text'] } },
      { id: 'openai/gpt-5', architecture: { output_modalities: ['text'] } }] }));
    res.end('{}');
  });
  envAll(m.base);
  try {
    const o = await P.listModels('ollama');
    assert.deepStrictEqual(o.visionIds, ['gemma4:latest']); assert.strictEqual(o.def, 'gemma4:latest');
    const or = await P.listModels('openrouter');
    assert.deepStrictEqual(or.models.map((x) => x[0]), ['google/gemma-4-31b-it:free']); assert.deepStrictEqual(or.visionIds, ['google/gemma-4-31b-it:free']);
  } finally { m.srv.close(); }
  process.env.NUBBI_OLLAMA_BASE = 'http://127.0.0.1:9';
  const off = await P.listModels('ollama'); assert.strictEqual(off.available, false);
});

test('SSE parser copes with chunks split mid-line', async () => {
  const parts = ['data: {"choices":[{"delta":{"con', 'tent":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n', '\ndata: [DONE]\n'];
  const body = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
  let out = ''; for await (const d of P.deltas({ body }, 'openai')) out += d;
  assert.strictEqual(out, 'Hello');
});
