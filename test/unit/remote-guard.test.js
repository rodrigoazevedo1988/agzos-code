const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createPathGuard } = require('../../src/main/lib/path-guard');
const { createWindowGuards } = require('../../src/main/lib/window-guards');
const { shQuote, buildCommand } = require('../../src/main/remote/sh');

test('guard remoto: aceita por prefixo da URI normalizada, nega .., %2e%2e, barra dupla e outro host', () => {
  const g = createPathGuard();
  g.allow('ssh://prod/srv/app/');
  assert.equal(g.isAllowed('ssh://prod/srv/app'), true);
  assert.equal(g.isAllowed('ssh://prod/srv/app/src/a b.js'), true);
  assert.equal(g.assertAllowed('ssh://prod/srv/app/x/'), 'ssh://prod/srv/app/x');
  for (const bad of [
    'ssh://prod/srv/app/../etc/passwd', 'ssh://prod/srv/app/%2e%2e/x', 'ssh://prod/srv/app/%2E%2E/x',
    'ssh://prod/srv/app//etc', 'ssh://prod/srv/application', 'ssh://prod/srv', 'ssh://outro/srv/app/x',
    'ssh://prod/srv/app/a\\..\\b', 'ssh://prod/srv/app/a\0',
  ]) {
    assert.equal(g.isAllowed(bad), false, bad);
    assert.throws(() => g.assertAllowed(bad), /Acesso negado/);
  }
  // Caminho local com o mesmo texto não vira remoto, e remoto não libera local.
  assert.equal(g.isAllowed('/srv/app'), false);
  assert.throws(() => g.allow('ssh://prod/a/../b'), /inválido/);
  g.revoke('ssh://prod/srv/app');
  assert.equal(g.isAllowed('ssh://prod/srv/app/x'), false);
});

test('guard remoto é por janela', () => {
  const guards = createWindowGuards();
  const w1 = { id: 1, once() {} };
  const w2 = { id: 2, once() {} };
  guards.guardFor(w1).allow('ssh://deploy@h:22/home/deploy');
  assert.equal(guards.guardFor(w1).isAllowed('ssh://deploy@h:22/home/deploy/a'), true);
  assert.equal(guards.guardFor(w2).isAllowed('ssh://deploy@h:22/home/deploy/a'), false);
});

test("shQuote/buildCommand: espaço, aspas, $(), ; e crase chegam literais", () => {
  assert.equal(shQuote("it's"), `'it'\\''s'`);
  assert.equal(shQuote('$(id); `x` | y & z\nw'), `'$(id); \`x\` | y & z\nw'`);
  assert.throws(() => shQuote('a\0b'));
  assert.equal(
    buildCommand('git', ['-C', "/srv/a b/it's", 'status'], { cwd: '/srv/$(x)', env: { LC_ALL: 'C' } }),
    `cd '/srv/$(x)' && env LC_ALL='C' 'git' '-C' '/srv/a b/it'\\''s' 'status'`,
  );
  assert.throws(() => buildCommand('ls', [], { env: { 'A;B': '1' } }), /inválida/);
  assert.throws(() => buildCommand('ls', [{}]), /inválidos/);
});
