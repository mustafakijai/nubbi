const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { prepareFile } = require('../src/files');
const fx = (n) => path.join(__dirname, 'fixtures', n);

test('docx text is extracted', async () => {
  const r = await prepareFile(fx('sample.docx'));
  assert.equal(r.kind, 'doc');
  assert.match(r.text, /Quote total & terms\s+Due 15 Nov/);
});
test('pptx slides are in numeric order', async () => {
  const t = (await prepareFile(fx('sample.pptx'))).text;
  assert.ok(t.indexOf('First') < t.indexOf('Second') && t.indexOf('Second') < t.indexOf('Tenth'));
});
test('xlsx shared + inline strings and numbers', async () => {
  const t = (await prepareFile(fx('sample.xlsx'))).text;
  assert.match(t, /Item\tPrice\nSprint\t3000/);
});
test('progress reaches 1', async () => {
  const seen = []; await prepareFile(fx('sample.docx'), (p) => seen.push(p));
  assert.equal(seen.at(-1), 1);
});
