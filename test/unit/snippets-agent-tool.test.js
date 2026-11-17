const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createToolbox } = require('../../src/main/agent/tools');
const { createCheckpointStore } = require('../../src/main/agent/checkpoints');
const { getModuleTools } = require('../../src/main/modules/agent-tools');
const { createSnippetStore } = require('../../src/main/modules/snippets/store');
const { configureSnippets } = require('../../src/main/modules/snippets/runtime');
const tools = require('../../src/main/modules/snippets/agent-tool');

const SEED = [
  { id: 'cta', name: 'CTA vermelho', category: 'CTA', language: 'tailwind', tags: ['chamada'], body: '<a class="bg-[{{cor_primaria}}]" href="#">Ir</a>\n<br>\n' },
  { id: 'estilo', name: 'Estilo base', category: 'CSS', language: 'css', tags: [], body: '.x { color: {{cor_primaria}}; }\n' },
];
const VARS = [{ name: 'cor_primaria', value: '#D10A11' }];

let root;
let outside;
let dataDir;
let store;
let cpStore;
let cp;
let box;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-snip-tool-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-snip-out-')));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-snip-data-'));
  store = createSnippetStore({ file: path.join(dataDir, 'snippets.json'), seed: SEED });
  configureSnippets({ store, variables: () => VARS });
  cpStore = createCheckpointStore({});
  cp = cpStore.create({ root });
  box = createToolbox({ root, checkpoint: cp, extraTools: tools });
});
afterEach(() => {
  configureSnippets(null);
  for (const d of [root, outside, dataDir]) fs.rmSync(d, { recursive: true, force: true });
});
const write = (rel, text) => {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, text);
  return abs;
};

