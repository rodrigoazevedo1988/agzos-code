const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = (name) => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts', name)).href);

const ev = (o) => ({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });

test('matchShortcut usa e.code quando e.key não é ASCII (mac Option+Z, tecla morta)', async () => {
  const { matchShortcut } = await load('keymap.js');
  assert.equal(matchShortcut(ev({ key: 'Ω', code: 'KeyZ', altKey: true })), 'editor.toggleWordWrap');
  assert.equal(matchShortcut(ev({ key: 'Dead', code: 'Backquote', ctrlKey: true })), 'terminal.toggle');
  assert.equal(matchShortcut(ev({ key: 'ƒ', code: 'KeyF', altKey: true, shiftKey: true })), 'editor.format');
});

test('matchShortcut: atalhos de terminal, quick open, comandos e zoom', async () => {
  const { matchShortcut } = await load('keymap.js');
  assert.equal(matchShortcut(ev({ key: '`', code: 'Backquote', ctrlKey: true })), 'terminal.toggle');
  // pt-BR ABNT2: a tecla à esquerda do 1 produz "'"
  assert.equal(matchShortcut(ev({ key: "'", code: 'Backquote', ctrlKey: true })), 'terminal.toggle');
  assert.equal(matchShortcut(ev({ key: "'", code: 'Quote', ctrlKey: true })), 'terminal.toggle');
  assert.equal(matchShortcut(ev({ key: '§', code: 'IntlBackslash', metaKey: true }), { isMac: true }), 'terminal.toggle');
  assert.equal(matchShortcut(ev({ key: '<', code: 'IntlBackslash', ctrlKey: true })), null);
  assert.equal(matchShortcut(ev({ key: 'p', code: 'KeyP', ctrlKey: true })), 'palette.quickOpen');
  assert.equal(matchShortcut(ev({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })), 'palette.commands');
  assert.equal(matchShortcut(ev({ key: 'w', code: 'KeyW', metaKey: true })), 'tab.close');
  assert.equal(matchShortcut(ev({ key: ',', code: 'Comma', ctrlKey: true })), 'settings.open');
  assert.equal(matchShortcut(ev({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true })), 'zoom.in');
  assert.equal(matchShortcut(ev({ key: '-', code: 'Minus', ctrlKey: true })), 'zoom.out');
  assert.equal(matchShortcut(ev({ key: '0', code: 'Digit0', ctrlKey: true })), 'zoom.reset');
  assert.equal(matchShortcut(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null);
  // AltGr (Ctrl+Alt) não dispara atalhos de Ctrl
  assert.equal(matchShortcut(ev({ key: 'w', code: 'KeyW', ctrlKey: true, altKey: true })), null);
  // Layout lógico tem prioridade (Dvorak: tecla física KeyR produz 'p')
  assert.equal(matchShortcut(ev({ key: 'p', code: 'KeyR', ctrlKey: true })), 'palette.quickOpen');
});

test('shouldHandleInTarget: em terminal/input só atalhos globais passam', async () => {
  const { shouldHandleInTarget } = await load('keymap.js');
  for (const a of ['palette.quickOpen', 'palette.commands', 'terminal.toggle', 'settings.open', 'sidebar.toggle']) {
    assert.equal(shouldHandleInTarget(a, true), true, a);
  }
  for (const a of ['tab.close', 'editor.find', 'zoom.in', 'editor.toggleWordWrap', 'ai.sendSelection']) {
    assert.equal(shouldHandleInTarget(a, true), false, a);
    assert.equal(shouldHandleInTarget(a, false), true, a);
  }
});

test('isEditableTarget: xterm e inputs sim; Monaco não', async () => {
  const { isEditableTarget, isMonacoTarget } = await load('keymap.js');
  const fakeTarget = (matches) => ({ closest: (sel) => (sel.split(',').some((s) => matches.includes(s.trim())) ? {} : null) });
  assert.equal(isEditableTarget(fakeTarget(['.xterm', 'textarea'])), true);
  assert.equal(isEditableTarget(fakeTarget(['.monaco-editor', 'textarea'])), false);
  assert.equal(isMonacoTarget(fakeTarget(['.monaco-editor', 'textarea'])), true);
  assert.equal(isEditableTarget(fakeTarget(['input'])), true);
  assert.equal(isEditableTarget(fakeTarget([])), false);
  assert.equal(isEditableTarget(null), false);
});

test('chord Ctrl+K: segunda tecla, expiração e cancelamento', async () => {
  const { createChord } = await load('keymap.js');
  let t = 0;
  const chord = createChord({ timeoutMs: 1500, now: () => t });
  const ctrlK = ev({ key: 'k', code: 'KeyK', ctrlKey: true });

  assert.deepEqual(chord.feed(ctrlK), { handled: true, action: 'chord.start' });
  assert.equal(chord.pending, true);
  // Soltar/pressionar Ctrl sozinho não consome o chord
  assert.deepEqual(chord.feed(ev({ key: 'Control', ctrlKey: true })), { handled: false, action: null });
  assert.deepEqual(chord.feed(ev({ key: 's', code: 'KeyS', ctrlKey: true })), { handled: true, action: 'shortcuts.show' });
  assert.equal(chord.pending, false);

  chord.feed(ctrlK);
  assert.deepEqual(chord.feed(ev({ key: 'w', code: 'KeyW', ctrlKey: true })), { handled: true, action: 'tabs.closeAll' });

  // Tecla desconhecida: chord é descartado e a tecla absorvida
  chord.feed(ctrlK);
  assert.deepEqual(chord.feed(ev({ key: 'c', code: 'KeyC', ctrlKey: true })), { handled: true, action: null });
  assert.deepEqual(chord.feed(ev({ key: 'w', code: 'KeyW', ctrlKey: true })), { handled: false, action: null });

  // Expira após 1.5s: Ctrl+W volta a ser tecla normal
  chord.feed(ctrlK);
  t += 1501;
  assert.equal(chord.pending, false);
  assert.deepEqual(chord.feed(ev({ key: 'w', code: 'KeyW', ctrlKey: true })), { handled: false, action: null });

  // Ctrl+Shift+K não inicia chord
  assert.deepEqual(chord.feed(ev({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true })), { handled: false, action: null });
});

test('matchShortcut: atalhos do terminal multi-sessão', async () => {
  const { matchShortcut, shouldHandleInTarget } = await load('keymap.js');
  // Ctrl+Shift+` (US entrega '~'; tecla morta cai no e.code)
  assert.equal(matchShortcut(ev({ key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true })), 'terminal.new');
  assert.equal(matchShortcut(ev({ key: 'Dead', code: 'Backquote', ctrlKey: true, shiftKey: true })), 'terminal.new');
  assert.equal(matchShortcut(ev({ key: '"', code: 'Quote', ctrlKey: true, shiftKey: true })), 'terminal.new');
  // Ctrl+Shift+5 (US entrega '%')
  assert.equal(matchShortcut(ev({ key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true })), 'terminal.split');
  assert.equal(matchShortcut(ev({ key: '(', code: 'Digit5', ctrlKey: true, shiftKey: true })), 'terminal.split');
  // Ctrl+PageUp/PageDown
  assert.equal(matchShortcut(ev({ key: 'PageDown', code: 'PageDown', ctrlKey: true })), 'terminal.next');
  assert.equal(matchShortcut(ev({ key: 'PageUp', code: 'PageUp', ctrlKey: true })), 'terminal.prev');
  assert.equal(matchShortcut(ev({ key: 'PageUp', code: 'PageUp', ctrlKey: true, shiftKey: true })), null);
  assert.equal(matchShortcut(ev({ key: 'PageUp', code: 'PageUp' })), null);
  // Sem shift continua alternando o terminal
  assert.equal(matchShortcut(ev({ key: '`', code: 'Backquote', ctrlKey: true })), 'terminal.toggle');
  for (const a of ['terminal.new', 'terminal.split', 'terminal.prev', 'terminal.next']) {
    assert.equal(shouldHandleInTarget(a, true), true);
  }
});

test('matchShortcut: Ctrl+Shift+X abre o hub Módulos Agzos', async () => {
  const { matchShortcut } = await load('keymap.js');
  assert.equal(matchShortcut(ev({ key: 'X', code: 'KeyX', ctrlKey: true, shiftKey: true })), 'view.modules');
  assert.equal(matchShortcut(ev({ key: 'x', code: 'KeyX', metaKey: true, shiftKey: true }), { isMac: true }), 'view.modules');
});
