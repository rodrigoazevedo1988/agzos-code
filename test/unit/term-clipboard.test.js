const { test } = require('node:test');
const assert = require('node:assert/strict');

// terminal.js é ESM do renderer; clipboardAction é pura e não toca no DOM no import?
// Importa só a função via import() dinâmico com stubs mínimos.
test('clipboardAction: Ctrl+C copia só com seleção; Ctrl+Shift+C/V, Ctrl+V, Shift+Insert, Cmd no mac', async () => {
  globalThis.window = globalThis.window || { AgzosState: {} };
  const { clipboardAction } = await import('../../src/renderer/scripts/terminal.js');
  const k = (o) => ({ type: 'keydown', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(clipboardAction(k({ ctrlKey: true, key: 'c' }), false), null); // SIGINT segue
  assert.equal(clipboardAction(k({ ctrlKey: true, key: 'c' }), true), 'copy');
  assert.equal(clipboardAction(k({ ctrlKey: true, shiftKey: true, key: 'C' }), false), 'copy');
  assert.equal(clipboardAction(k({ ctrlKey: true, key: 'v' }), false), 'paste');
  assert.equal(clipboardAction(k({ ctrlKey: true, shiftKey: true, key: 'V' }), false), 'paste');
  assert.equal(clipboardAction(k({ shiftKey: true, key: 'Insert', code: 'Insert' }), false), 'paste');
  assert.equal(clipboardAction(k({ ctrlKey: true, altKey: true, key: 'v' }), false), null); // AltGr
  assert.equal(clipboardAction(k({ type: 'keyup', ctrlKey: true, key: 'v' }), false), null);
  assert.equal(clipboardAction(k({ metaKey: true, key: 'c' }), true, true), 'copy');
  assert.equal(clipboardAction(k({ metaKey: true, key: 'v' }), false, true), 'paste');
  assert.equal(clipboardAction(k({ ctrlKey: true, key: 'v' }), false, true), 'paste');
});
