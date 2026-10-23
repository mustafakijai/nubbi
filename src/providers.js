// AI providers for "ask about this file". One neutral doc + Q&A history in, streamed text out.
// Formats checked against each provider's official docs (Oct 2026):
//   free (Pollinations) : POST https://text.pollinations.ai/openai — OpenAI chat format, SSE, keyless (APIDOCS.md)
//                         with an optional free key: https://gen.pollinations.ai/v1/chat/completions (Bearer)
//   gemini              : POST /v1beta/models/{model}:streamGenerateContent?alt=sse, header x-goog-api-key
//   groq                : POST https://api.groq.com/openai/v1/chat/completions (OpenAI format, Bearer)
//   openrouter          : POST https://openrouter.ai/api/v1/chat/completions (OpenAI format, Bearer); free models = ids ending ":free"
//   ollama              : POST {host}/api/chat (NDJSON stream, images = base64 in message.images); GET /api/tags
//   claude              : POST https://api.anthropic.com/v1/messages (SSE, x-api-key, anthropic-version 2023-06-01)
const brand = require('./brand.json');

const env = (k, d) => process.env[`${brand.envPrefix}_${k}`] || d;
const SYSTEM = `You are ${brand.mascot}, a friendly little assistant that lives in the Mac notch.
The user dropped a file on you and asked about it. Lead with the answer, keep it tight and skimmable
(short paragraphs, bullets when useful), use Markdown, and quote exact figures/names from the file when relevant.
If the file doesn't contain the answer, say so plainly.`;
const DEFAULT_Q = 'What is this? Give me the key points.';

const PROVIDERS = {
  free: {
    id: 'free', label: 'Free — no key needed', short: 'Free', needsKey: false, optionalKey: true,
    keyUrl: 'https://enter.pollinations.ai', keyName: 'Pollinations key (optional)',
    note: 'Free community service by Pollinations.ai — no sign-up, but no privacy guarantees and a shared rate limit. Don’t send sensitive files. Reads text, PDFs (text) and documents; images need a free key or another provider.',
    models: [['openai-fast', 'GPT-OSS 20B (free)']], def: 'openai-fast', maxText: 60000,
    vision: (m, s) => !!s.key, pdf: false,
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini — free key', short: 'Gemini', needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey', keyName: 'Gemini API key',
    note: 'Free tier from Google AI Studio (no card). Reads images and PDFs natively. Free-tier prompts may be used by Google to improve products.',
    models: [['gemini-3.8-flash', 'Gemini 3.8 Flash (recommended)'], ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite (fastest)'], ['gemini-3.6-flash', 'Gemini 3.6 Flash'], ['gemini-flash-latest', 'Gemini Flash (latest alias)']],
    def: 'gemini-3.8-flash', maxText: 600000, vision: () => true, pdf: true,
  },
  groq: {
    id: 'groq', label: 'Groq — free key', short: 'Groq', needsKey: true,
    keyUrl: 'https://console.groq.com/keys', keyName: 'Groq API key',
    note: 'Very fast open models on a free tier (no card). Free tier has small per-minute token limits, so long files are trimmed. Images use Qwen vision automatically.',
    models: [['openai/gpt-oss-120b', 'GPT-OSS 120B (default)'], ['openai/gpt-oss-20b', 'GPT-OSS 20B (fastest)'], ['llama-3.3-70b-versatile', 'Llama 3.3 70B'], ['qwen/qwen3.8-27b', 'Qwen 3.8 27B (vision)']],
    def: 'openai/gpt-oss-120b', visionModel: 'qwen/qwen3.8-27b', maxText: 22000, vision: (m) => /qwen3\.8|vision|scout|maverick/i.test(m), pdf: false,
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter — free models', short: 'OpenRouter', needsKey: true,
    keyUrl: 'https://openrouter.ai/keys', keyName: 'OpenRouter API key',
    note: 'Free key; only models ending in “:free” are listed (no credit spent). Free models have daily request limits and some providers may log prompts.',
    models: [['google/gemma-4-31b-it:free', 'Gemma 4 31B (free, vision)']], def: 'google/gemma-4-31b-it:free', maxText: 200000,
    vision: (m, s) => (s.visionIds ? s.visionIds.includes(m) : /gemma-4|vl|omni|inkling/i.test(m)), pdf: false,
  },
  ollama: {
    id: 'ollama', label: 'Ollama — on this Mac', short: 'Ollama', needsKey: false,
    keyUrl: 'https://ollama.com/download', keyName: '',
    note: 'Runs models locally — free and private, nothing leaves your Mac. Install Ollama and pull a model (e.g. “ollama pull gemma4”).',
    models: [], def: '', maxText: 48000, vision: (m, s) => !!(s.visionIds && s.visionIds.includes(m)), pdf: false,
  },
  claude: {
    id: 'claude', label: 'Claude — your API key', short: 'Claude', needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys', keyName: 'Anthropic API key',
    note: 'Best quality; paid API usage on your Anthropic account. Reads images and PDFs natively.',
    models: [['claude-sonnet-5-5', 'Sonnet 5.5 — fast & smart'], ['claude-opus-5-5', 'Opus 5.5 — deepest reasoning'], ['claude-haiku-5-5', 'Haiku 5.5 — quickest']],
    def: 'claude-sonnet-5-5', maxText: 600000, vision: () => true, pdf: true,
  },
};
const ORDER = ['free', 'gemini', 'groq', 'openrouter', 'ollama', 'claude'];

class ProviderError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
  toJSON() { return { code: this.code, message: this.message, provider: this.provider, keyUrl: this.keyUrl, retryAfter: this.retryAfter }; }
}
const perr = (p, code, message, extra) => new ProviderError(code, message, { provider: p.id, keyUrl: p.keyUrl, ...extra });

