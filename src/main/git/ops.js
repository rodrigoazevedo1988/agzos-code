/**
 * Operações git de alto nível. Todas recebem `cwd` já validado pelo path guard
 * (ver ipc/git.js) e caminhos relativos à raiz do repositório (como no status).
 */

const fs = require('fs');
const path = require('path');
const { runGit, GitError, NETWORK_TIMEOUT_MS, CLONE_TIMEOUT_MS } = require('./run');
const { isRemote, joinAny, providerFor } = require('../workspace/provider-for');
const { getStatus, repoRoot, parseLog, parseBranches, parseRemotes, LOG_FORMAT, BRANCH_FORMAT } = require('./status');

const MAX_DIFF_BYTES = 2 * 1024 * 1024;

async function root(cwd, opts) {
  const r = await repoRoot(cwd, opts);
  if (!r) throw new GitError('Esta pasta não é um repositório Git.', { kind: 'not-repo' });
  return r;
}

/** Caminhos relativos, sem `..` escapando a raiz, nunca começando com '-'. */
function checkPaths(paths) {
  if (!Array.isArray(paths)) throw new GitError('Lista de arquivos inválida', { kind: 'invalid' });
  for (const p of paths) {
    if (typeof p !== 'string' || !p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) {
      throw new GitError(`Caminho inválido: ${p}`, { kind: 'invalid' });
    }
  }
  return paths;
}

/** Nome de branch seguro (validado também por `git check-ref-format`). */
async function checkBranchName(cwd, name, opts) {
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-')) {
    throw new GitError('Nome de branch inválido.', { kind: 'invalid' });
  }
  try {
    await runGit(cwd, ['check-ref-format', '--branch', name], opts);
  } catch {
    throw new GitError(`Nome de branch inválido: ${name}`, { kind: 'invalid' });
  }
  return name;
}

async function hasHead(cwd, opts) {
  try {
    await runGit(cwd, ['rev-parse', '--verify', '-q', 'HEAD'], opts);
    return true;
  } catch {
    return false;
  }
}

async function init(cwd, opts = {}) {
  try {
    await runGit(cwd, ['init', '--initial-branch=main'], opts);
  } catch (e) {
    if (e.kind === 'git-missing') throw e;
    await runGit(cwd, ['init'], opts); // git < 2.28
  }
  return true;
}

async function stage(cwd, paths = [], opts = {}) {
  const r = await root(cwd, opts);
  if (!paths.length) await runGit(r, ['add', '-A'], opts);
  else await runGit(r, ['--literal-pathspecs', 'add', '-A', '--', ...checkPaths(paths)], opts);
  return true;
}

async function unstage(cwd, paths = [], opts = {}) {
  const r = await root(cwd, opts);
  const list = paths.length ? ['--', ...checkPaths(paths)] : [];
  if (await hasHead(r, opts)) {
    await runGit(r, ['--literal-pathspecs', 'reset', '-q', 'HEAD', ...list], opts);
  } else {
    // Antes do primeiro commit não há HEAD: tira do índice.
    await runGit(r, ['--literal-pathspecs', 'rm', '--cached', '-r', '-q', ...(list.length ? list : ['--', '.'])], opts);
  }
  return true;
}

/** Descarta alterações do working tree. Arquivos não rastreados são apagados. */
async function discard(cwd, paths = [], opts = {}) {
  const r = await root(cwd, opts);
  const status = await getStatus(r, opts);
  const wanted = paths.length ? new Set(checkPaths(paths)) : null;
  const untracked = [];
  const tracked = [];
  for (const f of status.changes) {
    if (wanted && !wanted.has(f.path)) continue;
    if (f.untracked) untracked.push(f.path);
    else tracked.push(f.path);
  }
  if (tracked.length) await runGit(r, ['--literal-pathspecs', 'checkout', '--', ...tracked], opts);
  if (untracked.length) await runGit(r, ['--literal-pathspecs', 'clean', '-f', '-q', '--', ...untracked], opts);
  return { discarded: tracked.length + untracked.length };
}

/**
 * Commit. opts.identity = { name, email } é usado só se o git não tiver
 * identidade configurada (passa por -c, não grava no config).
 */
