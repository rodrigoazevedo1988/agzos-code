const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const envIpc = require('../../src/main/ipc/envvault');
const { HOOK_MARKER } = require('../../src/main/modules/envvault/hook');

// Valores SINTÉTICOS (não são chaves reais), montados em tempo de execução.
const FAKE_AWS = ['AK', 'IA', 'Z3Q7R2M9K4T8W1P6'].join('');
const FAKE_PASS = ['Hj7Kq2', 'Lm9Np4Rt5Vw8'].join('');
const PLAIN = 'valor-comum-123';

let root;
let outside;
let userData;
let h;
let clip;
let settings;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: ENV });
const call = (name, ...args) => h[`envvault:${name}`]({}, ...args);
const p = (...parts) => path.join(root, ...parts);

const ENV_TEXT = [
  '# Banco',
  `DB_PASSWORD=${FAKE_PASS}`,
  `export AWS_KEY="${FAKE_AWS}" # chave`,
  `PLAIN=${PLAIN}`,
  'EMPTY=',
  'EXTRA_ONLY=1',
  '',
].join('\n');

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-envipc-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-envout-')));
  userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-envud-')));
  fs.writeFileSync(p('.env'), ENV_TEXT);
  fs.writeFileSync(p('.env.example'), '# Banco\nDB_PASSWORD=\nAWS_KEY=\nPLAIN=\nEMPTY=\nMISSING_ONE=\n');
  fs.mkdirSync(p('apps', 'web'), { recursive: true });
  fs.writeFileSync(p('apps', 'web', '.env.local'), 'A=1\n');
  fs.mkdirSync(p('node_modules', 'x'), { recursive: true });
  fs.writeFileSync(p('node_modules', 'x', '.env'), 'NOPE=1\n');
  fs.mkdirSync(p('a', 'b', 'c', 'd'), { recursive: true });
  fs.writeFileSync(p('a', 'b', 'c', 'd', '.env'), 'DEEP=1\n');
  fs.writeFileSync(path.join(outside, '.env'), `X=${FAKE_PASS}\n`);
  const guard = createPathGuard();
  guard.allow(root);
  h = {};
  clip = { text: null, writeText(t) { this.text = t; } };
  settings = { recentFolders: [root], modules: { envVault: { enabled: true, blockCommits: true } } };
  envIpc.register({ handle: (ch, fn) => { h[ch] = fn; } }, {
    guard, userDataDir: userData, settingsStore: { load: () => settings }, clipboard: clip,
  });
});
afterEach(() => {
  for (const d of [root, outside, userData]) fs.rmSync(d, { recursive: true, force: true });
});

test('list: arquivos .env* até profundidade 3, sem node_modules, e sem valores', async () => {
  const res = await call('list', root);
  const rels = res.files.map((f) => f.rel).sort();
  assert.deepEqual(rels, ['.env', '.env.example', 'apps/web/.env.local']);
  const json = JSON.stringify(res);
  for (const v of [FAKE_AWS, FAKE_PASS, PLAIN]) assert.ok(!json.includes(v), 'valor vazou no list');
  assert.ok(!json.includes('"value"'));
  const env = res.files.find((f) => f.rel === '.env');
  const byKey = Object.fromEntries(env.entries.map((e) => [e.key, e]));
  assert.equal(byKey.PLAIN.masked, '••••••••');
  assert.equal(byKey.EMPTY.masked, '');
  assert.equal(byKey.AWS_KEY.flags.secret, true);
  assert.equal(byKey.DB_PASSWORD.flags.secret, true);
  assert.equal(byKey.PLAIN.flags.secret, false);
  assert.equal(byKey.EMPTY.flags.empty, true);
  assert.equal(byKey.EXTRA_ONLY.flags.extra, true);
  assert.equal(byKey.MISSING_ONE.flags.missing, true);
  assert.equal(byKey.MISSING_ONE.line, null);
  assert.equal(byKey.AWS_KEY.line, 3);
  assert.deepEqual(env.compare, { example: '.env.example', missing: ['MISSING_ONE'], extra: ['EXTRA_ONLY'], empty: ['EMPTY'] });
  assert.equal(res.summary.secrets, 2);
  assert.equal(res.summary.missing, 1);
});

test('list sem argumento usa a pasta recente; fora do workspace é negado', async () => {
  assert.equal((await call('list')).root, root);
  await assert.rejects(call('list', outside), /Acesso negado/);
});

