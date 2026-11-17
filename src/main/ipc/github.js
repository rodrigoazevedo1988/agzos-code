/**
 * IPC: github:* — contas (PAT), associação por repositório, criar repositório
 * e Pull Request. Tokens ficam no cofre e nunca vão ao renderer.
 */

const ops = require('../git/ops');
const { getStatus } = require('../git/status');
const { GitError } = require('../git/run');
const { createAccountsService, normalizeRemote, parseGithubRemote } = require('../github/accounts');
const { createGitHubApi, apiBase } = require('../github/api');
const { wrap, identityFor } = require('./git');

function register(ipcMain, { guard, settingsStore, store, app, fetchImpl = globalThis.fetch }) {
  const accounts = createAccountsService({ settingsStore, store, fetchImpl, apiBase });

  function assertCwd(cwd) {
    if (typeof cwd !== 'string' || !cwd) throw new GitError('Pasta inválida', { kind: 'invalid' });
    return guard.assertAllowed(cwd);
  }

  function apiFor(account) {
    if (!account) throw new GitError('Adicione uma conta GitHub em Configurações → Git & GitHub.', { kind: 'no-account' });
    const token = accounts.tokenFor(account.id);
    if (!token) throw new GitError(`Token da conta ${account.login} não encontrado. Adicione a conta de novo.`, { kind: 'auth' });
    return createGitHubApi({ token, login: account.login, fetchImpl, base: apiBase() });
  }

  async function repoContext(dir) {
    const remote = await ops.currentRemote(dir).catch(() => null);
    if (!remote) return { remote: null, remoteKey: null, github: null, account: null };
    const r = accounts.resolveForRemote(remote.url);
    return { remote, remoteKey: r.remoteKey, github: r.github, account: r.account };
  }

  const publicAccount = (a) => (a ? { id: a.id, login: a.login, name: a.name, avatarData: a.avatarData || null } : null);

  ipcMain.handle('github:accounts', wrap(() => accounts.list()));
  ipcMain.handle('github:addPat', wrap(async (_e, token) => {
    const account = await accounts.addToken(String(token || ''));
    return { account, ...(await accounts.list()) };
  }));
  ipcMain.handle('github:remove', wrap((_e, id) => accounts.remove(String(id))));
  ipcMain.handle('github:setDefault', wrap((_e, id) => accounts.setDefault(String(id))));

  ipcMain.handle('github:accountForCwd', wrap(async (_e, cwd) => {
    const ctx = await repoContext(assertCwd(cwd));
    return {
      remoteKey: ctx.remoteKey,
      github: ctx.github ? { owner: ctx.github.owner, repo: ctx.github.repo } : null,
      account: publicAccount(ctx.account),
    };
  }));

  ipcMain.handle('github:assign', wrap(async (_e, cwd, accountId) => {
    const ctx = await repoContext(assertCwd(cwd));
    if (!ctx.remoteKey) throw new GitError('Este repositório não tem remote do GitHub.', { kind: 'no-remote' });
    return accounts.assign(ctx.remoteKey, accountId == null ? null : String(accountId));
  }));

  ipcMain.handle('github:orgs', wrap(async (_e, accountId) => {
    const account = accounts.get(String(accountId));
    const orgs = await apiFor(account).listOrgs();
    return (orgs || []).map((o) => ({ login: o.login }));
  }));

  /**
   * Publicar no GitHub: init (se preciso) → commit inicial (se não houver) →
   * cria o repositório na API → remote origin → push -u.
   */
  ipcMain.handle('github:publish', wrap(async (_e, cwd, options = {}) => {
    const dir = assertCwd(cwd);
    const name = String(options?.name || '').trim();
    if (!/^[\w.-]{1,100}$/.test(name)) throw new GitError('Nome de repositório inválido (use letras, números, ".", "-" e "_").', { kind: 'invalid' });
    const account = accounts.get(String(options?.accountId || '')) || accounts.pickDefault();
    const api = apiFor(account);

    let st = await getStatus(dir);
    if (st.notRepo) { await ops.init(dir); st = await getStatus(dir); }
    if (st.remotes.some((r) => r.name === 'origin')) {
      throw new GitError('Este repositório já tem um remote "origin".', { kind: 'invalid' });
    }
    if (!(await ops.hasHead(st.root))) {
      await ops.stage(st.root, []);
      await ops.commit(st.root, 'Commit inicial', { identity: identityFor(account) });
    }

    const repo = await api.createRepo({
      name,
      private: options?.private !== false,
      description: String(options?.description || '').slice(0, 350),
      org: options?.org || undefined,
    });
    const cloneUrl = repo?.clone_url;
    if (!cloneUrl) throw new GitError('O GitHub não devolveu a URL do repositório.', { kind: 'api' });
    await ops.addRemote(st.root, 'origin', cloneUrl);

    const key = normalizeRemote(cloneUrl) || normalizeRemote(repo.html_url || '');
    if (key) accounts.assign(key, account.id);
    const token = parseGithubRemote(cloneUrl)?.https ? accounts.tokenFor(account.id) : null;
    try {
      await ops.push(st.root, { remote: 'origin', token: token || undefined });
    } catch (e) {
      throw new GitError(`Repositório criado (${repo.html_url}), mas o push falhou: ${e.message}`, { kind: e.kind || 'git' });
    }
    return { htmlUrl: repo.html_url, fullName: repo.full_name, cloneUrl: repo.html_url };
  }));

  /** Valores iniciais do formulário de PR. */
  ipcMain.handle('github:prDefaults', wrap(async (_e, cwd) => {
    const dir = assertCwd(cwd);
    const ctx = await repoContext(dir);
    if (!ctx.github) throw new GitError('O remote deste repositório não é do GitHub.', { kind: 'no-remote' });
    const st = await getStatus(dir);
    if (!st.branch) throw new GitError('HEAD destacado: troque para uma branch.', { kind: 'invalid' });
    let base = 'main';
    try {
      const info = await apiFor(ctx.account).getRepo(ctx.github.owner, ctx.github.repo);
      if (info?.default_branch) base = info.default_branch;
    } catch (e) {
      if (e.kind === 'no-account' || e.kind === 'auth') throw e;
    }
    const branches = await ops.branches(dir);
    const last = (await ops.log(dir, { limit: 1 }))[0];
    return {
      head: st.branch,
      base,
      title: last?.subject || st.branch,
      owner: ctx.github.owner,
      repo: ctx.github.repo,
      account: publicAccount(ctx.account),
      bases: [...new Set([base, ...branches.remote.map((b) => b.name.split('/').slice(1).join('/')).filter(Boolean)])],
    };
  }));

  /** Cria o PR da branch atual (faz push antes se a branch não estiver no remoto). */
  ipcMain.handle('github:createPr', wrap(async (_e, cwd, options = {}) => {
    const dir = assertCwd(cwd);
    const ctx = await repoContext(dir);
    if (!ctx.github) throw new GitError('O remote deste repositório não é do GitHub.', { kind: 'no-remote' });
    const api = apiFor(ctx.account);
    const st = await getStatus(dir);
    if (!st.branch) throw new GitError('HEAD destacado: troque para uma branch.', { kind: 'invalid' });
    const base = String(options?.base || '').trim();
    const title = String(options?.title || '').trim();
    if (!base || !title) throw new GitError('Informe a branch base e o título.', { kind: 'invalid' });
    if (base === st.branch) throw new GitError('A branch base precisa ser diferente da branch atual.', { kind: 'invalid' });
    if (!st.upstream || st.ahead > 0) {
      const token = ctx.github.https ? accounts.tokenFor(ctx.account.id) : null;
      await ops.push(dir, { token: token || undefined });
    }
    const pr = await api.createPullRequest({
      owner: ctx.github.owner,
      repo: ctx.github.repo,
      head: st.branch,
      base,
      title,
      body: String(options?.body || ''),
      draft: !!options?.draft,
    });
    return { htmlUrl: pr?.html_url, number: pr?.number };
  }));

  // Migra o token salvo no onboarding (github.onboarding) assim que o app sobe.
  if (app?.whenReady) {
    app.whenReady().then(() => setTimeout(() => accounts.migrateOnboarding().catch(() => {}), 1500));
  }

  return accounts;
}

module.exports = { register };
