/**
 * Cliente mínimo da API REST do GitHub. Sem dependência do Electron.
 * O token só existe no main; nunca é logado.
 */

const DEFAULT_API = 'https://api.github.com';

/** Base da API. AGZOS_GITHUB_API só vale em testes (AGZOS_TEST=1). */
function apiBase(env = process.env) {
  if (env.AGZOS_TEST === '1' && env.AGZOS_GITHUB_API) return env.AGZOS_GITHUB_API.replace(/\/+$/, '');
  return DEFAULT_API;
}

class GitHubError extends Error {
  constructor(message, { status = 0, kind = 'api' } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.kind = kind;
  }
}

function errorFromResponse(status, body, { login } = {}) {
  const apiMsg = body?.message || '';
  const details = Array.isArray(body?.errors)
    ? body.errors.map((e) => e.message || [e.field, e.code].filter(Boolean).join(' ')).filter(Boolean).join('; ')
    : '';
  if (status === 401) {
    return new GitHubError(login
      ? `Token da conta ${login} inválido. Atualize em Configurações → Git & GitHub.`
      : 'Token inválido ou expirado', { status, kind: 'auth' });
  }
  if (status === 403 && /rate limit/i.test(apiMsg)) return new GitHubError('Limite de requisições do GitHub atingido. Tente mais tarde.', { status, kind: 'rate' });
  if (status === 403) return new GitHubError(`Sem permissão no GitHub: ${apiMsg || 'verifique os escopos do token (repo).'}`, { status, kind: 'forbidden' });
  if (status === 404) return new GitHubError('Não encontrado no GitHub (repositório ou permissão).', { status, kind: 'not-found' });
  if (status === 422) return new GitHubError(details || apiMsg || 'Dados recusados pelo GitHub.', { status, kind: 'validation' });
  return new GitHubError(`GitHub respondeu ${status}${apiMsg ? `: ${apiMsg}` : ''}`, { status });
}

function createGitHubApi({ token, login, fetchImpl = globalThis.fetch, base = apiBase(), timeoutMs = 20_000 } = {}) {
  async function request(method, urlPath, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${base}${urlPath}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Agzos-Code',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new GitHubError(e.name === 'AbortError' ? 'O GitHub não respondeu a tempo.' : 'Sem conexão com o GitHub.', { kind: 'network' });
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    const text = await res.text().catch(() => '');
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw errorFromResponse(res.status, data, { login });
    return data;
  }

  return {
    request,
    getUser: () => request('GET', '/user'),
    listOrgs: () => request('GET', '/user/orgs?per_page=100'),
    getRepo: (owner, repo) => request('GET', `/repos/${enc(owner)}/${enc(repo)}`),
    createRepo: ({ name, private: isPrivate = true, description = '', org } = {}) => request(
      'POST',
      org ? `/orgs/${enc(org)}/repos` : '/user/repos',
      { name, private: !!isPrivate, description: description || undefined, auto_init: false },
    ),
    createPullRequest: ({ owner, repo, head, base: baseBranch, title, body, draft = false }) => request(
      'POST',
      `/repos/${enc(owner)}/${enc(repo)}/pulls`,
      { head, base: baseBranch, title, body: body || undefined, draft: !!draft },
    ),
  };
}

function enc(s) { return encodeURIComponent(String(s)); }

module.exports = { createGitHubApi, apiBase, GitHubError, errorFromResponse, DEFAULT_API };
