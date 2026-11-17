const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { createToolbox } = require('../../src/main/agent/tools');
const { createCheckpointStore } = require('../../src/main/agent/checkpoints');
const { createWorkerHost } = require('../../src/main/modules/worker-host');
const { createBroomEngine, setDefaultEngine } = require('../../src/main/modules/broom/engine');
const { getModuleTools } = require('../../src/main/modules/agent-tools');
const cleanCode = require('../../src/main/modules/broom/agent-tool');

const script = path.join(__dirname, '..', '..', 'src', 'main', 'modules', 'worker.js');
function fork(file) {
  const child = childProcess.fork(file, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  return { postMessage: (m) => child.connected && child.send(m), on: (ev, fn) => child.on(ev, fn), kill: () => child.kill() };
}
const workerHost = createWorkerHost({ script, fork });
let settings = {};
before(() => setDefaultEngine(createBroomEngine({ workerHost }), () => settings));
after(() => { setDefaultEngine(null); workerHost.dispose(); });

const DIRTY = "import { a } from './x';\n// comentário\nconsole.log(a);\nexport const n = 1;\n";
const CLEAN = 'export const n = 1;\n';

let root;
let outside;
let store;
let cp;
let box;
beforeEach(() => {
  settings = {};
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-cc-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-cc-out-')));
  store = createCheckpointStore({});
  cp = store.create({ root });
  box = createToolbox({ root, checkpoint: cp, extraTools: [cleanCode] });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
const write = (rel, text) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
};

test('definição: clean_code, kind write, path obrigatório e rules opcionais', () => {
  assert.equal(cleanCode.kind, 'write');
  assert.equal(cleanCode.definition.name, 'clean_code');
  const schema = cleanCode.definition.input_schema;
  assert.deepEqual(schema.required, ['path']);
  assert.deepEqual(Object.keys(schema.properties.rules.properties).sort(), ['comments', 'console', 'deadCode', 'unusedImports']);
  // Os providers leem `parameters`: o mesmo schema nos dois campos.
  assert.equal(cleanCode.definition.parameters, schema);
  assert.ok(box.definitions.some((d) => d.name === 'clean_code'));
  assert.ok(getModuleTools({ modules: { broom: { enabled: true } } }).includes(cleanCode));
  assert.ok(!getModuleTools({ modules: { broom: { enabled: false } } }).includes(cleanCode));
});

test('limpa arquivo, mostra diff e o checkpoint da conversa desfaz', async () => {
  const f = write('src/a.ts', DIRTY);
  const p = await box.prepare('clean_code', { path: 'src/a.ts' });
  assert.equal(p.category, 'write');
  assert.equal(p.title, 'Limpar src/a.ts');
  assert.deepEqual(p.preview.diff, { path: f, before: DIRTY, after: CLEAN });
  assert.equal(fs.readFileSync(f, 'utf8'), DIRTY); // prepare não grava
  const r = await p.execute({});
  assert.equal(r.ok, true);
  assert.equal(r.summary, 'Limpou 3 itens em 1 arquivo');
  assert.deepEqual(r.meta, { files: 1, removed: 3, byRule: { console: 1, comments: 1, unusedImports: 1, deadCode: 0 } });
  assert.deepEqual(r.changed, [f]);
  assert.match(r.result, /src\/a\.ts: −3/);
  assert.equal(fs.readFileSync(f, 'utf8'), CLEAN);
  assert.ok(cp.finalize());
  store.undo(cp.id);
  assert.equal(fs.readFileSync(f, 'utf8'), DIRTY);
});

test('rules do input sobrescrevem as das Configurações', async () => {
  const f = write('a.js', DIRTY);
  const p = await box.prepare('clean_code', { path: 'a.js', rules: { console: false, unusedImports: false } });
  const r = await p.execute({});
  assert.equal(r.meta.removed, 1);
  assert.equal(fs.readFileSync(f, 'utf8'), "import { a } from './x';\nconsole.log(a);\nexport const n = 1;\n");
});

test('pasta: limpa os arquivos analisáveis com um preview por arquivo', async () => {
  const a = write('src/a.ts', DIRTY);
  const b = write('src/sub/b.js', '// x\nfoo();\n');
  write('src/c.css', '/* y */');
  write('src/limpo.js', CLEAN);
  write('src/node_modules/p/d.js', DIRTY);
  const p = await box.prepare('clean_code', { path: 'src' });
  assert.equal(p.title, 'Limpar src (2 arquivos)');
  assert.deepEqual(p.preview.files.map((x) => [x.path, x.count]), [[a, 3], [b, 1]]);
  assert.match(p.preview.diff.before, /src\/a\.ts/);
  const r = await p.execute({});
  assert.equal(r.summary, 'Limpou 4 itens em 2 arquivos');
  assert.deepEqual(r.changed.sort(), [a, b].sort());
  assert.equal(fs.readFileSync(path.join(root, 'src/node_modules/p/d.js'), 'utf8'), DIRTY);
});

test('pasta com 201 arquivos → erro claro', async () => {
  for (let i = 0; i < 201; i++) write(`muitos/${i}.js`, 'x();\n');
  await assert.rejects(box.prepare('clean_code', { path: 'muitos' }), /200 arquivos/);
});

test('fora da raiz → negado', async () => {
  fs.writeFileSync(path.join(outside, 'a.js'), DIRTY);
  await assert.rejects(async () => box.prepare('clean_code', { path: path.join(outside, 'a.js') }), /fora da pasta/);
  await assert.rejects(async () => box.prepare('clean_code', { path: '../x.js' }), /fora da pasta/);
  assert.equal(fs.readFileSync(path.join(outside, 'a.js'), 'utf8'), DIRTY);
});

test('arquivo não suportado, inexistente ou com erro de sintaxe', async () => {
  write('a.css', '/* x */');
  await assert.rejects(box.prepare('clean_code', { path: 'a.css' }), /\.ts, \.tsx/);
  await assert.rejects(box.prepare('clean_code', { path: 'nao-existe.js' }), /não encontrado/i);
  const f = write('quebrado.js', 'console.log(1);\nfunction (');
  const p = await box.prepare('clean_code', { path: 'quebrado.js' });
  const r = await p.execute({});
  assert.equal(r.meta.removed, 0);
  assert.match(r.result, /Erro de sintaxe/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'console.log(1);\nfunction (');
});

test('arquivo alterado entre o preview e a execução não é sobrescrito', async () => {
  const f = write('a.ts', DIRTY);
  const p = await box.prepare('clean_code', { path: 'a.ts' });
  fs.writeFileSync(f, `${DIRTY}// novo\n`);
  await assert.rejects(p.execute({}), /mudou/);
  assert.equal(fs.readFileSync(f, 'utf8'), `${DIRTY}// novo\n`);
});

test('sem nada para limpar o preview ainda é um diff (o cartão não vira "apagar")', async () => {
  write('limpo.js', CLEAN);
  write('vazia/limpo.js', CLEAN);
  const p = await box.prepare('clean_code', { path: 'limpo.js' });
  assert.deepEqual(p.preview.diff, { path: path.join(root, 'limpo.js'), before: CLEAN, after: CLEAN });
  const d = await box.prepare('clean_code', { path: 'vazia' });
  assert.ok(d.preview.diff);
  assert.deepEqual(d.preview.files, []);
  const r = await d.execute({});
  assert.equal(r.summary, 'Nada para limpar');
});
