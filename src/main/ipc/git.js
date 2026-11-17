/**
 * IPC: git:* — operações git do sistema.
 *
 * Todo handler devolve { ok: true, data } | { ok: false, error: { message, kind } }
 * (o Electron perde propriedades de Error no IPC). `cwd` sempre passa pelo path guard.
 * Tokens nunca saem do main.
 */

const path = require('path');
const ops = require('../git/ops');
const { getStatus, repoRoot } = require('../git/status');
const { gitVersion, GitError, GIT_INSTALL_URL } = require('../git/run');
const { getCommitGuard, SecretsDetectedError } = require('../modules/envvault/commit-guard');
const { guardResolver } = require('../lib/window-guards');
const { runAsOwner, isRemote, joinAny } = require('../workspace/provider-for');

function ok(data) { return { ok: true, data }; }
function fail(e) {
  const error = { message: e?.message || String(e), kind: e?.kind || 'error', status: e?.status || 0 };
  // Bloqueio do Cofre .env: achados vão junto (arquivo/linha/regra/preview mascarado, nunca o valor).
  if (Array.isArray(e?.findings)) error.findings = e.findings;
  return { ok: false, error };
}

/**
 * Embrulha um handler: exceções viram { ok: false, error }. A janela que pediu vira
 * a dona das chamadas remotas (pasta SSH: git roda pela conexão dela).
 */
function wrap(fn) {
  return async (...args) => runAsOwner(args[0]?.sender, async () => {
    try {
      return ok(await fn(...args));
    } catch (e) {
      return fail(e);
    }
  });
}

/** Fila por repositório: operações que mexem no índice não podem correr juntas. */
function createQueue() {
  const tails = new Map();
  return (key, fn) => {
    const prev = tails.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    // A cauda nunca rejeita (senão a falha de uma operação vira unhandledRejection).
    const tail = next.then(() => {}, () => {}).then(() => { if (tails.get(key) === tail) tails.delete(key); });
    tails.set(key, tail);
    return next;
  };
}

/** Identidade de commit a partir da conta GitHub (usada só se o git não tiver user.name/email). */
function identityFor(account) {
  if (!account) return undefined;
  return { name: account.name || account.login, email: `${account.id}+${account.login}@users.noreply.github.com` };
}

