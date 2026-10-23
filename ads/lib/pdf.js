const fs = require('fs');
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

module.exports = { makePdf };
