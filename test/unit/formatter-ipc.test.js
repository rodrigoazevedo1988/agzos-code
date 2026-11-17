// IPC do Agzos Formatador (formatter:format): guard por janela, config do projeto e worker.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { register } = require('../../src/main/ipc/formatter');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const { createWorkerHost } = require('../../src/main/modules/worker-host');

const script = path.join(__dirname, '..', '..', 'src', 'main', 'modules', 'worker.js');
function fork(file) {
  const child = childProcess.fork(file, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  return { postMessage: (m) => child.connected && child.send(m), on: (ev, fn) => child.on(ev, fn), kill: () => child.kill() };
}
const workerHost = createWorkerHost({ script, fork });
after(() => workerHost.dispose());

function setup({ formatter = {}, files = {} } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-fmt-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-fmt-out-')));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  const guard = createPathGuard();
  guard.allow(root);
  const settings = { modules: { formatter: { enabled: true, ...formatter } } };
  const handlers = {};
  register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    guard, settingsStore: { load: () => settings }, workerHost, getWindowRoot: () => root,
  });
  const event = { sender: { id: 1, isDestroyed: () => false } };
  const call = (req) => handlers['formatter:format'](event, req);
  return { root, outside, call, settings, cleanup: () => [root, outside].forEach((d) => fs.rmSync(d, { recursive: true, force: true })) };
}

test('formata com a config do projeto, subindo até a raiz da janela', async () => {
  const h = setup({ files: { '.prettierrc': '{"semi": false, "singleQuote": true}', 'src/a.js': '' } });
  try {
    const r = await h.call({ path: path.join(h.root, 'src/a.js'), text: 'const a = "x";', languageId: 'javascript' });
    assert.equal(r.text, "const a = 'x'\n");
    assert.equal(r.configFile, path.join(h.root, '.prettierrc'));
    assert.equal(r.warning, undefined);
  } finally { h.cleanup(); }
});

test('opções do editor são a base (tabWidth/useTabs); config do projeto vence', async () => {
  const h = setup({ files: { 'a.ts': '' } });
  try {
    const r = await h.call({ path: path.join(h.root, 'a.ts'), text: 'function f(){return 1}', languageId: 'typescript', tabSize: 4, insertSpaces: true });
    assert.equal(r.text, 'function f() {\n    return 1;\n}\n');
  } finally { h.cleanup(); }
});

test('prettier.config.mjs é ignorado com aviso e nada do projeto executa', async () => {
  const marker = path.join(os.tmpdir(), `agzos-fmt-ipc-pwned-${process.pid}`);
  const h = setup({ files: { 'prettier.config.mjs': `import fs from 'fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'x'); export default { semi: false };`, 'a.js': '' } });
  try {
    const r = await h.call({ path: path.join(h.root, 'a.js'), text: 'let a=1', languageId: 'javascript' });
    assert.equal(r.text, 'let a = 1;\n');
    assert.match(r.warning, /prettier\.config\.mjs/);
    assert.equal(fs.existsSync(marker), false);
  } finally { h.cleanup(); }
});

test('arquivo fora do guard da janela → erro de acesso', async () => {
  const h = setup();
  try {
    await assert.rejects(() => h.call({ path: path.join(h.outside, 'a.js'), text: 'a', languageId: 'javascript' }), /acess|permitid|fora/i);
  } finally { h.cleanup(); }
});

test('sem caminho (arquivo sem título): só a linguagem, sem config', async () => {
  const h = setup();
  try {
    const r = await h.call({ path: null, text: 'a{color:red}', languageId: 'css' });
    assert.equal(r.text, 'a {\n  color: red;\n}\n');
  } finally { h.cleanup(); }
});

test('módulo desabilitado → erro claro', async () => {
  const h = setup({ formatter: { enabled: false } });
  try {
    await assert.rejects(() => h.call({ path: null, text: 'a', languageId: 'css' }), /desabilitado/);
  } finally { h.cleanup(); }
});