// ---------- message building ----------
const fileTag = (doc, text) => `<file name="${String(doc.name).replace(/"/g, '')}">\n${text}\n</file>`;
function docTextFor(p, doc) {
  let t = doc.text || '';
  if (t.length > p.maxText) t = t.slice(0, p.maxText) + `\n…[truncated: only the first ${Math.round((p.maxText / t.length) * 100)}% of the file fits this provider’s free limit — say so if the answer may be later in the file]`;
  return fileTag(doc, t);
}

/**
 * Decide how the doc goes to this provider: 'image' | 'pdf' (native) | 'text'.
 * Throws a friendly ProviderError if it can't be sent at all.
 */
function attachMode(p, doc, model, st = {}) {
  if (doc.kind === 'image') {
    if (p.vision(model, st)) return 'image';
    if (p.visionModel) return 'image';
    const hint = p.id === 'free' ? 'The free no-key service only reads text. For images, add a free Gemini key (30 seconds at aistudio.google.com) or a free Pollinations key.' :
      p.id === 'ollama' ? 'This Ollama model can’t see images — pull a vision model (e.g. “ollama pull gemma4”) and pick it.' : 'Pick a model that supports images, or switch to Gemini.';
    throw perr(p, 'NO_VISION', `${p.short} can’t look at images with this model. ${hint}`, { keyUrl: p.id === 'free' ? PROVIDERS.gemini.keyUrl : p.keyUrl });
  }
  if (doc.kind === 'pdf') {
    if (p.pdf && doc.data && doc.data.length < 26e6) return 'pdf';
    if (!doc.text) throw perr(p, 'NO_TEXT', `This PDF has no selectable text (it looks scanned). ${p.short} reads PDF text only — switch to Gemini (free key) or Claude, which read scanned PDFs.`, { keyUrl: PROVIDERS.gemini.keyUrl });
    return 'text';
  }
  return 'text';
}

/** Neutral turns: [{role:'user'|'assistant', text, attach?}] */
function turns(doc, history, question) {
  const out = [];
  history.forEach((h, i) => { out.push({ role: 'user', text: h.q || DEFAULT_Q, attach: i === 0 }); out.push({ role: 'assistant', text: h.a }); });
  out.push({ role: 'user', text: question || DEFAULT_Q, attach: history.length === 0 });
  return out;
}

