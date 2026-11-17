// Agzos Formatador: formatação com o prettier embutido (handler formatter.format do worker).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { format, parserFor } = require('../../src/main/modules/formatter/worker');
const { createWorkerHost } = require('../../src/main/modules/worker-host');

test('JavaScript, CSS e Markdown', async () => {
  assert.equal((await format({ text: 'const a = {b:1,c:"x"}', filepath: '/p/a.js' })).text, 'const a = { b: 1, c: "x" };\n');
  assert.equal((await format({ text: 'a{color:red;margin:0}', filepath: '/p/a.css' })).text, 'a {\n  color: red;\n  margin: 0;\n}\n');
  assert.equal((await format({ text: '# Título\n* item\n* outro', filepath: '/p/README.md' })).text, '# Título\n\n- item\n- outro\n');
});

test('opções do projeto e do editor são aplicadas', async () => {
  const r = await format({ text: 'function f(){return "a"}', filepath: '/p/a.ts', options: { semi: false, singleQuote: true, tabWidth: 4 } });
  assert.equal(r.text, "function f() {\n    return 'a'\n}\n");
});

test('sem caminho: parser pela linguagem do editor', async () => {
  assert.equal(parserFor('typescript'), 'typescript');
  assert.equal(parserFor('javascript'), 'babel');
  assert.equal(parserFor('python'), null);
  assert.equal((await format({ text: '{"a":1}', languageId: 'json' })).text, '{ "a": 1 }\n');
  await assert.rejects(() => format({ text: 'x', languageId: 'python' }), /não suportad/);
});

test('plugins nunca são carregados, mesmo se vierem nas opções', async () => {
  const marker = path.join(os.tmpdir(), `agzos-prettier-plugin-pwned-${process.pid}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-prettier-plugin-'));
  const evil = path.join(dir, 'evil.js');
  fs.writeFileSync(evil, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = {};`);
  const r = await format({ text: 'a=1', filepath: path.join(dir, 'a.js'), options: { plugins: [evil], parser: 'babel' } });
  assert.equal(r.text, 'a = 1;\n');
  assert.equal(fs.existsSync(marker), false);
});

test('erro de sintaxe vira erro com a mensagem do Prettier', async () => {
  await assert.rejects(() => format({ text: 'const = ;', filepath: '/p/a.js' }), /Unexpected token|SyntaxError/);
});

// Pelo processo utilitário (worker.js), como o main usa.
const script = path.join(__dirname, '..', '..', 'src', 'main', 'modules', 'worker.js');
function fork(file) {
  const child = childProcess.fork(file, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  return { postMessage: (m) => child.connected && child.send(m), on: (ev, fn) => child.on(ev, fn), kill: () => child.kill() };
}
const host = createWorkerHost({ script, fork });
after(() => host.dispose());

test('worker: formatter.format', async () => {
  const r = await host.call('formatter.format', { text: 'let x=[1,2]', filepath: '/p/a.js' });
  assert.equal(r.text, 'let x = [1, 2];\n');
});
