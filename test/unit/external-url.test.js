// Revisão de segurança 1.1.0: shell.openExternal só para http(s) e mailto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSafeExternalUrl, describeUrlForLog, openExternalSafe } = require('../../src/main/lib/external-url');

test('isSafeExternalUrl: só https, http e mailto', () => {
  for (const ok of ['https://agzos.dev/x?y=1', 'http://localhost:3000', 'mailto:dev@agzos.dev', 'HTTPS://EXEMPLO.COM']) {
    assert.equal(isSafeExternalUrl(ok), true, ok);
  }
  for (const bad of [
    'file:///etc/passwd', 'file://C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'smb://servidor/share',
    'ms-msdt:/id', 'vscode://x', 'data:text/html,oi', 'agzos-file://t/x', 'notas.md', '../x.md', '', null, 42,
  ]) {
    assert.equal(isSafeExternalUrl(bad), false, String(bad));
  }
});

test('describeUrlForLog não inclui credenciais, caminho nem query', () => {
  assert.equal(describeUrlForLog('ftp://user:senha@host.com/a?token=x'), 'ftp://host.com');
  assert.equal(describeUrlForLog('file:///home/u/segredo.txt'), 'file://');
  assert.equal(describeUrlForLog('isso não é url'), '(URL inválida)');
});

test('openExternalSafe abre permitidos e nega (com log seguro) o resto', () => {
  const opened = [];
  const logs = [];
  const shell = { openExternal: (u) => { opened.push(u); return Promise.resolve(); } };
  const log = (m) => logs.push(m);
  assert.equal(openExternalSafe(shell, 'https://agzos.dev', { log }), true);
  assert.equal(openExternalSafe(shell, 'file:///etc/passwd', { log }), false);
  assert.equal(openExternalSafe(shell, 'ftp://u:senha@h/x', { log }), false);
  assert.deepEqual(opened, ['https://agzos.dev']);
  assert.equal(logs.length, 2);
  assert.ok(logs.every((m) => !m.includes('senha') && !m.includes('passwd')), logs.join('\n'));
});
