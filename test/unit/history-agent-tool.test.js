const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createToolbox } = require('../../src/main/agent/tools');
const { getModuleTools } = require('../../src/main/modules/agent-tools');
const history = require('../../src/main/modules/history');

let root;
let ud;
let settings;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'a@a' };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: ENV });
const tool = () => getModuleTools(settings).find((t) => t.definition.name === 'file_history');

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-histtool-')));
  ud = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-histtoolud-')));
  settings = { modules: {} };
  history.configureHistory({ userDataDir: ud, getSettings: () => settings });
});
afterEach(() => {
  history.resetHistory();
  for (const d of [root, ud]) fs.rmSync(d, { recursive: true, force: true });
});

test('file_history: ferramenta read, só com o Git Slider habilitado', () => {
  const t = tool();
  assert.ok(t);
  assert.equal(t.kind, 'read');
  assert.deepEqual(t.definition.input_schema.required, ['path']);
  settings.modules.gitSlider = { enabled: false };
  assert.equal(tool(), undefined);
});

test('file_history lista commits + versões locais, sem conteúdo', async () => {
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'a.js'), 'const segredo = "conteudo-do-commit";\n');
  git('add', '.'); git('commit', '-qm', 'cria a.js');
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = "conteudo-local";\n');
  history.recordBefore(path.join(root, 'a.js'), 'agente');
  const box = createToolbox({ root, checkpoint: null, extraTools: [tool()] });
  const prepared = await box.prepare('file_history', { path: 'a.js' });
  assert.equal(prepared.category, 'read');
  const res = await prepared.execute({});
  assert.equal(res.ok, true);
  const data = JSON.parse(res.result);
  assert.equal(data.path, 'a.js');
  assert.equal(data.git, true);
  assert.equal(data.versions.length, 2);
  assert.equal(data.versions[0].kind, 'local'); // mais recente primeiro
  assert.equal(data.versions[0].origin, 'agente');
  assert.equal(data.versions[1].kind, 'commit');
  assert.equal(data.versions[1].author, 'Ana');
  assert.equal(data.versions[1].message, 'cria a.js');
  assert.match(data.versions[1].date, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!res.result.includes('conteudo-do-commit'));
  assert.ok(!res.result.includes('conteudo-local'));
  assert.match(res.summary, /1 commit.*1 versão local/);
});

test('file_history: caminho fora do projeto é negado', async () => {
  const box = createToolbox({ root, checkpoint: null, extraTools: [tool()] });
  await assert.rejects(async () => box.prepare('file_history', { path: '../fora.js' }), /fora da pasta/);
});
