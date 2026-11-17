const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('settings-modal.js existe e exporta as funções necessárias', () => {
  const filePath = path.join(__dirname, '../../src/renderer/scripts/settings-modal.js');
  assert.ok(fs.existsSync(filePath), 'settings-modal.js deve existir');
  const content = fs.readFileSync(filePath, 'utf-8');

  assert.ok(content.includes('export function setupSettingsModal'), 'deve exportar setupSettingsModal');
  assert.ok(content.includes('export function openSettingsModal'), 'deve exportar openSettingsModal');
  assert.ok(content.includes('export function closeSettingsModal'), 'deve exportar closeSettingsModal');
  assert.ok(content.includes('export function updateOTAProgress'), 'deve exportar updateOTAProgress');
});

test('settings-modal contempla as 9 categorias e filtro @modified', () => {
  const filePath = path.join(__dirname, '../../src/renderer/scripts/settings-modal.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  const requiredCategories = [
    'commonlyUsed',
    'editor',
    'appearance',
    'terminal',
    'ai',
    'git',
    'update',
    'privacy',
    'modules',
  ];

  for (const cat of requiredCategories) {
    assert.ok(content.includes(cat), `categoria ${cat} deve estar presente`);
  }

  assert.ok(content.includes('@modified'), 'deve suportar filtro de configurações modificadas @modified');
  assert.ok(content.includes('btn-toggle-settings-json'), 'deve suportar alternância para modo JSON');
});
