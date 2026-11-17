const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/keymap.js')).href);
const ev = (o) => ({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });

test('Ctrl+Alt+H abre a linha do tempo do arquivo', async () => {
  const { matchShortcut } = await load();
  assert.equal(matchShortcut(ev({ key: 'h', code: 'KeyH', ctrlKey: true, altKey: true })), 'history.timeline');
  // Alguns layouts entregam outro caractere com Ctrl+Alt: e.code resolve.
  assert.equal(matchShortcut(ev({ key: '˙', code: 'KeyH', metaKey: true, altKey: true }), { isMac: true }), 'history.timeline');
  assert.equal(matchShortcut(ev({ key: 'h', code: 'KeyH', ctrlKey: true })), 'editor.replace');
  assert.equal(matchShortcut(ev({ key: 'H', code: 'KeyH', ctrlKey: true, altKey: true, shiftKey: true })), null);
});
