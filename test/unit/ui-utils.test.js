const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/ui-utils.js')).href);

test('clampNumber: ignora vazio/não-finito e limita a min/max', async () => {
  const { clampNumber } = await load();
  assert.equal(clampNumber('', 1, 8), null);
  assert.equal(clampNumber('   ', 1, 8), null);
  assert.equal(clampNumber('abc', 1, 8), null);
  assert.equal(clampNumber('Infinity', 1, 8), null);
  assert.equal(clampNumber(NaN, 1, 8), null);
  assert.equal(clampNumber(null, 1, 8), null);
  assert.equal(clampNumber('4', 1, 8), 4);
  assert.equal(clampNumber('0', 1, 8), 1);
  assert.equal(clampNumber('99', 1, 8), 8);
  assert.equal(clampNumber('-5'), -5);
  assert.equal(clampNumber('2.5', 1, 8), 2.5);
});

test('isQuickOpenResultCurrent descarta resultados obsoletos', async () => {
  const { isQuickOpenResultCurrent } = await load();
  const base = { seq: 3, currentSeq: 3, mode: 'files', value: 'ab', currentValue: 'ab', visible: true };
  assert.equal(isQuickOpenResultCurrent(base), true);
  assert.equal(isQuickOpenResultCurrent({ ...base, currentSeq: 4 }), false);
  assert.equal(isQuickOpenResultCurrent({ ...base, mode: 'commands' }), false);
  assert.equal(isQuickOpenResultCurrent({ ...base, currentValue: 'abc' }), false);
  assert.equal(isQuickOpenResultCurrent({ ...base, visible: false }), false);
});

test('quickOpenEnterAction: arquivo nunca executa run em modo comandos', async () => {
  const { quickOpenEnterAction } = await load();
  const cmd = { id: 'x', run: () => {} };
  const file = { name: 'a.js', path: '/w/a.js', relativePath: 'a.js' };
  assert.equal(quickOpenEnterAction('commands', cmd), 'run');
  assert.equal(quickOpenEnterAction('commands', file), null);
  assert.equal(quickOpenEnterAction('files', file), 'open');
  assert.equal(quickOpenEnterAction('files', cmd), null);
  assert.equal(quickOpenEnterAction('files', undefined), null);
});

test('resetModalOwnedSettings preserva IA, GitHub, onboarding e recentes', async () => {
  const { resetModalOwnedSettings } = await load();
  const defaults = { theme: 'agzos-dark', fontSize: 14, editor: { tabSize: 2, minimap: true } };
  const current = {
    theme: 'monokai',
    fontSize: 20,
    editor: { tabSize: 8, minimap: false, extra: 'keep' },
    ai: { activeProfileId: 'p1', profiles: [{ id: 'p1' }] },
    github: { accounts: [{ login: 'x' }] },
    welcomeSeen: true,
    onboardingCompleted: true,
    recentFolders: ['/a'],
  };
  const out = resetModalOwnedSettings(current, defaults);
  assert.equal(out.theme, 'agzos-dark');
  assert.equal(out.fontSize, 14);
  assert.deepEqual(out.editor, { tabSize: 2, minimap: true, extra: 'keep' });
  assert.deepEqual(out.ai, current.ai);
  assert.deepEqual(out.github, current.github);
  assert.equal(out.welcomeSeen, true);
  assert.equal(out.onboardingCompleted, true);
  assert.deepEqual(out.recentFolders, ['/a']);
  // não muta a entrada nem compartilha referência com defaults
  assert.equal(current.theme, 'monokai');
  out.editor.tabSize = 4;
  assert.equal(defaults.editor.tabSize, 2);
});
