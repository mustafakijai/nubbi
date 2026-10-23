// Run with Electron-as-node (pdfjs needs Node >= 22): ELECTRON_RUN_AS_NODE=1 electron test/pdf.e2e.mjs
import { createRequire } from 'module'; import assert from 'assert';
const require = createRequire(import.meta.url);
const { prepareFile } = require('../src/files.js');
const r = await prepareFile(new URL('../test/fixtures/sample.pdf', import.meta.url).pathname);
assert.equal(r.kind, 'pdf'); assert.ok(r.data && r.data.length > 100, 'base64 kept for native PDF providers');
assert.match(r.text, /Invoice total: 4,860 EUR due 15 Nov 2026/); assert.equal(r.pages, 1);
console.log('ok pdf text extraction:', JSON.stringify(r.text.slice(0, 60)));
