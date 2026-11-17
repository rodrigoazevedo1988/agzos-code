// Revisão de segurança 1.1.0: segredos não chegam ao modelo sem redação.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createToolbox } = require('../../src/main/agent/tools');
const { createRendererTools } = require('../../src/main/agent/renderer-tools');
const { redactSecrets } = require('../../src/main/modules/envvault/detect');

// Valores sintéticos (não são chaves reais).
const OPENAI = `sk-proj-${'A1b2C3d4E5'.repeat(4)}`;
const DB_PASS = 'senhaDoBancoXyz123';

let root;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-redact-'))); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const exec = async (box, name, input) => (await box.prepare(name, input)).execute({});

test('redactSecrets troca os valores detectados pelo Cofre por [redigido]', () => {
  const out = redactSecrets(`export OPENAI_API_KEY=${OPENAI}\nok`);
  assert.equal(out, 'export OPENAI_API_KEY=[redigido]\nok');
  assert.equal(redactSecrets('nada aqui'), 'nada aqui');
});

test('read_terminal com OPENAI_API_KEY sintético sai redigido', async () => {
  const terminal = `$ echo $OPENAI_API_KEY\n${OPENAI}\n$ env | grep DB\nDB_PASSWORD=${DB_PASS}\n`;
  const extraTools = createRendererTools(async () => terminal);
  fs.writeFileSync(path.join(root, '.env'), `DB_PASSWORD=${DB_PASS}\nPORT=3000\n`);
  const box = createToolbox({ root, extraTools, secrets: [] });
  const r = await exec(box, 'read_terminal', {});
  assert.ok(!r.result.includes(OPENAI), r.result);
  assert.ok(!r.result.includes(DB_PASS), r.result);
  assert.match(r.result, /\[redigido\]/);
});

test('saída de ferramenta extra passa pelos secrets do run_command', async () => {
  const token = 'tokenDoAmbiente12345';
  const extraTools = [{
    definition: { name: 'eco', description: 'x', parameters: { type: 'object', properties: {} } },
    kind: 'read',
    prepare: () => ({ title: 'eco', run: async () => ({ summary: `achou ${token}`, output: `valor=${token}` }) }),
  }];
  const box = createToolbox({ root, extraTools, secrets: [token] });
  const r = await exec(box, 'eco', {});
  assert.equal(r.result, 'valor=[redigido]');
  assert.equal(r.summary, 'achou [redigido]');
});

test('read_file de .env mascara valores; .env.example não', async () => {
  fs.writeFileSync(path.join(root, '.env'), `# comentário\nOPENAI_API_KEY=${OPENAI}\nexport DB_PASSWORD="${DB_PASS}"\nVAZIA=\nMULTI="a\nb"\n`);
  fs.writeFileSync(path.join(root, '.env.local'), `X=${DB_PASS}\n`);
  fs.writeFileSync(path.join(root, '.env.example'), 'OPENAI_API_KEY=coloque-aqui\nPORT=3000\n');
  const box = createToolbox({ root });
  const env = (await exec(box, 'read_file', { path: '.env' })).result;
  assert.ok(!env.includes(OPENAI) && !env.includes(DB_PASS), env);
  assert.match(env, /OPENAI_API_KEY=\*\*\*\*/);
  assert.match(env, /export DB_PASSWORD=\*\*\*\*/);
  assert.match(env, /VAZIA=$/m);
  assert.match(env, /# comentário/);
  assert.ok(!/\tb"/.test(env), env);
  assert.ok(!(await exec(box, 'read_file', { path: '.env.local' })).result.includes(DB_PASS));
  const example = (await exec(box, 'read_file', { path: '.env.example' })).result;
  assert.match(example, /OPENAI_API_KEY=coloque-aqui/);
  assert.match(example, /PORT=3000/);
});

test('search não devolve valores de .env', async () => {
  fs.writeFileSync(path.join(root, '.env'), `DB_PASSWORD=${DB_PASS}\n`);
  const box = createToolbox({ root });
  const r = await exec(box, 'search', { query: 'DB_PASSWORD' });
  assert.match(r.result, /\.env:1: DB_PASSWORD=\*\*\*\*/);
  assert.ok(!r.result.includes(DB_PASS));
});