test('reveal devolve o valor; fora do workspace e arquivo não-.env são negados', async () => {
  assert.deepEqual(await call('reveal', p('.env'), 'AWS_KEY'), { value: FAKE_AWS });
  await assert.rejects(call('reveal', path.join(outside, '.env'), 'X'), /Acesso negado/);
  fs.writeFileSync(p('config.js'), 'A=1\n');
  await assert.rejects(call('reveal', p('config.js'), 'A'), /\.env/);
  await assert.rejects(call('reveal', p('.env'), 'NAO_EXISTE'), (e) => !e.message.includes(FAKE_AWS));
});

test('copy grava na área de transferência do main e não devolve o valor', async () => {
  const r = await call('copy', p('.env'), 'DB_PASSWORD');
  assert.deepEqual(r, { ok: true });
  assert.equal(clip.text, FAKE_PASS);
});

test('setValue altera só a linha e undo restaura byte a byte', async () => {
  const before = fs.readFileSync(p('.env'), 'utf8');
  const r = await call('setValue', p('.env'), 'PLAIN', 'novo valor');
  assert.ok(r.checkpointId);
  const after = fs.readFileSync(p('.env'), 'utf8');
  assert.equal(after, before.replace(`PLAIN=${PLAIN}`, 'PLAIN="novo valor"'));
  assert.deepEqual(await call('undo', r.checkpointId), { restored: [p('.env')], errors: [] });
  assert.equal(fs.readFileSync(p('.env'), 'utf8'), before);
  const cpDir = path.join(userData, 'envvault-checkpoints');
  assert.ok(fs.existsSync(cpDir));
  if (process.platform !== 'win32') assert.equal(fs.statSync(cpDir).mode & 0o777, 0o700);
});

test('addKey/removeKey: chave nova no fim, duplicada recusada, remoção da linha', async () => {
  await call('addKey', p('.env'), 'NEW_KEY', 'x');
  assert.ok(fs.readFileSync(p('.env'), 'utf8').endsWith('EXTRA_ONLY=1\nNEW_KEY=x\n'));
  await assert.rejects(call('addKey', p('.env'), 'NEW_KEY', 'y'), /já existe/);
  await assert.rejects(call('setValue', p('.env'), 'NAO_EXISTE', 'y'), /não encontrada/);
  await assert.rejects(call('addKey', p('.env'), 'COM ESPACO', 'y'), /Chave inválida/);
  await call('removeKey', p('.env'), 'EXTRA_ONLY');
  assert.ok(!fs.readFileSync(p('.env'), 'utf8').includes('EXTRA_ONLY'));
});

test('generateExample cria .env.example com chaves vazias e comentários; atualiza só acrescentando', async () => {
  fs.rmSync(p('.env.example'));
  const r = await call('generateExample', p('.env'));
  assert.equal(r.created, true);
  assert.equal(r.path, p('.env.example'));
  assert.equal(fs.readFileSync(p('.env.example'), 'utf8'), [
    '# Banco', 'DB_PASSWORD=', 'export AWS_KEY= # chave', 'PLAIN=', 'EMPTY=', 'EXTRA_ONLY=', '',
  ].join('\n'));
  fs.writeFileSync(p('.env.example'), '# meu exemplo\nPLAIN=padrao\n');
  const r2 = await call('generateExample', p('.env'));
  assert.equal(r2.created, false);
  assert.deepEqual(r2.added, ['DB_PASSWORD', 'AWS_KEY', 'EMPTY', 'EXTRA_ONLY']);
  assert.equal(fs.readFileSync(p('.env.example'), 'utf8'), '# meu exemplo\nPLAIN=padrao\nDB_PASSWORD=\nAWS_KEY=\nEMPTY=\nEXTRA_ONLY=\n');
  const json = fs.readFileSync(p('.env.example'), 'utf8');
  for (const v of [FAKE_AWS, FAKE_PASS, PLAIN]) assert.ok(!json.includes(v));
});

test('gitignoreStatus e addToGitignore (sem duplicar)', async () => {
  git('init', '-q');
  assert.deepEqual(await call('gitignoreStatus', root), { repo: true, hasEnv: true, ignored: false });
  const r = await call('addToGitignore', root);
  assert.deepEqual(r.added, ['.env', '.env*.local']);
  assert.deepEqual(await call('gitignoreStatus', root), { repo: true, hasEnv: true, ignored: true });
  const again = await call('addToGitignore', root);
  assert.deepEqual(again.added, []);
  assert.equal(fs.readFileSync(p('.gitignore'), 'utf8'), '.env\n.env*.local\n');
  fs.writeFileSync(p('.gitignore'), 'node_modules');
  await call('addToGitignore', root);
  assert.equal(fs.readFileSync(p('.gitignore'), 'utf8'), 'node_modules\n.env\n.env*.local\n');
});

