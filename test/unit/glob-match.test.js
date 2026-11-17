// Matcher de glob compartilhado (Árvore/.gitignore e Formatador/overrides): sem ReDoS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileGlob, LIMITS } = require('../../src/main/lib/glob-match');

const m = (p, s, o) => compileGlob(p, o)(s);

test('glob: *, ?, classes e escapes', () => {
  assert.equal(m('*.log', 'a.log'), true);
  assert.equal(m('*.log', 'a/b.log'), false);
  assert.equal(m('?.js', 'a.js'), true);
  assert.equal(m('?.js', 'ab.js'), false);
  assert.equal(m('[abc].txt', 'b.txt'), true);
  assert.equal(m('[abc].txt', 'd.txt'), false);
  assert.equal(m('[a-c]x', 'bx'), true);
  assert.equal(m('[!a-c]x', 'bx'), false);
  assert.equal(m('[^a-c]x', 'dx'), true);
  assert.equal(m('[]]', ']'), true);
  assert.equal(m('a[b', 'a[b'), true);
  assert.equal(m('\\*', '*'), true);
  assert.equal(m('\\*', 'x'), false);
});

test('glob: ** como segmento', () => {
  assert.equal(m('**/node_modules', 'node_modules'), true);
  assert.equal(m('**/node_modules', 'a/b/node_modules'), true);
  assert.equal(m('a/**/b', 'a/b'), true);
  assert.equal(m('a/**/b', 'a/x/y/b'), true);
  assert.equal(m('a/**/b', 'a/x/y/c'), false);
  assert.equal(m('a/**', 'a'), false);
  assert.equal(m('a/**', 'a/x/y'), true);
  assert.equal(m('src/**/*.ts', 'src/a.ts'), true);
  assert.equal(m('src/**/*.ts', 'src/deep/a.ts'), true);
  assert.equal(m('a**b', 'axxb'), true);
});

test('glob: braces só quando pedido', () => {
  assert.equal(m('*.{js,ts}', 'a.ts', { braces: true }), true);
  assert.equal(m('*.{js,ts}', 'a.md', { braces: true }), false);
  assert.equal(m('*.{js,ts}', '*.{js,ts}'), true);
  assert.equal(m('{a,{b,c}}.x', 'c.x', { braces: true }), true);
});

test('glob: padrão patológico termina rápido (sem ReDoS)', () => {
  const name = 'a'.repeat(1000);
  for (const pat of ['**a**a**a**a**a**a**a**b', '*a*a*a*a*a*a*a*a*a*a*b', '**/**/**/**/**/**/**/x']) {
    const fn = compileGlob(pat, { braces: true });
    const t0 = process.hrtime.bigint();
    assert.equal(fn(name), false);
    assert.equal(fn(Array(200).fill('a').join('/')), false);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 50, `${pat}: ${ms} ms`);
  }
});

test('glob: inválido devolve null com aviso, nunca lança', () => {
  const warns = [];
  const onWarn = (w) => warns.push(w);
  assert.equal(compileGlob('[z-a]', { onWarn }), null);
  assert.equal(compileGlob('x'.repeat(LIMITS.patternMax + 1), { onWarn }), null);
  assert.equal(compileGlob('{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}', { braces: true, onWarn }), null);
  assert.equal(compileGlob(null, { onWarn }), null);
  assert.equal(warns.length, 4);
  assert.match(warns[0], /intervalo inválido/);
});