async function commit(cwd, message, { amend = false, identity, ...opts } = {}) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new GitError('Escreva uma mensagem de commit.', { kind: 'invalid' });
  }
  const r = await root(cwd, opts);
  const args = ['commit', '-m', message];
  if (amend) args.push('--amend');
  try {
    await runGit(r, args, opts);
  } catch (e) {
    if (e.kind !== 'identity' || !identity?.name || !identity?.email) throw e;
    await runGit(r, ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`, ...args], opts);
  }
  const { stdout } = await runGit(r, ['rev-parse', '--short', 'HEAD'], opts);
  return { hash: stdout.trim() };
}

async function log(cwd, { limit = 50, ...opts } = {}) {
  const r = await root(cwd, opts);
  if (!(await hasHead(r, opts))) return [];
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  const { stdout } = await runGit(r, ['log', `-n${n}`, `--format=${LOG_FORMAT}`, 'HEAD'], opts);
  return parseLog(stdout);
}

async function branches(cwd, opts = {}) {
  const r = await root(cwd, opts);
  const { stdout } = await runGit(r, ['for-each-ref', `--format=${BRANCH_FORMAT}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes'], opts);
  const parsed = parseBranches(stdout);
  if (!parsed.current) {
    // Repositório sem commits: for-each-ref não lista a branch atual.
    try {
      const { stdout: head } = await runGit(r, ['symbolic-ref', '--short', '-q', 'HEAD'], opts);
      parsed.current = head.trim() || null;
    } catch { /* detached */ }
  }
  return parsed;
}

/** Troca de branch. `origin/x` sem local correspondente → cria `x` rastreando. */
async function checkout(cwd, name, opts = {}) {
  const r = await root(cwd, opts);
  const list = await branches(r, opts);
  if (list.local.some((b) => b.name === name)) {
    await runGit(r, ['checkout', await checkBranchName(r, name, opts), '--'], opts);
    return { branch: name };
  }
  const remote = list.remote.find((b) => b.name === name);
  if (remote) {
    const local = name.split('/').slice(1).join('/');
    await checkBranchName(r, local, opts);
    if (list.local.some((b) => b.name === local)) {
      await runGit(r, ['checkout', local, '--'], opts);
    } else {
      await runGit(r, ['checkout', '-b', local, '--track', name], opts);
    }
    return { branch: local };
  }
  throw new GitError(`Branch não encontrada: ${name}`, { kind: 'invalid' });
}

async function createBranch(cwd, name, { checkout: doCheckout = true, ...opts } = {}) {
  const r = await root(cwd, opts);
  await checkBranchName(r, name, opts);
  if (doCheckout) await runGit(r, ['checkout', '-b', name], opts);
  else await runGit(r, ['branch', name], opts);
  return { branch: name };
}

async function remotes(cwd, opts = {}) {
  const r = await root(cwd, opts);
  const { stdout } = await runGit(r, ['remote', '-v'], opts);
  return parseRemotes(stdout);
}

/** Remote usado pela branch atual (upstream) ou `origin` ou o primeiro. */
async function currentRemote(cwd, opts = {}) {
  const r = await root(cwd, opts);
  const list = await remotes(r, opts);
  if (!list.length) return null;
  try {
    const { stdout } = await runGit(r, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], opts);
    const name = stdout.trim().split('/')[0];
    const hit = list.find((x) => x.name === name);
    if (hit) return hit;
  } catch { /* sem upstream */ }
  return list.find((x) => x.name === 'origin') || list[0];
}

async function addRemote(cwd, name, url, opts = {}) {
  const r = await root(cwd, opts);
  if (!/^[\w.-]+$/.test(name)) throw new GitError('Nome de remote inválido.', { kind: 'invalid' });
  if (typeof url !== 'string' || !url || url.startsWith('-')) throw new GitError('URL de remote inválida.', { kind: 'invalid' });
  await runGit(r, ['remote', 'add', name, url], opts);
  return true;
}

async function fetch(cwd, opts = {}) {
  const r = await root(cwd, opts);
  await runGit(r, ['fetch', '--prune'], { timeoutMs: NETWORK_TIMEOUT_MS, ...opts });
  return true;
}

async function pull(cwd, opts = {}) {
  const r = await root(cwd, opts);
  await runGit(r, ['pull', '--ff-only'], { timeoutMs: NETWORK_TIMEOUT_MS, ...opts });
  return true;
}

/** Push da branch atual. Sem upstream → `push -u <remote> HEAD`. */
async function push(cwd, { remote, ...opts } = {}) {
  const r = await root(cwd, opts);
  const st = await getStatus(r, opts);
  if (!st.branch) throw new GitError('HEAD destacado: crie ou troque para uma branch antes do push.', { kind: 'invalid' });
  if (!st.remotes.length) throw new GitError('Este repositório não tem remote. Use "Publicar no GitHub".', { kind: 'no-remote' });
  const netOpts = { timeoutMs: NETWORK_TIMEOUT_MS, ...opts };
  if (st.upstream && !remote) {
    await runGit(r, ['push'], netOpts);
  } else {
    const name = remote || (st.remotes.find((x) => x.name === 'origin') || st.remotes[0]).name;
    await runGit(r, ['push', '-u', name, 'HEAD'], netOpts);
  }
  return true;
}

/** Sincronizar: pull (se houver upstream) e push. */
async function sync(cwd, opts = {}) {
  const r = await root(cwd, opts);
  const st = await getStatus(r, opts);
  if (st.upstream) await pull(r, opts);
  await push(r, opts);
  return true;
}

/** Nome da pasta destino a partir da URL (`.../repo.git` → `repo`). */
function repoNameFromUrl(url) {
  const clean = String(url || '').trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  const name = clean.split(/[\\/:]/).pop() || '';
  return name.replace(/[^\w.-]/g, '-').replace(/^[.-]+/, '') || 'repo';
}

