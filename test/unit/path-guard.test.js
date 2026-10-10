const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPathGuard } = require('../../src/main/lib/path-guard');

function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-guard-')));
  const proj = path.join(base, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a');
  return { base, proj };
}

test('libera arquivo dentro da raiz', () => {
  const { proj } = setup();
  const g = createPathGuard();
  g.allow(proj);
  assert.equal(g.isAllowed(path.join(proj, 'a.txt')), true);
});

test('bloqueia ../ que sai da raiz', () => {
  const { proj } = setup();
  const g = createPathGuard();
  g.allow(proj);
  assert.equal(g.isAllowed(path.join(proj, '..', 'outside.txt')), false);
  assert.throws(() => g.assertAllowed(path.join(proj, '..', 'x')), /Acesso negado/);
});

test('bloqueia prefixo parecido: liberar proj não libera proj-x', () => {
  const { base, proj } = setup();
  const projX = path.join(base, 'proj-x');
  fs.mkdirSync(projX);
  fs.writeFileSync(path.join(projX, 'a'), 'a');
  const g = createPathGuard();
  g.allow(proj);
  assert.equal(g.isAllowed(path.join(projX, 'a')), false);
});

test('bloqueia symlink dentro da raiz que aponta para fora', (t) => {
  if (process.platform === 'win32') return t.skip('symlink exige privilégio no Windows');
  const { base, proj } = setup();
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret'), 's');
  fs.symlinkSync(outside, path.join(proj, 'link'));
  const g = createPathGuard();
  g.allow(proj);
  assert.equal(g.isAllowed(path.join(proj, 'link', 'secret')), false);
});

test('aceita arquivo novo (inexistente) dentro da raiz', () => {
  const { proj } = setup();
  const g = createPathGuard();
  g.allow(proj);
  assert.equal(g.isAllowed(path.join(proj, 'novo.txt')), true);
});

test('win32 compara sem diferenciar maiúsculas', () => {
  const g = createPathGuard({ platform: 'win32', realpath: (p) => p });
  g.allow('/Proj');
  assert.equal(g.isAllowed('/proj/a.txt'), true);
  assert.equal(g.isAllowed('/PROJ-X/a.txt'), false);
});

test('nada liberado bloqueia tudo', () => {
  const { proj } = setup();
  const g = createPathGuard();
  assert.equal(g.isAllowed(path.join(proj, 'a.txt')), false);
});