test('scanStaged: achados do staged sem valores', async () => {
  git('init', '-q');
  fs.writeFileSync(p('a.js'), `const k = "${FAKE_AWS}";\n`);
  git('add', 'a.js');
  const r = await call('scanStaged', root);
  assert.deepEqual(r.findings.map((f) => [f.file, f.line, f.rule]), [['a.js', 1, 'aws-access-key']]);
  assert.ok(!JSON.stringify(r).includes(FAKE_AWS));
});

test('installHook cria executável com marcador; hookStatus e removeHook', async () => {
  git('init', '-q');
  assert.equal(await call('hookStatus', root), 'none');
  assert.deepEqual(await call('installHook', root), { installed: true });
  const hook = p('.git', 'hooks', 'pre-commit');
  const text = fs.readFileSync(hook, 'utf8');
  assert.ok(text.startsWith('#!/bin/sh\n'));
  assert.ok(text.includes(HOOK_MARKER));
  if (process.platform !== 'win32') assert.equal(fs.statSync(hook).mode & 0o755, 0o755);
  assert.equal(await call('hookStatus', root), 'installed');
  assert.deepEqual(await call('removeHook', root), { removed: true });
  assert.equal(fs.existsSync(hook), false);
});

test('hook instalado bloqueia commit com chave AWS (git real) e deixa passar o limpo', { skip: process.platform === 'win32' }, async () => {
  git('init', '-q');
  await call('installHook', root);
  fs.writeFileSync(p('ok.js'), 'const a = 1;\n');
  git('add', 'ok.js');
  assert.equal(spawnSync('git', ['commit', '-qm', 'ok'], { cwd: root, env: ENV }).status, 0);
  fs.writeFileSync(p('a.js'), `const k = "${FAKE_AWS}";\n`);
  git('add', 'a.js');
  const r = spawnSync('git', ['commit', '-qm', 'x'], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Cofre \.env/);
  assert.ok(!r.stderr.includes(FAKE_AWS), 'o hook não pode imprimir o segredo');
  git('reset', '-q', 'a.js');
  fs.writeFileSync(p('.env.production'), 'X=1\n');
  git('add', '-f', '.env.production');
  assert.equal(spawnSync('git', ['commit', '-qm', 'env'], { cwd: root, env: ENV }).status, 1);
});

test('installHook não sobrescreve hook alheio; removeHook respeita o marcador', async () => {
  git('init', '-q');
  const hook = p('.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho meu\n', { mode: 0o755 });
  assert.deepEqual(await call('installHook', root), { installed: false, reason: 'exists' });
  assert.equal(await call('hookStatus', root), 'foreign');
  assert.deepEqual(await call('removeHook', root), { removed: false, reason: 'foreign' });
  assert.equal(fs.readFileSync(hook, 'utf8'), '#!/bin/sh\necho meu\n');
});

test('canais registrados batem com CHANNELS (+ undo)', () => {
  for (const name of envIpc.CHANNELS) assert.equal(typeof h[`envvault:${name}`], 'function', name);
  assert.equal(typeof h['envvault:undo'], 'function');
});

test('undo de checkpoint de outra janela é recusado; guard da janela vale na restauração', async () => {
  const { createWindowGuards } = require('../../src/main/lib/window-guards');
  const guards = createWindowGuards();
  const mk = (id) => Object.assign(new (require('node:events').EventEmitter)(), { id, isDestroyed: () => false, send: () => {} });
  const a = mk(11);
  const b = mk(12);
  guards.guardFor(a).allow(root);
  guards.guardFor(b).allow(root);
  const hh = {};
  envIpc.register({ handle: (ch, fn) => { hh[ch] = fn; } }, {
    guardFor: guards.guardFor, userDataDir: userData, settingsStore: { load: () => settings }, clipboard: clip,
  });
  const { checkpointId } = await hh['envvault:setValue']({ sender: a }, p('.env'), 'PLAIN', 'novo-valor');
  const changed = fs.readFileSync(p('.env'), 'utf8');
  const denied = await hh['envvault:undo']({ sender: b }, checkpointId);
  assert.deepEqual(denied.restored, []);
  assert.match(denied.errors[0].message, /outra janela/);
  assert.equal(fs.readFileSync(p('.env'), 'utf8'), changed);
  // dona sem a pasta liberada (trocou de pasta) → negado pelo guard
  guards.guardFor(a).revoke(root);
  const noGuard = await hh['envvault:undo']({ sender: a }, checkpointId);
  assert.match(noGuard.errors[0].message, /Acesso negado/);
  guards.guardFor(a).allow(root);
  const ok = await hh['envvault:undo']({ sender: a }, checkpointId);
  assert.deepEqual(ok.errors, []);
  assert.equal(fs.readFileSync(p('.env'), 'utf8'), ENV_TEXT);
});