/** Valida URL de clone: https, ssh (git@host:org/repo), file/caminho local. */
function checkCloneUrl(url) {
  const u = String(url || '').trim();
  if (!u || u.startsWith('-') || /\s/.test(u)) throw new GitError('URL de repositório inválida.', { kind: 'invalid' });
  if (/^(https?|ssh|git|file):\/\//i.test(u)) return u;
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(u)) return u; // scp-like
  if (path.isAbsolute(u)) return u;
  throw new GitError('URL de repositório inválida. Use https://, ssh:// ou git@host:org/repo.git', { kind: 'invalid' });
}

/** Parse do progresso do `git clone --progress`. */
function parseProgress(chunk) {
  const lines = String(chunk).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  const m = last.match(/^(?:remote: )?([A-Za-z ]+):\s+(\d+)%/);
  if (!m) return { text: last };
  const phase = m[1].trim();
  const pct = Number(m[2]);
  // Peso aproximado por fase para uma barra única.
  const weights = { 'Counting objects': [0, 5], 'Compressing objects': [5, 10], 'Receiving objects': [10, 80], 'Resolving deltas': [80, 95], 'Updating files': [95, 100] };
  const [a, b] = weights[phase] || [0, 100];
  return { phase, percent: Math.round(a + ((b - a) * pct) / 100), text: last };
}

/** Clona `url` em `<parentDir>/<nome>`. → { path } */
async function clone(url, parentDir, { name, onProgress, ...opts } = {}) {
  const u = checkCloneUrl(url);
  const folder = (name && String(name).trim()) || repoNameFromUrl(u);
  if (folder.includes('/') || folder.includes('\\') || folder === '..' || folder.startsWith('-')) {
    throw new GitError('Nome de pasta inválido.', { kind: 'invalid' });
  }
  const dest = joinAny(parentDir, folder);
  if (isRemote(dest)) {
    const prov = providerFor(dest);
    if (await prov.exists(dest) && (await prov.readDir(dest)).length) {
      throw new GitError(`A pasta ${folder} já existe e não está vazia.`, { kind: 'dest-exists' });
    }
  } else if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
    throw new GitError(`A pasta ${folder} já existe e não está vazia.`, { kind: 'dest-exists' });
  }
  // Remoto: o destino vai como caminho do host (o token não vai, ver git/run.js).
  const destArg = isRemote(dest) ? providerFor(dest).pathOf(dest) : dest;
  await runGit(parentDir, ['clone', '--progress', '--', u, destArg], {
    timeoutMs: CLONE_TIMEOUT_MS,
    ...opts,
    onStderr: onProgress ? (chunk) => { const p = parseProgress(chunk); if (p) onProgress(p); } : undefined,
  });
  return { path: dest };
}

/**
 * Conteúdos para o diff de um arquivo.
 *  staged=false → HEAD ↔ working tree
 *  staged=true  → HEAD ↔ índice
 * → { original, modified, binary, tooLarge }
 */
async function diffFile(cwd, relPath, { staged = false, origPath, ...opts } = {}) {
  const r = await root(cwd, opts);
  checkPaths([relPath]);
  if (origPath) checkPaths([origPath]);
  const head = await hasHead(r, opts);
  const showBlob = async (spec) => {
    try {
      const { stdout } = await runGit(r, ['show', spec], opts);
      return stdout;
    } catch { return ''; }
  };
  const original = head ? await showBlob(`HEAD:${origPath || relPath}`) : '';
  let modified = '';
  if (staged) {
    modified = await showBlob(`:${relPath}`);
  } else if (isRemote(r)) {
    // Pasta remota: lê o arquivo do working tree pelo provider (SFTP).
    const abs = joinAny(r, relPath);
    try {
      const prov = providerFor(abs);
      const st = await prov.stat(abs);
      if (st.size > MAX_DIFF_BYTES) return { original: '', modified: '', binary: false, tooLarge: true };
      modified = await prov.readFile(abs, 'utf-8');
    } catch { modified = ''; }
  } else {
    const abs = path.join(r, relPath);
    try {
      const st = fs.statSync(abs);
      if (st.size > MAX_DIFF_BYTES) return { original: '', modified: '', binary: false, tooLarge: true };
      modified = fs.readFileSync(abs, 'utf-8');
    } catch { modified = ''; }
  }
  const binary = original.includes('\0') || modified.includes('\0');
  const tooLarge = original.length > MAX_DIFF_BYTES || modified.length > MAX_DIFF_BYTES;
  if (binary || tooLarge) return { original: '', modified: '', binary, tooLarge };
  return { original, modified, binary: false, tooLarge: false };
}

module.exports = {
  init,
  stage,
  unstage,
  discard,
  commit,
  log,
  branches,
  checkout,
  createBranch,
  remotes,
  currentRemote,
  addRemote,
  fetch,
  pull,
  push,
  sync,
  clone,
  diffFile,
  hasHead,
  repoNameFromUrl,
  checkCloneUrl,
  parseProgress,
  checkPaths,
};
