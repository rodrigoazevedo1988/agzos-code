/**
 * Contas GitHub (multi-conta) e associação por repositório.
 * Tokens ficam no cofre (`github.<accountId>`); settings guardam só
 * { id, login, name, avatarUrl, avatarData } + defaultAccountId + repoAccounts.
 * Sem dependência do Electron.
 */

const { createGitHubApi, apiBase: defaultApiBase } = require('./api');

const ONBOARDING_KEY = 'github.onboarding';

/**
 * Normaliza um remote do GitHub em `github.com/<owner>/<repo>` (minúsculo).
 * Aceita https://github.com/O/R(.git), git@github.com:O/R.git, ssh://git@github.com/O/R.
 * Não-GitHub → null.
 */
function normalizeRemote(url) {
  const p = parseGithubRemote(url);
  return p ? `github.com/${p.owner.toLowerCase()}/${p.repo.toLowerCase()}` : null;
}

/** → { owner, repo, https: boolean } | null */
function parseGithubRemote(url) {
  const u = String(url || '').trim();
  let m = u.match(/^https?:\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2], https: true };
  m = u.match(/^(?:ssh:\/\/)?(?:[\w.-]+@)?github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2], https: false };
  return null;
}

/**
 * Valida o token em GET /user.
 * → { id, login, name, avatarUrl }. 401 → Error('Token inválido ou expirado').
 */
async function validateToken(token, { fetchImpl = globalThis.fetch, apiBase = defaultApiBase() } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Informe um token.');
  const api = createGitHubApi({ token: token.trim(), fetchImpl, base: apiBase });
  const user = await api.getUser();
  if (!user || user.id == null || !user.login) throw new Error('Resposta inesperada do GitHub.');
  return {
    id: String(user.id),
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url || null,
  };
}

/**
 * Escolhe a conta de um repositório:
 *  1) mapeamento explícito repoAccounts[remoteKey]
 *  2) conta cujo login é o dono do repo
 *  3) conta padrão (defaultAccountId)
 *  4) se só existe uma conta, ela
 *  senão null.
 */
function pickAccountForRepo(settings, remoteKey) {
  const gh = settings?.github || {};
  const accounts = Array.isArray(gh.accounts) ? gh.accounts : [];
  if (!accounts.length) return null;
  const has = (id) => accounts.some((a) => a.id === id);
  if (remoteKey) {
    const mapped = gh.repoAccounts?.[remoteKey];
    if (mapped && has(mapped)) return mapped;
    const owner = remoteKey.split('/')[1];
    const byOwner = accounts.find((a) => String(a.login).toLowerCase() === owner);
    if (byOwner) return byOwner.id;
  }
  if (gh.defaultAccountId && has(gh.defaultAccountId)) return gh.defaultAccountId;
  if (accounts.length === 1) return accounts[0].id;
  return null;
}