function register(ipcMain, { guard, guardFor, accounts, commitGuard }) {
  // Guard da janela que pediu (várias janelas).
  const guardOf = guardResolver({ guard, guardFor });
  const queue = createQueue();
  // Cofre .env: o guard é configurado pelo ipc/envvault (registrado depois); resolvido na hora do commit.
  const secretsGuard = () => commitGuard || getCommitGuard();

  function assertCwd(cwd, sender) {
    if (typeof cwd !== 'string' || !cwd) throw new GitError('Pasta inválida', { kind: 'invalid' });
    return guardOf(sender).assertAllowed(cwd);
  }

  /** Arquivos de uma operação precisam estar dentro de uma raiz liberada. */
  async function assertFiles(cwd, paths, sender) {
    if (!Array.isArray(paths)) throw new GitError('Lista de arquivos inválida', { kind: 'invalid' });
    ops.checkPaths(paths);
    const root = await repoRoot(cwd);
    if (!root) throw new GitError('Esta pasta não é um repositório Git.', { kind: 'not-repo' });
    for (const p of paths) {
      if (!guardOf(sender).isAllowed(joinAny(root, p))) throw new GitError(`Acesso negado: ${p}`, { kind: 'denied' });
    }
    return paths;
  }

  /** Token da conta associada ao remote atual (só github.com via https). */
  async function networkContext(cwd) {
    // Pasta remota: o token do GitHub nunca é resolvido nem enviado ao host.
    if (isRemote(cwd)) return { token: null, account: null, remote: null, github: null };
    const remote = await ops.currentRemote(cwd).catch(() => null);
    if (!remote || !accounts) return { token: null, account: null, remote, github: null };
    const r = accounts.resolveForRemote(remote.url);
    return { token: r.token, account: r.account, remote, github: r.github };
  }

  function explainNetworkError(e, ctx) {
    if (e?.kind !== 'auth') return e;
    if (ctx.github && ctx.github.https && !ctx.account) {
      return new GitError('Associe uma conta GitHub a este repositório.', { kind: 'no-account' });
    }
    if (ctx.account) {
      return new GitError(`Token da conta ${ctx.account.login} inválido. Atualize em Configurações → Git & GitHub.`, { kind: 'auth' });
    }
    return e;
  }

  async function withNetwork(cwd, sender, fn) {
    const dir = assertCwd(cwd, sender);
    const ctx = await networkContext(dir);
    try {
      return await queue(dir, () => fn(dir, { token: ctx.token || undefined }));
    } catch (e) {
      throw explainNetworkError(e, ctx);
    }
  }

  ipcMain.handle('git:available', wrap(async () => {
    const v = await gitVersion();
    return { ...v, installUrl: GIT_INSTALL_URL };
  }));

  ipcMain.handle('git:status', wrap(async (e, cwd) => getStatus(assertCwd(cwd, e?.sender))));

  ipcMain.handle('git:init', wrap(async (e, cwd) => {
    const dir = assertCwd(cwd, e?.sender);
    await ops.init(dir);
    return getStatus(dir);
  }));

  ipcMain.handle('git:stage', wrap(async (e, cwd, paths = []) => {
    const dir = assertCwd(cwd, e?.sender);
    await assertFiles(dir, paths, e?.sender);
    return queue(dir, () => ops.stage(dir, paths));
  }));

  ipcMain.handle('git:unstage', wrap(async (e, cwd, paths = []) => {
    const dir = assertCwd(cwd, e?.sender);
    await assertFiles(dir, paths, e?.sender);
    return queue(dir, () => ops.unstage(dir, paths));
  }));

  ipcMain.handle('git:discard', wrap(async (e, cwd, paths = []) => {
    const dir = assertCwd(cwd, e?.sender);
    await assertFiles(dir, paths, e?.sender);
    return queue(dir, () => ops.discard(dir, paths));
  }));

  ipcMain.handle('git:commit', wrap(async (e, cwd, message, options = {}) => {
    const dir = assertCwd(cwd, e?.sender);
    const ctx = await networkContext(dir);
    const account = ctx.account || accounts?.pickDefault?.() || null;
    return queue(dir, async () => {
      const sg = secretsGuard();
      let findings = [];
      let root = null;
      if (sg) {
        root = await repoRoot(dir);
        if (root) ({ findings } = await sg.check(root));
        if (findings.length && !options?.ignoreSecretsOnce) throw new SecretsDetectedError(findings);
      }
      const res = await ops.commit(dir, message, { amend: !!options?.amend, identity: identityFor(account) });
      if (findings.length) sg.logOverride(root, findings);
      return res;
    });
  }));

  ipcMain.handle('git:log', wrap(async (e, cwd, limit = 50) => ops.log(assertCwd(cwd, e?.sender), { limit })));
  ipcMain.handle('git:branches', wrap(async (e, cwd) => ops.branches(assertCwd(cwd, e?.sender))));

  ipcMain.handle('git:checkout', wrap(async (e, cwd, name) => {
    const dir = assertCwd(cwd, e?.sender);
    return queue(dir, () => ops.checkout(dir, name));
  }));

  ipcMain.handle('git:createBranch', wrap(async (e, cwd, name, options = {}) => {
    const dir = assertCwd(cwd, e?.sender);
    return queue(dir, () => ops.createBranch(dir, name, { checkout: options?.checkout !== false }));
  }));

  ipcMain.handle('git:fetch', wrap((e, cwd) => withNetwork(cwd, e?.sender, (dir, o) => ops.fetch(dir, o))));
  ipcMain.handle('git:pull', wrap((e, cwd) => withNetwork(cwd, e?.sender, (dir, o) => ops.pull(dir, o))));
  ipcMain.handle('git:push', wrap((e, cwd) => withNetwork(cwd, e?.sender, (dir, o) => ops.push(dir, o))));
  ipcMain.handle('git:sync', wrap((e, cwd) => withNetwork(cwd, e?.sender, (dir, o) => ops.sync(dir, o))));

  ipcMain.handle('git:diffFile', wrap(async (e, cwd, relPath, options = {}) => {
    const dir = assertCwd(cwd, e?.sender);
    await assertFiles(dir, [relPath, ...(options?.origPath ? [options.origPath] : [])], e?.sender);
    return ops.diffFile(dir, relPath, { staged: !!options?.staged, origPath: options?.origPath });
  }));

  ipcMain.handle('git:clone', wrap(async (evt, url, parentDir, options = {}) => {
    if (typeof parentDir !== 'string' || !parentDir) throw new GitError('Escolha a pasta de destino.', { kind: 'invalid' });
    const g = guardOf(evt?.sender);
    const parent = g.assertAllowed(parentDir);
    const cleanUrl = ops.checkCloneUrl(url);
    // Origem local (caminho absoluto ou file://) precisa estar liberada no guard:
    // sem isso o renderer poderia copiar qualquer repositório do disco.
    if (path.isAbsolute(cleanUrl) || /^file:\/\//i.test(cleanUrl)) {
      const local = /^file:\/\//i.test(cleanUrl) ? require('url').fileURLToPath(cleanUrl) : cleanUrl;
      g.assertAllowed(local);
    }
    let token;
    if (accounts && !isRemote(parent)) {
      const r = accounts.resolveForRemote(cleanUrl);
      if (r.github?.https) {
        const id = options?.accountId || r.account?.id;
        token = id ? accounts.tokenFor(id) || undefined : undefined;
      }
    }
    const requestId = options?.requestId || null;
    const send = (p) => {
      try { if (!evt.sender.isDestroyed()) evt.sender.send('git:progress', { op: 'clone', requestId, ...p }); } catch { /* janela fechou */ }
    };
    const result = await ops.clone(cleanUrl, parent, { name: options?.name, token, onProgress: send });
    g.allow(result.path);
    if (accounts && options?.accountId) {
      const r = accounts.resolveForRemote(cleanUrl);
      if (r.remoteKey) { try { accounts.assign(r.remoteKey, options.accountId); } catch { /* conta removida */ } }
    }
    send({ percent: 100, text: 'Concluído' });
    return result;
  }));

  return { assertCwd, queue, networkContext, identityFor };
}

module.exports = { register, wrap, ok, fail, identityFor, createQueue };
