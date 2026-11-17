const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const gitIpc = require('../../src/main/ipc/git');
const { createCommitGuard, commitCommandRisk, COMMIT_RE } = require('../../src/main/modules/envvault/commit-guard');
const { createToolbox } = require('../../src/main/agent/tools');
const { needsApproval } = require('../../src/main/agent/loop');

// Valor SINTÉTICO (não é chave real), montado em tempo de execução.
const FAKE_AWS = ['AK', 'IA', 'Z3Q7R2M9K4T8W1P6'].join('');

let repo;
let userData;
let settings;
let handlers;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: ENV });
const commitCount = () => {
  try { return Number(git('rev-list', '--count', 'HEAD').trim()); } catch { return 0; }
};

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-envcommit-')));
  userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-envud-')));
  git('init', '-q');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  settings = { modules: { envVault: { enabled: true, blockCommits: true } } };
  const guard = createPathGuard();
  guard.allow(repo);
  handlers = {};
  const commitGuard = createCommitGuard({ getSettings: () => settings, userDataDir: userData });
  gitIpc.register({ handle: (ch, fn) => { handlers[ch] = fn; } }, { guard, commitGuard });
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
});

const commit = (options) => handlers['git:commit']({}, repo, 'msg', options);
const stageFile = (name, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  fs.writeFileSync(path.join(repo, name), text);
  git('add', '--', name);
};

test('segredo staged bloqueia e não cria commit', async () => {
  stageFile('src/config.js', `const a = 1;\nconst k = "${FAKE_AWS}";\n`);
  const r = await commit();
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'secrets_detected');
  assert.deepEqual(r.error.findings, [{ file: 'src/config.js', line: 2, rule: 'aws-access-key', preview: 'AKIA…' }]);
  assert.ok(!JSON.stringify(r).includes(FAKE_AWS));
  assert.equal(commitCount(), 0);
});

test('ignoreSecretsOnce commita e grava log sem o valor', async () => {
  stageFile('a.js', `const k = "${FAKE_AWS}";\n`);
  const r = await commit({ ignoreSecretsOnce: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(commitCount(), 1);
  const log = fs.readFileSync(path.join(userData, 'envvault-overrides.log'), 'utf8');
  const cols = log.trim().split('\t');
  assert.equal(cols.length, 4);
  assert.ok(!Number.isNaN(Date.parse(cols[0])));
  assert.equal(cols[1], repo);
  assert.equal(cols[2], 'a.js');
  assert.equal(cols[3], 'aws-access-key');
  assert.ok(!log.includes(FAKE_AWS));
});

test('.env staged bloqueia mesmo sem segredo reconhecível', async () => {
  stageFile('.env', 'DEBUG=1\n');
  const r = await commit();
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'secrets_detected');
  assert.deepEqual(r.error.findings.map((f) => [f.file, f.rule]), [['.env', 'env-file']]);
  assert.equal(commitCount(), 0);
});

test('.env.example passa', async () => {
  stageFile('.env.example', 'API_KEY=\nDEBUG=1\n');
  const r = await commit();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(commitCount(), 1);
});

test('blockCommits=false (ou módulo desabilitado) não bloqueia', async () => {
  settings.modules.envVault.blockCommits = false;
  stageFile('a.js', `const k = "${FAKE_AWS}";\n`);
  assert.equal((await commit()).ok, true);
  settings.modules.envVault = { enabled: false, blockCommits: true };
  stageFile('b.js', `const k = "${FAKE_AWS}";\n`);
  assert.equal((await commit()).ok, true);
  assert.equal(commitCount(), 2);
});

test('allowlist das settings libera o commit', async () => {
  settings.modules.envVault.allowlist = [FAKE_AWS];
  stageFile('a.js', `const k = "${FAKE_AWS}";\n`);
  assert.equal((await commit()).ok, true);
});

test('regex do comando de commit', () => {
  for (const c of ['git commit -m x', 'git -c a=b commit', 'cd x && git commit -am "y"', 'git  commit']) assert.ok(COMMIT_RE.test(c), c);
  for (const c of ['git status', 'echo commit', 'git log | grep commit', 'git add . ; echo commit']) assert.ok(!COMMIT_RE.test(c), c);
});

test('agente: git commit com staged sujo vira risco e pede OK no modo auto', async () => {
  const commitGuard = createCommitGuard({ getSettings: () => settings, userDataDir: userData });
  const hookTool = {
    definition: { name: 'env_hook_test', description: 'x', input_schema: { type: 'object', properties: {} } },
    kind: 'read',
    prepare: () => ({ title: 'x', run: async () => ({ summary: 'ok' }) }),
    commandRisk: (command, ctx) => commitCommandRisk(command, ctx, { commitGuard }),
  };
  const box = createToolbox({ root: repo, checkpoint: null, extraTools: [hookTool] });

  // staged limpo: sem risco
  stageFile('ok.js', 'const a = 1;\n');
  const clean = await box.prepare('run_command', { command: 'git commit -m teste' });
  assert.equal(clean.risky, false);

  stageFile('a.js', `const k = "${FAKE_AWS}";\n`);
  const dirty = await box.prepare('run_command', { command: 'git commit -m teste' });
  assert.equal(dirty.risky, true);
  assert.equal(dirty.riskReason, 'commit com possíveis segredos');
  assert.equal(dirty.preview.reason, 'commit com possíveis segredos');
  assert.equal(needsApproval('auto', dirty, new Set()), true);
  assert.ok(!JSON.stringify(dirty.preview).includes(FAKE_AWS));

  // outros comandos continuam síncronos e sem varredura
  const other = box.prepare('run_command', { command: 'git status' });
  assert.equal(typeof other.then, 'undefined');
  assert.equal(other.risky, false);

  settings.modules.envVault.blockCommits = false;
  const off = await box.prepare('run_command', { command: 'git commit -m teste' });
  assert.equal(off.risky, false);
});