/** Busca o avatar e devolve data: URL (o CSP do renderer não carrega imagens remotas). */
async function fetchAvatarData(avatarUrl, fetchImpl) {
  if (!avatarUrl || !/^https?:\/\//i.test(avatarUrl)) return null;
  try {
    const url = avatarUrl + (avatarUrl.includes('?') ? '&' : '?') + 's=64';
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Agzos-Code' } });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
    if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 200 * 1024) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function emptyGithub() {
  return { accounts: [], defaultAccountId: null, repoAccounts: {} };
}

/**
 * Serviço de contas. settingsStore: { load(), save(s) }; store: cofre de segredos.
 */
function createAccountsService({ settingsStore, store, fetchImpl = globalThis.fetch, apiBase = defaultApiBase } = {}) {
  const base = () => (typeof apiBase === 'function' ? apiBase() : apiBase);

  function read() {
    const s = settingsStore.load();
    const gh = { ...emptyGithub(), ...(s.github || {}) };
    gh.accounts = Array.isArray(gh.accounts) ? gh.accounts : [];
    gh.repoAccounts = gh.repoAccounts && typeof gh.repoAccounts === 'object' ? gh.repoAccounts : {};
    return { settings: s, gh };
  }

  function write(settings, gh) {
    settingsStore.save({ ...settings, github: gh });
  }

  function publicView(gh) {
    return {
      accounts: gh.accounts.map(({ id, login, name, avatarUrl, avatarData }) => ({ id, login, name, avatarUrl, avatarData: avatarData || null })),
      defaultAccountId: gh.defaultAccountId || null,
      repoAccounts: { ...gh.repoAccounts },
    };
  }

  async function addToken(token) {
    const user = await validateToken(token, { fetchImpl, apiBase: base() });
    const avatarData = await fetchAvatarData(user.avatarUrl, fetchImpl);
    store.set(`github.${user.id}`, token.trim());
    const { settings, gh } = read();
    const account = { ...user, avatarData };
    const idx = gh.accounts.findIndex((a) => a.id === user.id);
    if (idx >= 0) gh.accounts[idx] = account;
    else gh.accounts.push(account);
    if (!gh.defaultAccountId) gh.defaultAccountId = user.id;
    write(settings, gh);
    return { id: account.id, login: account.login, name: account.name, avatarUrl: account.avatarUrl, avatarData };
  }

  let migrating = null;
  /** Token do onboarding vira a primeira conta. Inválido (401) → apagado. Offline → tenta depois. */
  function migrateOnboarding() {
    if (migrating) return migrating;
    migrating = (async () => {
      if (!store.has(ONBOARDING_KEY)) return false;
      const token = store.get(ONBOARDING_KEY);
      if (!token) { store.delete(ONBOARDING_KEY); return false; }
      try {
        await addToken(token);
        store.delete(ONBOARDING_KEY);
        return true;
      } catch (e) {
        if (e.status === 401 || /inválido/i.test(e.message)) store.delete(ONBOARDING_KEY);
        return false;
      }
    })().finally(() => { migrating = null; });
    return migrating;
  }

  return {
    async list() {
      await migrateOnboarding();
      return publicView(read().gh);
    },
    addToken,
    migrateOnboarding,
    remove(id) {
      const { settings, gh } = read();
      gh.accounts = gh.accounts.filter((a) => a.id !== id);
      for (const [k, v] of Object.entries(gh.repoAccounts)) if (v === id) delete gh.repoAccounts[k];
      if (gh.defaultAccountId === id) gh.defaultAccountId = gh.accounts[0]?.id || null;
      store.delete(`github.${id}`);
      write(settings, gh);
      return publicView(gh);
    },
    setDefault(id) {
      const { settings, gh } = read();
      if (!gh.accounts.some((a) => a.id === id)) throw new Error('Conta não encontrada');
      gh.defaultAccountId = id;
      write(settings, gh);
      return publicView(gh);
    },
    assign(remoteKey, id) {
      if (!remoteKey) throw new Error('Este repositório não tem remote do GitHub.');
      const { settings, gh } = read();
      if (id == null) delete gh.repoAccounts[remoteKey];
      else {
        if (!gh.accounts.some((a) => a.id === id)) throw new Error('Conta não encontrada');
        gh.repoAccounts[remoteKey] = id;
      }
      write(settings, gh);
      return publicView(gh);
    },
    get(id) {
      return read().gh.accounts.find((a) => a.id === id) || null;
    },
    /** Só para uso no main. Nunca retornar ao renderer. */
    tokenFor(id) {
      if (!id) return null;
      return store.get(`github.${id}`);
    },
    /** Conta + token para uma URL de remote. Token só para github.com via https. */
    resolveForRemote(url) {
      const parsed = parseGithubRemote(url);
      if (!parsed) return { account: null, token: null, remoteKey: null, github: null };
      const remoteKey = normalizeRemote(url);
      const id = pickAccountForRepo(read().settings, remoteKey);
      const account = id ? read().gh.accounts.find((a) => a.id === id) : null;
      const token = account && parsed.https ? store.get(`github.${account.id}`) : null;
      return { account, token, remoteKey, github: parsed };
    },
    pickDefault() {
      const { settings, gh } = read();
      const id = pickAccountForRepo(settings, null) || gh.accounts[0]?.id || null;
      return id ? gh.accounts.find((a) => a.id === id) : null;
    },
  };
}

module.exports = {
  normalizeRemote,
  parseGithubRemote,
  validateToken,
  pickAccountForRepo,
  createAccountsService,
  fetchAvatarData,
  ONBOARDING_KEY,
};