function openaiMessages(p, doc, ts, mode) {
  const msgs = [{ role: 'system', content: SYSTEM }];
  for (const t of ts) {
    if (t.role === 'assistant') { msgs.push({ role: 'assistant', content: t.text }); continue; }
    if (!t.attach) { msgs.push({ role: 'user', content: t.text }); continue; }
    if (mode === 'image') msgs.push({ role: 'user', content: [{ type: 'text', text: `${fileTag(doc, '(image attached)')}\n\n${t.text}` }, { type: 'image_url', image_url: { url: `data:${doc.mime};base64,${doc.data}` } }] });
    else msgs.push({ role: 'user', content: `${docTextFor(p, doc)}\n\n${t.text}` });
  }
  return msgs;
}

function geminiBody(p, doc, ts, mode) {
  const contents = ts.map((t) => {
    if (t.role === 'assistant') return { role: 'model', parts: [{ text: t.text }] };
    if (!t.attach) return { role: 'user', parts: [{ text: t.text }] };
    const parts = mode === 'text' ? [{ text: docTextFor(p, doc) }] : [{ inline_data: { mime_type: doc.mime, data: doc.data } }, { text: `(file: ${doc.name})` }];
    return { role: 'user', parts: [...parts, { text: t.text }] };
  });
  return { system_instruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { maxOutputTokens: 8192 } };
}

function claudeMessages(p, doc, ts, mode) {
  return ts.map((t) => {
    if (t.role === 'assistant') return { role: 'assistant', content: t.text };
    if (!t.attach) return { role: 'user', content: [{ type: 'text', text: t.text }] };
    const block = mode === 'image' ? { type: 'image', source: { type: 'base64', media_type: doc.mime, data: doc.data } }
      : mode === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.data }, title: doc.name }
        : { type: 'text', text: docTextFor(p, doc) };
    return { role: 'user', content: [block, { type: 'text', text: t.text }] };
  });
}

function ollamaMessages(p, doc, ts, mode) {
  const msgs = [{ role: 'system', content: SYSTEM }];
  for (const t of ts) {
    if (t.role === 'assistant') msgs.push({ role: 'assistant', content: t.text });
    else if (!t.attach) msgs.push({ role: 'user', content: t.text });
    else if (mode === 'image') msgs.push({ role: 'user', content: `${fileTag(doc, '(image attached)')}\n\n${t.text}`, images: [doc.data] });
    else msgs.push({ role: 'user', content: `${docTextFor(p, doc)}\n\n${t.text}` });
  }
  return msgs;
}

// ---------- requests ----------
function endpoints(o = {}) {
  return {
    free: env('FREE_BASE', 'https://text.pollinations.ai'),
    freeKeyed: env('FREE_KEY_BASE', 'https://gen.pollinations.ai'),
    gemini: env('GEMINI_BASE', 'https://generativelanguage.googleapis.com'),
    groq: env('GROQ_BASE', 'https://api.groq.com'),
    openrouter: env('OPENROUTER_BASE', 'https://openrouter.ai'),
    ollama: (o.ollamaUrl || env('OLLAMA_BASE', 'http://127.0.0.1:11434')).replace(/\/+$/, ''),
    claude: env('API_BASE', 'https://api.anthropic.com'),
  };
}

