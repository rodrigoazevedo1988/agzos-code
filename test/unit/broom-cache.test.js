const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAnalysisCache, cacheKey, rulesHash } = require('../../src/main/modules/broom/cache');

const opts = { rules: { console: true, comments: true, unusedImports: true, deadCode: true }, keepConsole: ['error', 'warn'], keepComments: ['jsdoc'] };

test('LRU descarta o mais antigo acima de max', () => {
  const c = createAnalysisCache({ max: 2 });
  c.set('a|1|1|h', 1);
  c.set('b|1|1|h', 2);
  assert.equal(c.get('a|1|1|h'), 1); // "a" vira o mais recente
  c.set('c|1|1|h', 3);
  assert.equal(c.get('b|1|1|h'), undefined);
  assert.equal(c.get('a|1|1|h'), 1);
  assert.equal(c.get('c|1|1|h'), 3);
  assert.equal(c.size, 2);
});

test('max padrão é 200', () => {
  const c = createAnalysisCache();
  for (let i = 0; i < 250; i++) c.set(`f${i}|1|1|h`, i);
  assert.equal(c.size, 200);
  assert.equal(c.get('f0|1|1|h'), undefined);
  assert.equal(c.get('f249|1|1|h'), 249);
});

test('invalidate remove todas as chaves do path', () => {
  const c = createAnalysisCache();
  c.set(cacheKey('/w/a.js', { mtimeMs: 1, size: 10 }, 'h1'), 1);
  c.set(cacheKey('/w/a.js', { mtimeMs: 2, size: 10 }, 'h2'), 2);
  c.set(cacheKey('/w/a.jsx', { mtimeMs: 1, size: 10 }, 'h1'), 3);
  c.invalidate('/w/a.js');
  assert.equal(c.size, 1);
  assert.equal(c.get(cacheKey('/w/a.jsx', { mtimeMs: 1, size: 10 }, 'h1')), 3);
  c.clear();
  assert.equal(c.size, 0);
});

test('rulesHash diferente não reaproveita', () => {
  const c = createAnalysisCache();
  const st = { mtimeMs: 5, size: 3 };
  const h1 = rulesHash(opts);
  const h2 = rulesHash({ ...opts, rules: { ...opts.rules, console: false } });
  const h3 = rulesHash({ ...opts, keepConsole: ['error'] });
  assert.notEqual(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(rulesHash({ ...opts }), h1);
  c.set(cacheKey('/w/a.js', st, h1), 'x');
  assert.equal(c.get(cacheKey('/w/a.js', st, h2)), undefined);
  assert.equal(c.get(cacheKey('/w/a.js', st, h1)), 'x');
  assert.equal(c.get(cacheKey('/w/a.js', { mtimeMs: 6, size: 3 }, h1)), undefined);
});
