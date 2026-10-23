// Tiny, safe Markdown → HTML (escapes everything first; no raw HTML passthrough).
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return s;
  }
  window.renderMarkdown = function (src) {
    const lines = src.replace(/\r/g, '').split('\n');
    let html = '', list = null, para = [], inCode = false, code = [], table = null;
    const flushP = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
    const flushL = () => { if (list) { html += `</${list}>`; list = null; } };
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const flushT = () => { if (!table) return; const [head, ...rows] = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      html += '<table><tr>' + cells(head).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>' + rows.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>'; table = null; };
    for (const line of lines) {
      if (/^```/.test(line)) {
        if (inCode) { html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>'; code = []; inCode = false; }
        else { flushP(); flushL(); inCode = true; }
        continue;
      }
      if (inCode) { code.push(line); continue; }
      if (/^\s*\|.*\|\s*$/.test(line)) { flushP(); flushL(); (table = table || []).push(line); continue; }
      flushT();
      let m;
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushP(); flushL(); html += '<hr>'; continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)/))) { flushP(); flushL(); const n = Math.min(3, m[1].length); html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (list !== 'ul') { flushL(); html += '<ul>'; list = 'ul'; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== 'ol') { flushL(); html += '<ol>'; list = 'ol'; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
      if ((m = line.match(/^>\s?(.*)/))) { flushP(); flushL(); html += '<blockquote>' + inline(m[1]) + '</blockquote>'; continue; }
      if (!line.trim()) { flushP(); flushL(); continue; }
      flushL(); para.push(line);
    }
    if (inCode) html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
    flushT(); flushP(); flushL();
    return html.replace(/(<hr>)+$/, '');
  };
})();