test('definições: list_snippets (read), insert_snippet e save_snippet (write)', () => {
  const byName = Object.fromEntries(tools.map((t) => [t.definition.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), ['insert_snippet', 'list_snippets', 'save_snippet']);
  assert.equal(byName.list_snippets.kind, 'read');
  assert.equal(byName.insert_snippet.kind, 'write');
  assert.equal(byName.save_snippet.kind, 'write');
  assert.deepEqual(byName.insert_snippet.definition.input_schema.required, ['id', 'path']);
  assert.deepEqual(byName.save_snippet.definition.input_schema.required.sort(), ['body', 'category', 'language', 'name']);
  for (const t of tools) assert.equal(t.definition.parameters, t.definition.input_schema);
  assert.ok(box.definitions.some((d) => d.name === 'insert_snippet'));
});

test('getModuleTools: só com Snippets habilitado', () => {
  const names = (s) => getModuleTools(s).map((t) => t.definition.name);
  assert.ok(names({}).includes('list_snippets'));
  assert.ok(!names({ modules: { snippets: { enabled: false } } }).includes('list_snippets'));
});

test('list_snippets: metadados sem corpo, com busca e categoria', async () => {
  const p = await box.prepare('list_snippets', {});
  assert.equal(p.category, 'read');
  const r = await p.execute({});
  const data = JSON.parse(r.result);
  assert.deepEqual(data.snippets.map((s) => s.id), ['cta', 'estilo']);
  assert.equal(data.snippets[0].body, undefined);
  assert.deepEqual(data.categories, ['CTA', 'CSS']);
  const q = JSON.parse((await (await box.prepare('list_snippets', { query: 'vermelho' })).execute({})).result);
  assert.deepEqual(q.snippets.map((s) => s.id), ['cta']);
  const c = JSON.parse((await (await box.prepare('list_snippets', { category: 'CSS' })).execute({})).result);
  assert.deepEqual(c.snippets.map((s) => s.id), ['estilo']);
});

test('insert_snippet: insere antes da linha (indentação herdada), com diff e checkpoint', async () => {
  const abs = write('index.html', '<body>\n  <main></main>\n</body>\n');
  const p = await box.prepare('insert_snippet', { id: 'cta', path: 'index.html', line: 2 });
  assert.equal(p.category, 'write');
  const expected = '<body>\n  <a class="bg-[#D10A11]" href="#">Ir</a>\n  <br>\n  <main></main>\n</body>\n';
  assert.equal(p.preview.diff.path, abs);
  assert.equal(p.preview.diff.after, expected);
  const r = await p.execute({});
  assert.equal(fs.readFileSync(abs, 'utf8'), expected);
  assert.deepEqual(r.changed, [abs]);
  cp.finalize();
  cpStore.undo(cp.id);
  assert.equal(fs.readFileSync(abs, 'utf8'), '<body>\n  <main></main>\n</body>\n');
});

test('insert_snippet: sem linha vai para o fim; .tsx recebe JSX; css não muda', async () => {
  const tsx = write('App.tsx', 'export const A = () => null;');
  await (await box.prepare('insert_snippet', { id: 'cta', path: 'App.tsx' })).execute({});
  assert.equal(fs.readFileSync(tsx, 'utf8'), 'export const A = () => null;\n<a className="bg-[#D10A11]" href="#">Ir</a>\n<br />\n');
  const css = write('a.css', '');
  await (await box.prepare('insert_snippet', { id: 'estilo', path: 'a.css', line: 99 })).execute({});
  assert.equal(fs.readFileSync(css, 'utf8'), '.x { color: #D10A11; }\n');
});

test('insert_snippet: preserva CRLF', async () => {
  const abs = write('w.html', 'a\r\nb\r\n');
  await (await box.prepare('insert_snippet', { id: 'estilo', path: 'w.html', line: 2 })).execute({});
  assert.equal(fs.readFileSync(abs, 'utf8'), 'a\r\n.x { color: #D10A11; }\r\nb\r\n');
});

test('insert_snippet: cria o arquivo se não existir', async () => {
  await (await box.prepare('insert_snippet', { id: 'estilo', path: 'novo.css' })).execute({});
  assert.equal(fs.readFileSync(path.join(root, 'novo.css'), 'utf8'), '.x { color: #D10A11; }\n');
});

test('insert_snippet: erros (id inexistente, fora da raiz, pasta, arquivo mudou)', async () => {
  write('a.html', 'x\n');
  await assert.rejects(async () => box.prepare('insert_snippet', { id: 'nada', path: 'a.html' }), /não encontrado/i);
  await assert.rejects(async () => box.prepare('insert_snippet', { id: 'cta', path: path.join(outside, 'b.html') }), /fora da pasta/);
  fs.mkdirSync(path.join(root, 'pasta'));
  await assert.rejects(async () => box.prepare('insert_snippet', { id: 'cta', path: 'pasta' }), /pasta/i);
  await assert.rejects(async () => box.prepare('insert_snippet', { id: 'cta', path: 'a.html', line: 0 }), /line/);
  const p = await box.prepare('insert_snippet', { id: 'cta', path: 'a.html' });
  write('a.html', 'mudou\n');
  await assert.rejects(() => p.execute({}), /mudou/);
});

test('save_snippet: salva na biblioteca e devolve o id', async () => {
  const p = await box.prepare('save_snippet', { name: 'Card', category: 'Cards', language: 'jsx', body: '<Card />', tags: ['ui'] });
  assert.equal(p.category, 'write');
  assert.match(p.title, /Card/);
  const r = await p.execute({});
  const id = r.meta.id;
  assert.equal(store.get(id).body, '<Card />');
  assert.deepEqual(store.get(id).tags, ['ui']);
  await assert.rejects(async () => box.prepare('save_snippet', { name: '', category: 'x', language: 'html', body: '' }), /nome/i);
  await assert.rejects(async () => box.prepare('save_snippet', { name: 'a', category: 'x', language: 'php', body: '' }), /linguagem/i);
});

test('sem runtime configurado, as ferramentas falham com mensagem clara', async () => {
  configureSnippets(null);
  await assert.rejects(async () => box.prepare('list_snippets', {}), /Snippets indisponíveis/);
});
