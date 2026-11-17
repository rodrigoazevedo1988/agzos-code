const { test } = require('node:test');
const assert = require('node:assert/strict');
const { htmlToJsx, isJsxPath } = require('../../src/main/modules/snippets/jsx');

test('htmlToJsx: class → className e for → htmlFor', () => {
  assert.equal(htmlToJsx('<label class="a" for="email">E-mail</label>'),
    '<label className="a" htmlFor="email">E-mail</label>');
});

test('htmlToJsx: tags vazias são fechadas', () => {
  assert.equal(htmlToJsx('<input type="email" required><br><img src="data:x" alt="">'),
    '<input type="email" required /><br /><img src="data:x" alt="" />');
});

test('htmlToJsx: tag já autofechada continua igual', () => {
  assert.equal(htmlToJsx('<path d="M0 0" />'), '<path d="M0 0" />');
});

test('htmlToJsx: style string → objeto com camelCase', () => {
  assert.equal(htmlToJsx('<div style="font-family: Inter, sans-serif; background-color:#000;"></div>'),
    "<div style={{ fontFamily: 'Inter, sans-serif', backgroundColor: '#000' }}></div>");
});

test('htmlToJsx: style com variável CSS e aspas', () => {
  assert.equal(htmlToJsx(`<div style="--x: 1; font-family: 'Inter'"></div>`),
    `<div style={{ '--x': '1', fontFamily: '\\'Inter\\'' }}></div>`);
});

test('htmlToJsx: comentário → {/* */}', () => {
  assert.equal(htmlToJsx('<div><!-- Hero --></div>'), '<div>{/* Hero */}</div>');
});

test('htmlToJsx: atributos SVG e outros em camelCase; aria/data ficam', () => {
  assert.equal(
    htmlToJsx('<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" aria-hidden="true" data-x="1" tabindex="0"></svg>'),
    '<svg viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" aria-hidden="true" data-x="1" tabIndex="0"></svg>',
  );
  assert.equal(htmlToJsx('<input autocomplete="email" maxlength="80" readonly>'),
    '<input autoComplete="email" maxLength="80" readOnly />');
});

test('htmlToJsx: aspas simples nos atributos viram duplas', () => {
  assert.equal(htmlToJsx("<a class='x' href='/'>ir</a>"), '<a className="x" href="/">ir</a>');
});

test('htmlToJsx: chaves no texto são escapadas', () => {
  assert.equal(htmlToJsx('<code>{a}</code>'), "<code>{'{'}a{'}'}</code>");
});

test('htmlToJsx: preserva quebras de linha e indentação', () => {
  const html = '<section class="p-4">\n  <h2 class="t">Oi</h2>\n  <hr>\n</section>\n';
  assert.equal(htmlToJsx(html), '<section className="p-4">\n  <h2 className="t">Oi</h2>\n  <hr />\n</section>\n');
});

test('htmlToJsx: atributo com > dentro de aspas não quebra a tag', () => {
  assert.equal(htmlToJsx('<div title="a > b" class="c"></div>'), '<div title="a > b" className="c"></div>');
});

test('htmlToJsx: < solto no texto não é tag', () => {
  assert.equal(htmlToJsx('<p>1 < 2</p>'), "<p>1 {'<'} 2</p>");
});

test('isJsxPath: .jsx e .tsx', () => {
  assert.equal(isJsxPath('/a/b/App.tsx'), true);
  assert.equal(isJsxPath('C:\\x\\Page.JSX'), true);
  assert.equal(isJsxPath('/a/index.html'), false);
  assert.equal(isJsxPath(''), false);
});
