const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ptyOptions, spawnPty } = require('../../src/main/ipc/term');

test('Windows usa o ConPTY empacotado por padrão', () => {
  assert.equal(ptyOptions({ cols: 80, rows: 24, platform: 'win32', envVars: {} }).useConptyDll, true);
});

test('AGZOS_CONPTY_DLL=0 volta ao ConPTY do sistema', () => {
  assert.equal(ptyOptions({ cols: 80, rows: 24, platform: 'win32', envVars: { AGZOS_CONPTY_DLL: '0' } }).useConptyDll, undefined);
});

test('fora do Windows não passa useConptyDll', () => {
  assert.equal(ptyOptions({ cols: 80, rows: 24, platform: 'linux', envVars: {} }).useConptyDll, undefined);
});

test('falha com a DLL empacotada tenta de novo sem ela', () => {
  const calls = [];
  const pty = { spawn: (_s, _a, o) => { calls.push(o.useConptyDll); if (o.useConptyDll) throw new Error('dll'); return { ok: true }; } };
  const orig = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(spawnPty(pty, 'pwsh.exe', [], { useConptyDll: true }), { ok: true });
  } finally { console.warn = orig; }
  assert.deepEqual(calls, [true, false]);
});

test('erro sem a DLL não é engolido', () => {
  const pty = { spawn: () => { throw new Error('boom'); } };
  assert.throws(() => spawnPty(pty, 'bash', [], {}), /boom/);
});