/** Build {url, headers, body, format} for a request. Exported for tests. */
function buildRequest({ provider, model, key, doc, history = [], question, ollamaUrl, visionIds }) {
  const p = PROVIDERS[provider];
  if (!p) throw new ProviderError('BAD_PROVIDER', `Unknown provider “${provider}”.`);
  if (p.needsKey && !key) throw perr(p, 'NO_KEY', `${p.short} needs a free API key — it takes about a minute to get one.`);
  let m = model || p.def;
  if (provider === 'ollama' && !m) throw perr(p, 'NO_MODEL', 'No Ollama model installed yet — run “ollama pull gemma4” in Terminal, then pick it in Settings.');
  const st = { key, visionIds };
  const mode = attachMode(p, doc, m, st);
  if (mode === 'image' && !p.vision(m, st) && p.visionModel) m = p.visionModel;
  if (provider === 'groq' && mode === 'image' && doc.data.length > 4e6) throw perr(p, 'TOO_BIG', 'Groq accepts images up to about 3 MB — try a smaller screenshot, or use Gemini.');
  const ts = turns(doc, history, question);
  const E = endpoints({ ollamaUrl });
  const json = { 'content-type': 'application/json' };
  switch (provider) {
    case 'free': {
      const body = { model: key ? 'openai' : m, messages: openaiMessages(p, doc, ts, mode), stream: true };
      if (key) return { url: `${E.freeKeyed}/v1/chat/completions`, headers: { ...json, authorization: `Bearer ${key}` }, body, format: 'openai', model: body.model, mode };
      return { url: `${E.free}/openai`, headers: json, body: { ...body, referrer: brand.slug }, format: 'openai', model: m, mode };
    }
    case 'groq':
      return { url: `${E.groq}/openai/v1/chat/completions`, headers: { ...json, authorization: `Bearer ${key}` }, body: { model: m, messages: openaiMessages(p, doc, ts, mode), stream: true, max_completion_tokens: 4096 }, format: 'openai', model: m, mode };
    case 'openrouter':
      return { url: `${E.openrouter}/api/v1/chat/completions`, headers: { ...json, authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://github.com/mustafakijai/nubbi', 'X-Title': brand.name }, body: { model: m, messages: openaiMessages(p, doc, ts, mode), stream: true }, format: 'openai', model: m, mode };
    case 'gemini':
      return { url: `${E.gemini}/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`, headers: { ...json, 'x-goog-api-key': key }, body: geminiBody(p, doc, ts, mode), format: 'gemini', model: m, mode };
    case 'ollama':
      return { url: `${E.ollama}/api/chat`, headers: json, body: { model: m, messages: ollamaMessages(p, doc, ts, mode), stream: true, options: { num_ctx: 16384 } }, format: 'ollama', model: m, mode };
    case 'claude':
      return { url: `${E.claude}/v1/messages`, headers: { ...json, 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: { model: m, max_tokens: 8000, stream: true, system: SYSTEM, messages: claudeMessages(p, doc, ts, mode) }, format: 'claude', model: m, mode };
  }
}

function retryAfterOf(res, bodyText) {
  const h = res.headers.get('retry-after');
  if (h && /^\d+(\.\d+)?$/.test(h.trim())) return Math.ceil(+h);
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(bodyText) || /retry (?:after|in) (\d+(?:\.\d+)?)\s*s/i.exec(bodyText) || /"retryAfterSeconds"\s*:\s*(\d+)/.exec(bodyText);
  return m ? Math.ceil(+m[1]) : null;
}

function httpError(p, res, bodyText, hadKey) {
  let detail = '';
  try { const j = JSON.parse(bodyText); const e = Array.isArray(j) ? j[0] && j[0].error : j.error; detail = (e && (e.message || (typeof e === 'string' ? e : ''))) || j.message || ''; } catch { detail = bodyText.slice(0, 200); }
  const s = res.status;
  if (s === 401 || s === 403) {
    if (!p.needsKey && !hadKey) return perr(p, 'SERVICE', `${p.short} refused the request (${s}). ${detail}`.trim());
    return perr(p, 'AUTH', `Your ${p.keyName || p.short + ' key'} was rejected — paste a fresh one in Settings.`);
  }
  if (s === 402 || s === 429) {
    const ra = retryAfterOf(res, bodyText);
    const quota = /quota|daily|per day|credits|exhausted/i.test(detail) && !/minute/i.test(detail);
    const msg = p.id === 'free'
      ? `The free service is busy (shared limit)${ra ? ` — next free slot in ${ra}s` : ''}. A free Pollinations key or a free Gemini key avoids the wait.`
      : quota ? `You’ve hit ${p.short}’s free daily limit. Try another free provider, or come back tomorrow.`
        : `${p.short} rate-limited this request${ra ? ` — try again in ${ra}s` : ' — try again in a moment'}.`;
    return perr(p, 'RATE_LIMIT', msg, { retryAfter: ra });
  }
  if (s === 413) return perr(p, 'TOO_BIG', `This file is too big for ${p.short}’s free limit — try a shorter file or Gemini (1M-token context).`);
  if (s === 404) return perr(p, 'MODEL', `${p.short} doesn’t know that model — pick another one in Settings.${detail ? ` (${detail})` : ''}`);
  if (s === 400 && /context|too long|maximum|tokens/i.test(detail)) return perr(p, 'TOO_BIG', `This file is too long for this ${p.short} model — try Gemini (1M-token context) or a shorter file.`);
  if (s >= 500) return perr(p, 'SERVICE', `${p.short} is having trouble right now (${s}). Try again or switch provider.`);
  return perr(p, 'SERVICE', detail || `${p.short} returned ${s}.`);
}

/** Parse a streamed body. Yields text deltas only (reasoning/thinking is ignored). */
async function* deltas(res, format) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const handle = function* (line) {
    line = line.trim();
    if (!line) return;
    if (format === 'ollama') {
      let j; try { j = JSON.parse(line); } catch { return; }
      if (j.error) throw new ProviderError('SERVICE', String(j.error));
      if (j.message && j.message.content) yield j.message.content;
      return;
    }
    if (!line.startsWith('data:')) return; // comments (": OPENROUTER PROCESSING"), event: lines
    const data = line.slice(5).trim();
    if (data === '[DONE]') return;
    let j; try { j = JSON.parse(data); } catch { return; }
    if (format === 'openai') {
      if (j.error) throw new ProviderError('SERVICE', j.error.message || String(j.error));
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (d && typeof d.content === 'string' && d.content) yield d.content;
    } else if (format === 'gemini') {
      if (j.error) throw new ProviderError('SERVICE', j.error.message || 'Gemini error');
      const c = j.candidates && j.candidates[0];
      for (const part of (c && c.content && c.content.parts) || []) if (part.text && !part.thought) yield part.text;
      if (c && c.finishReason && /SAFETY|PROHIBITED|BLOCKLIST/.test(c.finishReason)) throw new ProviderError('BLOCKED', 'Gemini declined to answer this one (safety filter).');
    } else if (format === 'claude') {
      if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') yield j.delta.text;
      else if (j.type === 'error') throw new ProviderError('SERVICE', (j.error && j.error.message) || 'Claude stream error');
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); yield* handle(line); }
  }
  if (buf) yield* handle(buf);
}

const sleep = (ms, signal) => new Promise((r, j) => { const t = setTimeout(r, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); j(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); });

/**
 * Ask a provider. onDelta(text) per chunk, onStatus({wait}) while auto-waiting for the free tier.
 * Resolves { text, model, mode }. Rejects with ProviderError (or AbortError).
 */
async function ask(opts) {
  const { onDelta, onStatus, signal, fetchImpl = fetch } = opts;
  const p = PROVIDERS[opts.provider];
  const req = buildRequest(opts);
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal }); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      if (p.id === 'ollama') throw perr(p, 'OFFLINE', 'Ollama isn’t running — open the Ollama app (or run “ollama serve”) and try again.');
      throw perr(p, 'OFFLINE', `Couldn’t reach ${p.short} — check your internet connection.`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const err = httpError(p, res, t, !!opts.key);
      // The free tier allows one request at a time per IP — wait once for the slot (up to 45 s) instead of failing.
      if (err.code === 'RATE_LIMIT' && p.id === 'free' && attempt === 0 && (err.retryAfter || 20) <= 45) {
        const secs = err.retryAfter || 20;
        for (let s = secs; s > 0; s--) { onStatus && onStatus({ wait: s }); await sleep(1000, signal); }
        onStatus && onStatus({ wait: 0 });
        continue;
      }
      throw err;
    }
    let full = '';
    for await (const d of deltas(res, req.format)) { full += d; onDelta && onDelta(d); }
    if (!full.trim()) throw perr(p, 'EMPTY', `${p.short} returned an empty answer — try again or switch provider.`);
    return { text: full, model: req.model, mode: req.mode };
  }
}

