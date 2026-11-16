const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRemote, parseGithubRemote, validateToken, pickAccountForRepo, createAccountsService } = require('../../src/main/github/accounts');
const { apiBase } = require('../../src/main/github/api');

test('normalizeRemote: formatos do GitHub e não-GitHub', () => {
  assert.equal(normalizeRemote('git@github.com:Org/Repo.git'), 'github.com/org/repo');
  assert.equal(normalizeRemote('https://github.com/Org/Repo.git'), 'github.com/org/repo');
  assert.equal(normalizeRemote('https://github.com/Org/Repo'), 'github.com/org/repo');
  assert.equal(normalizeRemote('ssh://git@github.com/Org/Repo'), 'github.com/org/repo');
  assert.equal(normalizeRemote('https://gitlab.com/a/b.git'), null);
  assert.equal(normalizeRemote('/tmp/bare'), null);
  assert.equal(parseGithubRemote('https://github.com/a/b.git').https, true);
  assert.equal(parseGithubRemote('git@github.com:a/b.git').https, false);
});

test('pickAccountForRepo: explícito > dono > padrão > única', () => {
  const accounts = [{ id: '1', login: 'Ana' }, { id: '2', login: 'org-b' }];
  const s = { github: { accounts, repoAccounts: { 'github.com/x/y': '1' }, defaultAccountId: null } };
  assert.equal(pickAccountForRepo(s, 'github.com/x/y'), '1');
  assert.equal(pickAccountForRepo(s, 'github.com/org-b/z'), '2');
  assert.equal(pickAccountForRepo(s, 'github.com/ana/z'), '1');
  assert.equal(pickAccountForRepo(s, 'github.com/outro/z'), null);
  assert.equal(pickAccountForRepo({ github: { ...s.github, defaultAccountId: '2' } }, 'github.com/outro/z'), '2');
  assert.equal(pickAccountForRepo({ github: { accounts: [accounts[0]], repoAccounts: {} } }, 'github.com/outro/z'), '1');
  assert.equal(pickAccountForRepo({ github: { accounts: [], repoAccounts: {} } }, 'github.com/x/y'), null);
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const r = routes(url, init);
    return {
      ok: r.status < 400,
      status: r.status,
      headers: { get: () => r.type || 'application/json' },
      text: async () => JSON.stringify(r.body ?? {}),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
  fn.calls = calls;
  return fn;
}

test('validateToken: 200 → conta; 401 → erro', async () => {
  const f = fakeFetch((url, init) => (init.headers.Authorization === 'Bearer bom'
    ? { status: 200, body: { id: 42, login: 'ana', name: 'Ana', avatar_url: 'https://a/x.png' } }
    : { status: 401, body: { message: 'Bad credentials' } }));
  const acc = await validateToken('bom', { fetchImpl: f, apiBase: 'http://api' });
  assert.deepEqual(acc, { id: '42', login: 'ana', name: 'Ana', avatarUrl: 'https://a/x.png' });
  assert.equal(f.calls[0].url, 'http://api/user');
  await assert.rejects(validateToken('ruim', { fetchImpl: f, apiBase: 'http://api' }), /Token inválido ou expirado/);
});

test('apiBase: AGZOS_GITHUB_API só com AGZOS_TEST=1', () => {
  assert.equal(apiBase({ AGZOS_GITHUB_API: 'http://evil' }), 'https://api.github.com');
  assert.equal(apiBase({ AGZOS_TEST: '1', AGZOS_GITHUB_API: 'http://127.0.0.1:9/' }), 'http://127.0.0.1:9');
});

function memory() {
  let settings = { theme: 'x', github: { accounts: [], repoAccounts: {} } };
  const secrets = new Map();
  return {
    settingsStore: { load: () => structuredClone(settings), save: (s) => { settings = structuredClone(s); } },
    store: { set: (k, v) => secrets.set(k, v), get: (k) => secrets.get(k) ?? null, has: (k) => secrets.has(k), delete: (k) => secrets.delete(k) },
    get settings() { return settings; },
    secrets,
  };
}

test('serviço: addToken guarda token no cofre (nunca no settings), migra onboarding, resolve por remote', async () => {
  const m = memory();
  const users = { tokA: { id: 1, login: 'ana' }, tokB: { id: 2, login: 'org-b' } };
  const f = fakeFetch((url, init) => {
    const tok = (init.headers?.Authorization || '').replace('Bearer ', '');
    if (url.endsWith('/user')) return users[tok] ? { status: 200, body: users[tok] } : { status: 401, body: {} };
    return { status: 404 };
  });
  const svc = createAccountsService({ settingsStore: m.settingsStore, store: m.store, fetchImpl: f, apiBase: 'http://api' });
  m.store.set('github.onboarding', 'tokA');
  let list = await svc.list();
  assert.deepEqual(list.accounts.map((a) => a.login), ['ana']);
  assert.equal(m.store.has('github.onboarding'), false);
  assert.equal(list.defaultAccountId, '1');
  await svc.addToken('tokB');
  assert.equal(m.secrets.get('github.2'), 'tokB');
  assert.ok(!JSON.stringify(m.settings).includes('tokB'));
  assert.equal(m.settings.theme, 'x');

  let r = svc.resolveForRemote('https://github.com/org-b/x.git');
  assert.equal(r.account.login, 'org-b');
  assert.equal(r.token, 'tokB');
  assert.equal(svc.resolveForRemote('git@github.com:org-b/x.git').token, null);
  assert.equal(svc.resolveForRemote('/tmp/bare').token, null);
  svc.assign('github.com/org-b/x', '1');
  r = svc.resolveForRemote('https://github.com/org-b/x.git');
  assert.equal(r.account.login, 'ana');

  list = svc.remove('1');
  assert.deepEqual(list.accounts.map((a) => a.login), ['org-b']);
  assert.equal(list.defaultAccountId, '2');
  assert.deepEqual(list.repoAccounts, {});
  assert.equal(m.store.has('github.1'), false);

  m.store.set('github.onboarding', 'revogado');
  await svc.list();
  assert.equal(m.store.has('github.onboarding'), false);
});
