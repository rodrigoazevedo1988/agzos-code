const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/ai-dock.js')).href);

test('normalizeDockPosition: aceita left/right/bottom, resto vira right', async () => {
  const { normalizeDockPosition } = await load();
  assert.equal(normalizeDockPosition('left'), 'left');
  assert.equal(normalizeDockPosition('right'), 'right');
  assert.equal(normalizeDockPosition('bottom'), 'bottom');
  for (const bad of [undefined, null, '', 'top', 'LEFT', 1, {}]) {
    assert.equal(normalizeDockPosition(bad), 'right');
  }
});

test('clampDockWidth: min 280, máx 60% da janela, inválido cai no padrão', async () => {
  const { clampDockWidth } = await load();
  assert.equal(clampDockWidth(380), 380);
  assert.equal(clampDockWidth(100), 280);
  assert.equal(clampDockWidth(5000), 5000);
  assert.equal(clampDockWidth(5000, 1400), 840);
  assert.equal(clampDockWidth(500.6, 1400), 501);
  assert.equal(clampDockWidth('abc'), 380);
  assert.equal(clampDockWidth(NaN), 380);
  assert.equal(clampDockWidth(-10), 380);
  // Janela estreita: nunca abaixo do mínimo
  assert.equal(clampDockWidth(600, 300), 280);
});

test('normalizeDockSettings: padrões e tipos', async () => {
  const { normalizeDockSettings } = await load();
  assert.deepEqual(normalizeDockSettings(undefined), { position: 'right', width: 380, visible: true });
  assert.deepEqual(normalizeDockSettings('x'), { position: 'right', width: 380, visible: true });
  assert.deepEqual(
    normalizeDockSettings({ position: 'bottom', width: 420, visible: false, fontSize: 14 }),
    { position: 'bottom', width: 420, visible: false },
  );
  assert.deepEqual(
    normalizeDockSettings({ position: 'top', width: 'wide', visible: 'yes' }),
    { position: 'right', width: 380, visible: true },
  );
});
