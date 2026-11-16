const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  stripJsonComments,
  parseJsonc,
  mapVSCodeSettings,
  importFromVSCode,
} = require('../../src/main/lib/import-vscode');

test('stripJsonComments remove comentários de linha, bloco e trailing commas', () => {
  const jsonc = `
  {
    // Comentário de linha
    "editor.fontSize": 16, /* comentário de bloco */
    "editor.tabSize": 4,
  }
  `;
  const clean = stripJsonComments(jsonc);
  assert.doesNotThrow(() => JSON.parse(clean));
  const parsed = parseJsonc(jsonc);
  assert.equal(parsed['editor.fontSize'], 16);
  assert.equal(parsed['editor.tabSize'], 4);
});

test('parseJsonc preserva // e /* dentro de strings (URLs e globs)', () => {
  const jsonc = `{
    // proxy
    "http.proxy": "http://proxy.local:8080",
    "files.exclude": { "**/*.js": true, "src/**/*.map": false },
    "search.exclude": { "**/node_modules": true, /* bloco */ }
  }`;
  const parsed = parseJsonc(jsonc);
  assert.equal(parsed['http.proxy'], 'http://proxy.local:8080');
  assert.deepEqual(parsed['files.exclude'], { '**/*.js': true, 'src/**/*.map': false });
  assert.deepEqual(parsed['search.exclude'], { '**/node_modules': true });
});

test('parseJsonc lida com aspas e barras escapadas dentro de strings', () => {
  const jsonc = String.raw`{
    "a": "diz \"oi\" // não é comentário",
    "b": "C:\\path\\",
    "c": "/* também não */", // comentário real
  }`;
  const parsed = parseJsonc(jsonc);
  assert.equal(parsed.a, 'diz "oi" // não é comentário');
  assert.equal(parsed.b, 'C:\\path\\');
  assert.equal(parsed.c, '/* também não */');
});

test('parseJsonc remove trailing commas em objetos e arrays, inclusive antes de comentários', () => {
  const jsonc = `{
    "list": [1, 2, 3,],
    "nested": { "x": ",}", },
    "last": true, // fim
  }`;
  const parsed = parseJsonc(jsonc);
  assert.deepEqual(parsed.list, [1, 2, 3]);
  assert.deepEqual(parsed.nested, { x: ',}' });
  assert.equal(parsed.last, true);
});

test('mapVSCodeSettings mapeia corretamente configurações do VS Code para Agzos Code', () => {
  const vscode = {
    'editor.fontSize': 17,
    'editor.tabSize': 4,
    'editor.wordWrap': 'on',
    'editor.minimap.enabled': false,
    'workbench.colorTheme': 'Quiet Light',
  };
  const { mapped, importedKeys } = mapVSCodeSettings(vscode);
  assert.equal(mapped.fontSize, 17);
  assert.equal(mapped.editor.tabSize, 4);
  assert.equal(mapped.editor.wordWrap, 'on');
  assert.equal(mapped.editor.minimap, false);
  assert.equal(mapped.theme, 'agzos-light');
  assert.ok(importedKeys.includes('fontSize'));
  assert.ok(importedKeys.includes('theme'));
});

test('importFromVSCode importa de arquivo existente', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-test-import-'));
  const file = path.join(tmpDir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({
    'editor.fontSize': 15,
    'editor.insertSpaces': true,
  }));

  const res = importFromVSCode({ filePath: file });
  assert.equal(res.ok, true);
  assert.equal(res.mapped.fontSize, 15);
  assert.equal(res.mapped.editor.insertSpaces, true);
  assert.ok(res.imported.includes('fontSize'));
});

test('importFromVSCode retorna not_found para arquivo inexistente', () => {
  const res = importFromVSCode({ filePath: '/caminho/inexistente/settings.json' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not_found');
});
