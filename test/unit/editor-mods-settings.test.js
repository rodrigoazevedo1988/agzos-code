// Configurações dos módulos de editor da 1.2.0 (settings.modules.*): padrões e normalização.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModules, DEFAULT_SETTINGS } = require('../../src/main/lib/settings');

test('inlineErrors: padrão ligado com erro e aviso, todas as linhas', () => {
  assert.deepEqual(DEFAULT_SETTINGS.modules.inlineErrors, { enabled: true, severities: ['error', 'warning'], onlyCursorLine: false });
  assert.deepEqual(normalizeModules({}).inlineErrors, DEFAULT_SETTINGS.modules.inlineErrors);
});

test('inlineErrors: valores inválidos voltam ao padrão campo a campo', () => {
  const out = normalizeModules({ inlineErrors: { enabled: 'sim', severities: ['error', 'bobagem', 3, 'info', 'error'], onlyCursorLine: true } });
  assert.equal(out.inlineErrors.enabled, true);
  assert.deepEqual(out.inlineErrors.severities, ['error', 'info']);
  assert.equal(out.inlineErrors.onlyCursorLine, true);
  assert.deepEqual(normalizeModules({ inlineErrors: { severities: 'error' } }).inlineErrors.severities, ['error', 'warning']);
  assert.deepEqual(normalizeModules({ inlineErrors: { severities: [] } }).inlineErrors.severities, []);
  assert.equal(normalizeModules({ inlineErrors: { enabled: false } }).inlineErrors.enabled, false);
});

test('prettyErrors: padrão ligado; enabled inválido volta ao padrão', () => {
  assert.deepEqual(DEFAULT_SETTINGS.modules.prettyErrors, { enabled: true });
  assert.deepEqual(normalizeModules({ prettyErrors: { enabled: 1 } }).prettyErrors, { enabled: true });
  assert.deepEqual(normalizeModules({ prettyErrors: 'x' }).prettyErrors, { enabled: true });
  assert.equal(normalizeModules({ prettyErrors: { enabled: false } }).prettyErrors.enabled, false);
});

test('highlighter: padrão com os 6 marcadores; itens inválidos descartados', () => {
  assert.deepEqual(DEFAULT_SETTINGS.modules.highlighter, {
    enabled: true,
    tags: ['!=#FF5252', '?=#4FC3F7', 'TODO=#FF9800', 'FIXME=#FF9800', '*=#98C379', '//=#7A7A7A'],
  });
  const out = normalizeModules({ highlighter: { enabled: 'x', tags: ['NOTE=#00ff00', 'ruim', 'A=red', 7, 'HACK = #abc'] } });
  assert.equal(out.highlighter.enabled, true);
  assert.deepEqual(out.highlighter.tags, ['NOTE=#00ff00', 'HACK=#abc']);
  assert.deepEqual(normalizeModules({ highlighter: { tags: 'TODO' } }).highlighter.tags, DEFAULT_SETTINGS.modules.highlighter.tags);
  assert.deepEqual(normalizeModules({ highlighter: { tags: [] } }).highlighter.tags, []);
});
