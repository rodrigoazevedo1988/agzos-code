const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runGit, authEnv, buildEnv, findGit, redact, classifyError } = require('../../src/main/git/run');
const { getStatus } = require('../../src/main/git/status');

test('authEnv: extraheader basic x-access-token só para github.com', () => {
  const env = authEnv('ghp_secret');
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  const b64 = env.GIT_CONFIG_VALUE_0.replace(/^AUTHORIZATION: basic /, '');
  assert.equal(Buffer.from(b64, 'base64').toString(), 'x-access-token:ghp_secret');
  assert.deepEqual(authEnv(null), {});
});

test('buildEnv: sem prompt, sem askpass, limpa GIT_CONFIG_* herdado', () => {
  const env = buildEnv({ token: null, baseEnv: { PATH: '/bin', GIT_ASKPASS: '/x', SSH_ASKPASS: '/y', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'a', GIT_CONFIG_VALUE_1: 'b' } });
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_ASKPASS, undefined);
  assert.equal(env.SSH_ASKPASS, undefined);
  assert.equal(env.GIT_CONFIG_COUNT, undefined);
  assert.equal(env.GIT_CONFIG_KEY_1, undefined);
  assert.equal(env.PATH, '/bin');
});

test('runGit: token vai no env, nunca nos args; timeout padrão 15s', async () => {
  let call;
  const fake = (file, args, opts, cb) => { call = { file, args, opts }; cb(null, 'ok', ''); return {}; };
  const res = await runGit('/tmp', ['push'], { token: 'ghp_TOKEN', execFileImpl: fake, gitPath: 'git' });
  assert.equal(res.stdout, 'ok');
  assert.ok(!call.args.join(' ').includes('ghp_TOKEN'));
  assert.equal(call.opts.timeout, 15000);
  assert.equal(call.opts.env.GIT_TERMINAL_PROMPT, '0');
  assert.ok(call.opts.env.GIT_CONFIG_VALUE_0.startsWith('AUTHORIZATION: basic '));
  assert.equal(call.opts.shell, undefined);
});

test('runGit: ENOENT vira git-missing com mensagem amigável', async () => {
  const fake = (_f, _a, _o, cb) => { const e = new Error('spawn git ENOENT'); e.code = 'ENOENT'; cb(e, '', ''); return {}; };
  await assert.rejects(runGit('/tmp', ['status'], { execFileImpl: fake }), (e) => e.kind === 'git-missing' && /Git não encontrado/.test(e.message));
});

test('runGit: rejeita args que não são strings', async () => {
  await assert.rejects(runGit('/tmp', ['status', 1]), /inválidos/);
});

test('redact: remove credenciais de URLs e headers', () => {
  assert.equal(redact('fatal: unable to access https://user:ghp_x@github.com/a/b.git'), 'fatal: unable to access https://***@github.com/a/b.git');
  assert.equal(redact('AUTHORIZATION: basic eHg6eXk='), 'AUTHORIZATION: basic ***');
});

test('classifyError: casos principais', () => {
  assert.equal(classifyError(' ! [rejected]        main -> main (fetch first)'), 'rejected');
  assert.equal(classifyError('fatal: could not read Username for https://github.com: terminal prompts disabled'), 'auth');
  assert.equal(classifyError('fatal: not a git repository (or any of the parent directories): .git'), 'not-repo');
  assert.equal(classifyError('Author identity unknown\n*** Please tell me who you are.'), 'identity');
  assert.equal(classifyError('fatal: Not possible to fast-forward, aborting.'), 'diverged');
  assert.equal(classifyError('', { killed: true }), 'timeout');
});

test('findGit: Windows procura git.exe no PATH e cai no Program Files', () => {
  const seen = [];
  const exists = (p) => { seen.push(p); return p === 'C:\\Program Files\\Git\\cmd\\git.exe'; };
  assert.equal(findGit({ platform: 'win32', env: { Path: 'C:\\Windows;C:\\Tools', ProgramFiles: 'C:\\Program Files' }, exists }), 'C:\\Program Files\\Git\\cmd\\git.exe');
  assert.ok(seen.includes('C:\\Tools\\git.exe'));
  assert.equal(findGit({ platform: 'win32', env: { Path: 'C:\\Git\\cmd' }, exists: (p) => p === 'C:\\Git\\cmd\\git.exe' }), 'C:\\Git\\cmd\\git.exe');
  assert.equal(findGit({ platform: 'linux', env: {} }), 'git');
});

test('getStatus: repositório real lista arquivo novo como untracked; pasta sem git → notRepo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-git-run-'));
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-git-plain-'));
  await runGit(dir, ['init', '-q']);
  fs.writeFileSync(path.join(dir, 'novo ç.txt'), 'x');
  const st = await getStatus(dir);
  assert.equal(st.notRepo, undefined);
  assert.deepEqual(st.changes.map((f) => [f.path, f.status]), [['novo ç.txt', 'U']]);
  assert.equal(st.count, 1);
  assert.deepEqual(await getStatus(plain), { notRepo: true });
});
