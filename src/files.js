// File preparation (with real progress) — provider-neutral. Providers decide how to send it (src/providers.js).
const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TEXT = 600000;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function kindOf(ext) {
  if (IMAGE_TYPES[ext]) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.doc', '.docx', '.pages', '.rtf', '.odt', '.key', '.ppt', '.pptx', '.xls', '.xlsx', '.numbers'].includes(ext)) return 'doc';
  return 'text';
}

/** Minimal ZIP reader (central directory + inflateRaw) for OOXML/ODF documents. */
function unzipEntries(buf, want) {
  const zlib = require('zlib');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < n && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (!want(name)) continue;
    const ds = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(ds, ds + csize);
    out.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
  }
  return out;
}
const xmlText = (x, para) => x.replace(para, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

/** Extract plain text from docx/pptx/xlsx/odt/odp/ods/rtf; null if unsupported. */
function docText(buf, ext) {
  try {
    if (ext === '.docx') return unzipEntries(buf, (n) => /^word\/(document|footnotes|endnotes)\.xml$/.test(n)).map((e) => xmlText(e.data.toString('utf8').replace(/<w:tab\/>/g, '\t'), /<\/w:p>|<w:br\/>/g)).join('\n\n');
    if (ext === '.pptx') return unzipEntries(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(natural).map((e, i) => `--- Slide ${i + 1} ---\n` + xmlText(e.data.toString('utf8'), /<\/a:p>/g)).join('\n\n');
    if (ext === '.xlsx') {
      const es = unzipEntries(buf, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
      const ssE = es.find((e) => e.name === 'xl/sharedStrings.xml');
      const ss = ssE ? [...ssE.data.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1], /$^/)) : [];
      return es.filter((e) => e !== ssE).sort(natural).map((e, i) => {
        const rows = [...e.data.toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
          [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
            const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || ''); const t = /t="(\w+)"/.exec(c[1]);
            if (t && t[1] === 's' && v) return ss[+v[1]] || '';
            if (t && t[1] === 'inlineStr') return xmlText(c[2] || '', /$^/);
            return v ? v[1] : '';
          }).join('\t'));
        return `--- Sheet ${i + 1} ---\n` + rows.join('\n');
      }).join('\n\n');
    }
    if (['.odt', '.odp', '.ods'].includes(ext)) return unzipEntries(buf, (n) => n === 'content.xml').map((e) => xmlText(e.data.toString('utf8'), /<\/text:p>|<\/text:h>|<\/table:table-row>/g)).join('\n');
    if (ext === '.rtf') return buf.toString('latin1').replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  } catch { return null; }
  return null;
}

/** Read a file in chunks, reporting progress (0..1). Resolves to the content blocks. */
function prepareFile(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    let st;
    try { st = fs.statSync(filePath); } catch { return reject(new Error('Couldn’t read that file.')); }
    if (!st.isFile()) return reject(new Error('That’s a folder — drop a single file.'));
    if (st.size > MAX_FILE_BYTES) return reject(new Error('This file is over 30 MB — try a smaller one.'));
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const chunks = []; let read = 0;
    const rs = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
    rs.on('data', (c) => { chunks.push(c); read += c.length; onProgress && onProgress(st.size ? (read / st.size) * 0.9 : 0.9); });
    rs.on('error', () => reject(new Error('Couldn’t read that file.')));
    rs.on('end', async () => {
      const buf = Buffer.concat(chunks);
      const kind = kindOf(ext);
      const out = { name, size: st.size, ext, kind, mime: null, data: null, text: null, pages: 0 };
      try {
        if (kind === 'image') { out.mime = IMAGE_TYPES[ext]; out.data = buf.toString('base64'); }
        else if (kind === 'pdf') {
          out.mime = 'application/pdf'; out.data = buf.toString('base64');
          const r = await pdfText(buf).catch(() => null); // used by text-only providers
          if (r) { out.text = r.text; out.pages = r.pages; }
        } else if (kind === 'doc') {
          const text = docText(buf, ext);
          if (!text) return reject(new Error('Nubbi can’t read this document format yet — export it as PDF and drop it again.'));
          out.text = text;
        } else {
          if (buf.subarray(0, 8000).includes(0)) return reject(new Error('Nubbi reads text, code, PDFs and images — this file looks binary. Export it as PDF and drop it again.'));
          out.text = buf.toString('utf8');
        }
      } catch (e) { return reject(e); }
      if (out.text && out.text.length > MAX_TEXT) out.text = out.text.slice(0, MAX_TEXT) + '\n…[truncated]';
      onProgress && onProgress(1);
      resolve(out);
    });
  });
}

/** Extract text from a PDF with pdf.js (legacy Node build). Returns { text, pages } — text may be '' for scanned PDFs. */
let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) {
    const { pathToFileURL } = require('url');
    let p = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    p = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); // pdf.js is asarUnpack'd so its worker import resolves on disk
    pdfjsP = import(pathToFileURL(p).href);
  }
  return pdfjsP;
}
async function pdfText(buf, maxPages = 300) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const total = doc.numPages; const n = Math.min(total, maxPages); const parts = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '', out = '';
    for (const it of tc.items) { line += it.str; if (it.hasEOL) { out += line + '\n'; line = ''; } else if (it.str && !/\s$/.test(it.str)) line += ' '; }
    out += line;
    parts.push(`--- Page ${i} ---\n${out.replace(/[ \t]+\n/g, '\n').trim()}`);
  }
  await (doc.destroy ? doc.destroy() : task.destroy()).catch(() => {});
  const text = parts.join('\n\n');
  return { text: text.replace(/--- Page \d+ ---\n?/g, '').trim() ? text : '', pages: total };
}

module.exports = { docText, unzipEntries, prepareFile, pdfText, kindOf };
