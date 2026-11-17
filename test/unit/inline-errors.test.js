const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/mods/inline-errors-core.js')).href);

// Severidades do Monaco: Hint 1, Info 2, Warning 4, Error 8.
const m = (line, severity, message) => ({ startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: 2, severity, message });

test('uma decoração por linha, com o marcador mais grave', async () => {
  const { inlineErrorItems } = await load();
  const items = inlineErrorItems([m(3, 4, 'aviso'), m(3, 8, 'erro'), m(1, 4, 'só aviso')], { severities: ['error', 'warning'] });
  assert.deepEqual(items.map((i) => [i.line, i.severity, i.message]), [[1, 'warning', 'só aviso'], [3, 'error', 'erro']]);
});

test('filtra por severidade e ignora dicas', async () => {
  const { inlineErrorItems } = await load();
  const markers = [m(1, 8, 'e'), m(2, 4, 'w'), m(3, 2, 'i'), m(4, 1, 'h')];
  assert.deepEqual(inlineErrorItems(markers, { severities: ['error'] }).map((i) => i.line), [1]);
  assert.deepEqual(inlineErrorItems(markers, { severities: ['info', 'warning'] }).map((i) => i.line), [2, 3]);
  assert.deepEqual(inlineErrorItems(markers, { severities: [] }), []);
});

test('só a linha do cursor quando onlyCursorLine', async () => {
  const { inlineErrorItems } = await load();
  const markers = [m(1, 8, 'a'), m(5, 8, 'b')];
  assert.deepEqual(inlineErrorItems(markers, { severities: ['error'], onlyCursorLine: true, cursorLine: 5 }).map((i) => i.line), [5]);
});

test('mensagem em uma linha, truncada com reticências; hover guarda a inteira', async () => {
  const { inlineErrorItems } = await load();
  const long = `Type '{ a: string; }' is not assignable\n  to type 'number'. ${'x'.repeat(200)}`;
  const [item] = inlineErrorItems([m(1, 8, long)], { severities: ['error'], maxLength: 40 });
  assert.equal(item.text.length, 40);
  assert.ok(item.text.endsWith('…'));
  assert.ok(!item.text.includes('\n'));
  assert.equal(item.message, long);
});
