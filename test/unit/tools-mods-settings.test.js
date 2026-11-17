const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModules, DEFAULT_SETTINGS } = require('../../src/main/lib/settings');

test('modules.tree: padrão habilitado; enabled inválido volta ao padrão', () => {
  assert.deepEqual(DEFAULT_SETTINGS.modules.tree, { enabled: true });
  assert.deepEqual(normalizeModules(undefined).tree, { enabled: true });
  assert.equal(normalizeModules({ tree: { enabled: 'não' } }).tree.enabled, true);
  assert.equal(normalizeModules({ tree: { enabled: false } }).tree.enabled, false);
  assert.equal(normalizeModules({ tree: 'x' }).tree.enabled, true);
});

test('modules.snap: padrão habilitado com marca d\'água; campos inválidos voltam ao padrão', () => {
  assert.deepEqual(DEFAULT_SETTINGS.modules.snap, { enabled: true, watermark: true });
  assert.deepEqual(normalizeModules({ snap: { enabled: 1, watermark: 'x' } }).snap, { enabled: true, watermark: true });
  assert.deepEqual(normalizeModules({ snap: { enabled: false, watermark: false } }).snap, { enabled: false, watermark: false });
});

test('modules.liveServer: padrão 5500; porta fora de 1024..65535 volta ao padrão', () => {
  assert.deepEqual(DEFAULT_SETTINGS.modules.liveServer, { enabled: true, startPort: 5500 });
  const port = (v) => normalizeModules({ liveServer: { startPort: v } }).liveServer.startPort;
  assert.equal(port(80), 5500);
  assert.equal(port(70000), 5500);
  assert.equal(port('8080'), 5500);
  assert.equal(port(8080.5), 5500);
  assert.equal(port(8080), 8080);
  assert.equal(normalizeModules({ liveServer: { enabled: 'x' } }).liveServer.enabled, true);
});
