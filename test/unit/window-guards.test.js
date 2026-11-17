const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const { createWindowGuards } = require('../../src/main/lib/window-guards');
const { createPathGuard } = require('../../src/main/lib/path-guard');

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function fakeWc(id) {
  const wc = new EventEmitter();
  wc.id = id;
  wc.isDestroyed = () => false;
  return wc;
}

test('path-guard: revoke tira a raiz liberada', () => {
  const dir = tmp('agzos-rev-');
  const g = createPathGuard();
  g.allow(dir);
  assert.equal(g.isAllowed(path.join(dir, 'a')), true);
  g.revoke(dir);
  assert.equal(g.isAllowed(path.join(dir, 'a')), false);
});

test('janela A não acessa a raiz da janela B', () => {
  const reg = createWindowGuards();
  const a = fakeWc(1);
  const b = fakeWc(2);
  const dirA = tmp('agzos-wa-');
  const dirB = tmp('agzos-wb-');
  reg.guardFor(a).allow(dirA);
  reg.guardFor(b).allow(dirB);
  assert.equal(reg.guardFor(a).isAllowed(path.join(dirA, 'x.txt')), true);
  assert.equal(reg.guardFor(a).isAllowed(path.join(dirB, 'x.txt')), false);
  assert.equal(reg.guardFor(b).isAllowed(path.join(dirA, 'x.txt')), false);
  // por id também
  assert.equal(reg.guardFor(2).isAllowed(path.join(dirB, 'x.txt')), true);
});

test('arquivo aberto por diálogo em A não vale em B', () => {
  const reg = createWindowGuards();
  const a = fakeWc(1);
  const b = fakeWc(2);
  const f = path.join(tmp('agzos-wf-'), 'nota.md');
  fs.writeFileSync(f, 'x');
  reg.guardFor(a).allow(f);
  assert.equal(reg.guardFor(a).isAllowed(f), true);
  assert.equal(reg.guardFor(b).isAllowed(f), false);
});

test('destruir a janela descarta o guard e o token', () => {
  const reg = createWindowGuards();
  const a = fakeWc(1);
  const dir = tmp('agzos-wd-');
  reg.guardFor(a).allow(dir);
  const token = reg.tokenFor(a);
  assert.ok(reg.guardForToken(token));
  a.emit('destroyed');
  assert.equal(reg.guardForToken(token), null);
  // id desconhecido: guard que nega tudo
  assert.equal(reg.guardFor(1).isAllowed(path.join(dir, 'x')), false);
  assert.throws(() => reg.guardFor(1).allow(dir), /janela/i);
  assert.equal(reg.guardFor(1).isAllowed(path.join(dir, 'x')), false);
});

test('token de protocolo é por janela: o de A não serve para B', () => {
  const reg = createWindowGuards();
  const a = fakeWc(1);
  const b = fakeWc(2);
  const dirA = tmp('agzos-wt-');
  reg.guardFor(a).allow(dirA);
  const ta = reg.tokenFor(a);
  const tb = reg.tokenFor(b);
  assert.match(ta, /^[0-9a-f]{32}$/);
  assert.notEqual(ta, tb);
  assert.equal(reg.tokenFor(a), ta, 'token estável por janela');
  assert.equal(reg.guardForToken(ta).isAllowed(path.join(dirA, 'i.png')), true);
  assert.equal(reg.guardForToken(tb).isAllowed(path.join(dirA, 'i.png')), false);
  assert.equal(reg.guardForToken('local'), null);
  assert.equal(reg.guardForToken(''), null);
});

test('allowAll libera em todas as janelas abertas (helper de teste)', () => {
  const reg = createWindowGuards();
  const a = fakeWc(1);
  const b = fakeWc(2);
  reg.guardFor(a);
  reg.guardFor(b);
  const dir = tmp('agzos-wall-');
  reg.allowAll(dir);
  assert.equal(reg.guardFor(a).isAllowed(dir), true);
  assert.equal(reg.guardFor(b).isAllowed(dir), true);
});
