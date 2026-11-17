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
