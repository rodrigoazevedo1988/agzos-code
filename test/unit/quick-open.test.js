const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('command-palette.js exporta showQuickOpen e showCommandPalette', () => {
  const filePath = path.join(__dirname, '../../src/renderer/scripts/command-palette.js');
  assert.ok(fs.existsSync(filePath), 'command-palette.js deve existir');
  const content = fs.readFileSync(filePath, 'utf-8');

  assert.ok(content.includes('export async function showQuickOpen'), 'deve exportar showQuickOpen');
  assert.ok(content.includes('export function showCommandPalette'), 'deve exportar showCommandPalette');
  assert.ok(content.includes('export function setupCommandPalette'), 'deve exportar setupCommandPalette');
  assert.ok(content.includes('ensureWorkspaceFilesLoaded'), 'deve carregar arquivos do workspace');
  assert.ok(content.includes('fuzzyScore'), 'deve calcular score fuzzy');
});

test('fs:findFiles é suportado no IPC', () => {
  const filePath = path.join(__dirname, '../../src/main/ipc/fs.js');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.ok(content.includes('fs:findFiles'), 'fs.js deve registrar handler fs:findFiles');
  assert.ok(content.includes('node_modules'), 'deve ignorar pastas desnecessárias como node_modules');
});

test('term.js suporta opções interativas e tratamento de erro', () => {
  const filePath = path.join(__dirname, '../../src/main/ipc/term.js');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.ok(content.includes('powershell.exe'), 'deve usar powershell no windows');
  assert.ok(content.includes('-NoExit'), 'deve incluir -NoExit para manter shell interativo');
  assert.ok(content.includes('proc.on(\'error\''), 'deve tratar erro do processo');
});
