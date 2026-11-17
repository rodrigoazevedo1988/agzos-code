const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildContextMessage } = require('../../src/renderer/scripts/ai-context.js');

test('retorna null sem contexto', () => {
  assert.equal(buildContextMessage({}), null);
  assert.equal(buildContextMessage({ file: { path: 'a.js', language: 'javascript', content: '' }, selection: { text: '' }, terminal: '' }), null);
});

test('trunca arquivo grande e indica o truncamento', () => {
  const context = buildContextMessage({ file: { path: 'a.js', language: 'js', content: '123456' } }, { maxFileChars: 3 });
  assert.match(context, /123… \(truncado\)/);
});

test('inclui seleção com linhas', () => {
  assert.equal(buildContextMessage({ selection: { text: 'x + y', startLine: 4, endLine: 6 } }), '### Seleção (linhas 4–6)\n\nx + y');
});

test('mantém conteúdo dentro dos limites', () => {
  assert.equal(buildContextMessage({
    file: { path: 'src/a.js', language: 'javascript', content: 'const x = 1;' },
    terminal: '$ node a.js',
  }), '### Arquivo: src/a.js (javascript)\n\n```javascript\nconst x = 1;\n```\n\n### Saída recente do terminal\n\n$ node a.js');
});
