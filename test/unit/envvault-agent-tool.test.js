const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createToolbox } = require('../../src/main/agent/tools');
const { getModuleTools } = require('../../src/main/modules/agent-tools');
const { configureCommitGuard } = require('../../src/main/modules/envvault/commit-guard');

// Valores SINTÉTICOS (não são chaves reais), montados em tempo de execução.
const FAKE_AWS = ['AK', 'IA', 'Z3Q7R2M9K4T8W1P6'].join('');
const FAKE_PASS = ['Hj7Kq2', 'Lm9Np4Rt5Vw8'].join('');
const PLAIN = 'valor-comum-123';

let root;
let settings;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: ENV });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-envtool-')));
  fs.writeFileSync(path.join(root, '.env'), `DB_PASSWORD=${FAKE_PASS}\nAWS_KEY=${FAKE_AWS}\nPLAIN=${PLAIN}\nEMPTY=\nEXTRA=1\n`);
  fs.writeFileSync(path.join(root, '.env.example'), 'DB_PASSWORD=\nAWS_KEY=\nPLAIN=\nEMPTY=\nFALTA=\n');
  settings = { modules: { envVault: { enabled: true, blockCommits: true } } };
  configureCommitGuard({ getSettings: () => settings });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const envTool = () => getModuleTools(settings).find((t) => t.definition.name === 'env_check');

test('env_check: ferramenta read, só com o módulo habilitado', () => {
  const t = envTool();
  assert.ok(t);
  assert.equal(t.kind, 'read');
  assert.deepEqual(t.definition.input_schema.properties, {});
  settings.modules.envVault.enabled = false;
  assert.equal(envTool(), undefined);
});

test('env_check devolve chaves, missing/extra/empty, segredos e staged — sem valores', async () => {
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'a.js'), `const k = "${FAKE_AWS}";\n`);
  git('add', 'a.js');
  const box = createToolbox({ root, checkpoint: null, extraTools: [envTool()] });
  const prepared = await box.prepare('env_check', {});
  assert.equal(prepared.category, 'read');
  const res = await prepared.execute({});
  assert.equal(res.ok, true);
  const data = JSON.parse(res.result);
  const env = data.files.find((f) => f.path === '.env');
  assert.deepEqual(env.keys, ['DB_PASSWORD', 'AWS_KEY', 'PLAIN', 'EMPTY', 'EXTRA']);
  assert.deepEqual(env.missing, ['FALTA']);
  assert.deepEqual(env.extra, ['EXTRA']);
  assert.deepEqual(env.empty, ['EMPTY']);
  assert.deepEqual(env.secrets, [{ key: 'DB_PASSWORD', rule: 'generic-secret' }, { key: 'AWS_KEY', rule: 'aws-access-key' }]);
  assert.deepEqual(data.stagedFindings, [{ file: 'a.js', line: 1, rule: 'aws-access-key' }]);
  const all = JSON.stringify(res);
  for (const v of [FAKE_AWS, FAKE_PASS, PLAIN, FAKE_AWS.slice(0, 4) + '…']) assert.ok(!all.includes(v), 'valor vazou para o modelo');
});

test('env_check fora de repositório git: stagedFindings vazio', async () => {
  const box = createToolbox({ root, checkpoint: null, extraTools: [envTool()] });
  const res = await (await box.prepare('env_check', {})).execute({});
  assert.deepEqual(JSON.parse(res.result).stagedFindings, []);
});

test('via getModuleTools, git commit com segredo staged vira risco no run_command', async () => {
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'a.js'), `const k = "${FAKE_AWS}";\n`);
  git('add', 'a.js');
  const box = createToolbox({ root, checkpoint: null, extraTools: getModuleTools(settings) });
  const p = await box.prepare('run_command', { command: 'git commit -m x' });
  assert.equal(p.risky, true);
  assert.equal(p.riskReason, 'commit com possíveis segredos');
});
