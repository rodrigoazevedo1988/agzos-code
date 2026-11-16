/**
 * Parsers da saída do git (puros, testáveis) + getStatus.
 */

const { runGit, redact } = require('./run');

const US = '\x1f'; // separador de campo
const RS = '\x1e'; // separador de registro

/**
 * Parser de `git status --porcelain=v2 --branch -z`.
 * → { branch, oid, upstream, ahead, behind, detached, initial, files: [...] }
 * file: { path, origPath?, index, worktree, untracked, conflicted, ignored, submodule }
 * `index`/`worktree` usam a letra do git ('.' = sem alteração).
 */
function parseStatusV2(output) {
  const out = {
    branch: null, oid: null, upstream: null, ahead: 0, behind: 0,
    detached: false, initial: false, files: [],
  };
  const parts = String(output || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const kind = entry[0];
    if (kind === '#') {
      const m = entry.match(/^# (branch\.\w+) (.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (key === 'branch.oid') {
        out.initial = value === '(initial)';
        out.oid = out.initial ? null : value;
      } else if (key === 'branch.head') {
        out.detached = value === '(detached)';
        out.branch = out.detached ? null : value;
      } else if (key === 'branch.upstream') {
        out.upstream = value;
      } else if (key === 'branch.ab') {
        const ab = value.match(/^\+(\d+) -(\d+)$/);
        if (ab) { out.ahead = Number(ab[1]); out.behind = Number(ab[2]); }
      }
    } else if (kind === '1') {
      // 1 XY sub mH mI mW hH hI path
      const f = splitFields(entry, 9);
      out.files.push(fileEntry(f[1], f[8], { submodule: f[2] !== 'N...' }));
    } else if (kind === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const f = splitFields(entry, 10);
      const origPath = parts[i + 1];
      i += 1;
      out.files.push(fileEntry(f[1], f[9], { origPath, submodule: f[2] !== 'N...' }));
    } else if (kind === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = splitFields(entry, 11);
      out.files.push({ ...fileEntry(f[1], f[10]), conflicted: true });
    } else if (kind === '?') {
      out.files.push({ path: entry.slice(2), index: '?', worktree: '?', untracked: true, conflicted: false, ignored: false, submodule: false });
    } else if (kind === '!') {
      out.files.push({ path: entry.slice(2), index: '!', worktree: '!', untracked: false, conflicted: false, ignored: true, submodule: false });
    }
  }
  return out;
}

/** Divide em `n` campos por espaço; o último fica com o resto (caminho pode ter espaços). */
function splitFields(entry, n) {
  const fields = [];
  let rest = entry;
  for (let k = 0; k < n - 1; k++) {
    const idx = rest.indexOf(' ');
    if (idx < 0) break;
    fields.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  fields.push(rest);
  return fields;
}

function fileEntry(xy, filePath, { origPath, submodule = false } = {}) {
  const e = {
    path: filePath,
    index: xy[0],
    worktree: xy[1],
    untracked: false,
    conflicted: false,
    ignored: false,
    submodule,
  };
  if (origPath) e.origPath = origPath;
  return e;
}

/** Separa a lista de arquivos nos grupos do painel. */
function groupFiles(files) {
  const staged = [];
  const changes = [];
  const conflicts = [];
  for (const f of files) {
    if (f.ignored) continue;
    if (f.conflicted) { conflicts.push(f); continue; }
    if (f.untracked) { changes.push({ ...f, status: 'U' }); continue; }
    if (f.index !== '.') staged.push({ ...f, status: f.index });
    if (f.worktree !== '.') changes.push({ ...f, status: f.worktree });
  }
  return { staged, changes, conflicts };
}

/**
 * Parser de `git log --format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%D%x1f%s%x1e`.
 */
const LOG_FORMAT = ['%H', '%h', '%an', '%ae', '%at', '%P', '%D', '%s'].join('%x1f') + '%x1e';
function parseLog(output) {
  return String(output || '')
    .split(RS)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [hash, short, author, email, at, parents, refs, subject] = r.split(US);
      return {
        hash,
        short,
        author,
        email,
        date: Number(at) * 1000,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        subject: subject || '',
      };
    });
}

/**
 * Parser de `git for-each-ref --format=<BRANCH_FORMAT> refs/heads refs/remotes`.
 */
const BRANCH_FORMAT = ['%(refname)', '%(refname:short)', '%(HEAD)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:unix)', '%(objectname:short)'].join('%1f');
function parseBranches(output) {
  const result = { current: null, local: [], remote: [] };
  for (const line of String(output || '').split('\n')) {
    if (!line.trim()) continue;
    const [ref, name, head, upstream, track, date, oid] = line.split(US);
    if (ref.startsWith('refs/heads/')) {
      const { ahead, behind, gone } = parseTrack(track);
      const b = { name, current: head === '*', upstream: upstream || null, ahead, behind, gone, date: Number(date) * 1000 || 0, oid };
      if (b.current) result.current = name;
      result.local.push(b);
    } else if (ref.startsWith('refs/remotes/')) {
      if (ref.endsWith('/HEAD')) continue;
      result.remote.push({ name, date: Number(date) * 1000 || 0, oid });
    }
  }
  return result;
}

/** `[ahead 2, behind 1]` | `[gone]` | '' */
function parseTrack(track) {
  const t = String(track || '');
  const ahead = Number((t.match(/ahead (\d+)/) || [])[1] || 0);
  const behind = Number((t.match(/behind (\d+)/) || [])[1] || 0);
  return { ahead, behind, gone: /gone/.test(t) };
}

/** Parser de `git remote -v`. → [{ name, url }] (fetch). */
function parseRemotes(output) {
  const map = new Map();
  for (const line of String(output || '').split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (m && !map.has(m[1])) map.set(m[1], m[2]);
  }
  return [...map].map(([name, url]) => ({ name, url }));
}

/** → { root, prefix } | null. prefix = caminho de `cwd` relativo à raiz ('' ou 'sub/dir/'). */
async function repoInfo(cwd, opts) {
  try {
    const { stdout } = await runGit(cwd, ['rev-parse', '--show-toplevel', '--show-prefix'], opts);
    const [root, prefix = ''] = stdout.replace(/\r/g, '').split('\n');
    return { root: root.trim(), prefix: prefix.trim() };
  } catch (e) {
    if (e.kind === 'not-repo') return null;
    throw e;
  }
}

async function repoRoot(cwd, opts) {
  const info = await repoInfo(cwd, opts);
  return info ? info.root : null;
}

/** → status completo | { notRepo: true } */
async function getStatus(cwd, opts = {}) {
  const info = await repoInfo(cwd, opts);
  if (!info) return { notRepo: true };
  const { root, prefix } = info;
  const [st, rem] = await Promise.all([
    runGit(root, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], opts),
    runGit(root, ['remote', '-v'], opts).catch(() => ({ stdout: '' })),
  ]);
  const parsed = parseStatusV2(st.stdout);
  const groups = groupFiles(parsed.files);
  return {
    root,
    prefix,
    ...parsed,
    ...groups,
    remotes: parseRemotes(rem.stdout).map((r) => ({ ...r, url: redact(r.url) })),
    count: groups.staged.length + groups.changes.length + groups.conflicts.length,
  };
}

module.exports = {
  parseStatusV2,
  groupFiles,
  parseLog,
  parseBranches,
  parseTrack,
  parseRemotes,
  getStatus,
  repoRoot,
  repoInfo,
  LOG_FORMAT,
  BRANCH_FORMAT,
};
