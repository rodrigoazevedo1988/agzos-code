const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModules, DEFAULT_SETTINGS } = require('../../src/main/lib/settings');

test('modules.localHistory e modules.gitSlider: padrões', () => {
  assert.deepEqual(DEFAULT_SETTINGS.modules.localHistory, { enabled: true, maxPerFile: 50, maxDays: 30, maxTotalMB: 300 });
  assert.deepEqual(DEFAULT_SETTINGS.modules.gitSlider, { enabled: true, maxCommits: 200 });
  const out = normalizeModules(undefined);
  assert.deepEqual(out.localHistory, DEFAULT_SETTINGS.modules.localHistory);
  assert.deepEqual(out.gitSlider, DEFAULT_SETTINGS.modules.gitSlider);
});

test('modules.localHistory: valor inválido volta ao padrão campo a campo', () => {
  const out = normalizeModules({ localHistory: { enabled: false, maxPerFile: 0, maxDays: '9', maxTotalMB: 20 } });
  assert.deepEqual(out.localHistory, { enabled: false, maxPerFile: 50, maxDays: 30, maxTotalMB: 20 });
  const ok = normalizeModules({ localHistory: { enabled: 'x', maxPerFile: 5, maxDays: 1, maxTotalMB: 9 } }).localHistory;
  assert.deepEqual(ok, { enabled: true, maxPerFile: 5, maxDays: 1, maxTotalMB: 300 });
  assert.equal(normalizeModules({ localHistory: { maxPerFile: 2.5 } }).localHistory.maxPerFile, 50);
  assert.equal(normalizeModules({ localHistory: 'lixo' }).localHistory.enabled, true);
});

test('modules.gitSlider: maxCommits fora de 10..2000 volta a 200', () => {
  const t = (v) => normalizeModules({ gitSlider: { maxCommits: v } }).gitSlider.maxCommits;
  assert.equal(t(9), 200);
  assert.equal(t(2001), 200);
  assert.equal(t('50'), 200);
  assert.equal(t(10), 10);
  assert.equal(t(500), 500);
  assert.equal(normalizeModules({ gitSlider: { enabled: false } }).gitSlider.enabled, false);
});