// ---------- model discovery ----------
async function getJSON(url, headers = {}, ms = 2500, fetchImpl = fetch) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetchImpl(url, { headers, signal: ac.signal }); if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status }); return await r.json(); }
  finally { clearTimeout(t); }
}

/** Live model list for a provider. Returns { models:[[id,label]], def, visionIds?, available, error? } */
async function listModels(provider, { key, ollamaUrl, fetchImpl } = {}) {
  const p = PROVIDERS[provider]; const E = endpoints({ ollamaUrl });
  const base = { models: p.models, def: p.def, available: true };
  try {
    if (provider === 'ollama') {
      const j = await getJSON(`${E.ollama}/api/tags`, {}, 1200, fetchImpl);
      const names = (j.models || []).map((m) => m.name || m.model).filter(Boolean);
      const visionIds = [];
      await Promise.all(names.map(async (n) => {
        try {
          const r = await (fetchImpl || fetch)(`${E.ollama}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: n }) });
          const s = await r.json();
          if ((s.capabilities || []).includes('vision') || (s.projector_info && Object.keys(s.projector_info).length)) visionIds.push(n);
        } catch {}
      }));
      return { models: names.map((n) => [n, n + (visionIds.includes(n) ? ' (vision)' : '')]), def: names[0] || '', visionIds, available: true, running: true };
    }
    if (provider === 'openrouter') {
      const j = await getJSON(`${E.openrouter}/api/v1/models`, {}, 6000, fetchImpl);
      const free = (j.data || []).filter((m) => /:free$/.test(m.id) && ((m.architecture && m.architecture.output_modalities) || ['text']).includes('text') && !/safety|guard/i.test(m.id));
      const visionIds = free.filter((m) => ((m.architecture && m.architecture.input_modalities) || []).includes('image')).map((m) => m.id);
      free.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
      const models = free.map((m) => [m.id, `${(m.name || m.id).replace(/\s*\(free\)\s*$/i, '')}${visionIds.includes(m.id) ? ' · vision' : ''}`]);
      const def = (models.find(([id]) => id === p.def) || models.find(([id]) => visionIds.includes(id)) || models[0] || [p.def])[0];
      return { models: models.length ? models : p.models, def, visionIds, available: true };
    }
    if (provider === 'groq' && key) {
      const j = await getJSON(`${E.groq}/openai/v1/models`, { authorization: `Bearer ${key}` }, 4000, fetchImpl);
      const ids = (j.data || []).filter((m) => m.active !== false && !/whisper|tts|guard|orpheus|playai|compound|prompt-guard/i.test(m.id)).map((m) => m.id);
      const known = new Map(p.models);
      const models = [...p.models.filter(([id]) => ids.includes(id)), ...ids.filter((id) => !known.has(id)).map((id) => [id, id])];
      return { models: models.length ? models : p.models, def: p.def, available: true };
    }
  } catch (e) {
    if (provider === 'ollama') return { models: [], def: '', visionIds: [], available: false, running: false, error: 'Ollama isn’t running on this Mac (looked at ' + E.ollama + ').' };
    return { ...base, error: e.message };
  }
  return base;
}

/** What the renderer may know about providers (no secrets). */
function catalog() {
  return ORDER.map((id) => { const p = PROVIDERS[id]; return { id, label: p.label, short: p.short, needsKey: p.needsKey, optionalKey: !!p.optionalKey, keyUrl: p.keyUrl, keyName: p.keyName, note: p.note, models: p.models, def: p.def, pdf: p.pdf }; });
}

module.exports = { PROVIDERS, ORDER, ProviderError, ask, buildRequest, listModels, catalog, deltas, httpError, attachMode, SYSTEM };
