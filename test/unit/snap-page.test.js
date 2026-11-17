const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapHtml, normalizeSnapPayload, safeColor, LIMITS } = require('../../src/main/modules/snap/page');

const basic = {
  lines: [[{ t: 'const ', c: '#D10A11' }, { t: 'x', c: 'rgb(232, 232, 232)' }], [{ t: '// fim', c: '#6A6A6A', i: true }]],
  theme: { bg: '#0E0E0E', fg: '#E8E8E8', lineNumber: '#5A5A5A' },
};

test('safeColor aceita hex e rgb(a); recusa o resto', () => {
  assert.equal(safeColor('#fff'), '#fff');
  assert.equal(safeColor('#D10A11'), '#D10A11');
  assert.equal(safeColor('#D10A1133'), '#D10A1133');
  assert.equal(safeColor('rgb(1, 2, 3)'), 'rgb(1, 2, 3)');
  assert.equal(safeColor('rgba(1, 2, 3, 0.5)'), 'rgba(1, 2, 3, 0.5)');
  for (const bad of ['red;}body{x', 'url(x)', '#12', 'expression(1)', 'rgb(1,2,3);', null, 7]) {
    assert.equal(safeColor(bad), null, String(bad));
  }
});

test('texto e título são escapados; nada de <script> no HTML', () => {
  const html = buildSnapHtml({
    ...basic,
    lines: [[{ t: '<script>alert(1)</script> & "x"', c: '#fff' }]],
    frame: true,
    title: '<img src=x onerror=alert(1)>',
  });
  assert.ok(!/<script/i.test(html));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('CSP sem scripts e cor inválida de token cai na cor do tema', () => {
  const html = buildSnapHtml({ ...basic, lines: [[{ t: 'a', c: 'red;}*{background:url(http://x)' }]] });
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">/);
  assert.ok(!html.includes('url(http'));
  assert.ok(html.includes('color:#E8E8E8'));
});

test('opções: números de linha, moldura, marca d\'água e fundos', () => {
  const on = buildSnapHtml({ ...basic, lineNumbers: true, startLine: 41, frame: true, title: 'app.js', watermark: true, background: 'gradient' });
  assert.ok(on.includes('class="ln">41<'));
  assert.ok(on.includes('class="ln">42<'));
  assert.ok(on.includes('class="frame-bar"'));
  assert.ok(on.includes('app.js'));
  assert.ok(on.includes('Agzos Code'));
  assert.ok(on.includes('linear-gradient('));
  const off = buildSnapHtml({ ...basic, lineNumbers: false, frame: false, watermark: false, background: 'transparent' });
  assert.ok(!off.includes('class="ln"'));
  assert.ok(!off.includes('class="frame-bar"'));
  assert.ok(!off.includes('Agzos Code'));
  assert.ok(off.includes('background:transparent'));
  const solid = buildSnapHtml({ ...basic, background: 'solid', solidColor: '#123456' });
  assert.ok(solid.includes('background:#123456'));
});

test('normalizeSnapPayload limita padding, linhas, caracteres e corrige valores inválidos', () => {
  const n = normalizeSnapPayload({
    lines: Array.from({ length: LIMITS.lines + 50 }, () => [{ t: 'x'.repeat(10), c: '#fff' }]),
    padding: 9999, fontSize: 1, background: 'nada', startLine: -3, title: 'a'.repeat(500), theme: { bg: 'x' },
  });
  assert.equal(n.lines.length, LIMITS.lines);
  assert.equal(n.padding, LIMITS.paddingMax);
  assert.equal(n.fontSize, LIMITS.fontMin);
  assert.equal(n.background, 'gradient');
  assert.equal(n.startLine, 1);
  assert.equal(n.title.length, 120);
  assert.equal(n.theme.bg, '#0E0E0E');
  assert.throws(() => normalizeSnapPayload({ lines: 'x' }), /Nada para capturar/);
  assert.throws(() => normalizeSnapPayload({ lines: [] }), /Nada para capturar/);
});
