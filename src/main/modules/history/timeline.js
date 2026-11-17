/**
 * Linha do tempo de um arquivo (Agzos Git Slider): commits do git + histórico local.
 *
 * parseGitLog(text) → [{ sha, author, ts, message, path }]   (saída de gitLogArgs)
 * mergeTimeline(commits, local) → items em ordem de tempo (mais antiga primeiro):
 *   { versionId, kind: 'commit'|'local', ts, author?, message?, sha?, origin?, size? }
 * versionId: 'local:<id>' | 'git:<sha>:<caminho no repo naquele commit>'
 * buildTimeline(absPath, { store, runGitFor, maxCommits }) → { items, git, truncated }
 * readVersion(absPath, versionId, { store, runGitFor, cache, maxCommits, known }) → Buffer
 *   Versão git só é lida se fizer parte da linha do tempo DESTE arquivo (o renderer não
 *   escolhe outro caminho do repositório). `known` (Map path → Set de versionIds) evita
 *   rodar o git log de novo a cada leitura.
 * createLru({ maxBytes }) → cache de conteúdos (por janela, 50 MB no IPC).
 *
 * O git roda com cwd = pasta do arquivo e pathspec = nome do arquivo; os caminhos do
 * `--name-only` são relativos à raiz do repositório, como `git show <sha>:<caminho>` espera.
 */

const path = require('node:path');

// URIs ssh:// (pasta remota) usam path POSIX.
const pathMod = (p) => (String(p).startsWith('ssh://') ? path.posix : path);

const RS = '\x1e';
const US = '\x1f';
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LOCAL_RE = /^local:(\d{10,16}(?:-\d{1,4})?)$/;
const GIT_RE = /^git:([0-9a-f]{40}|[0-9a-f]{64}):(.+)$/s;

function gitLogArgs(pathspec, maxCommits) {
  return [
    '-c', 'core.quotePath=false', 'log', '--follow', '-n', String(maxCommits),
    `--format=${RS}%H${US}%an${US}%at${US}%s`, '--name-only', '--', pathspec,
  ];
}

function parseGitLog(text) {
  const out = [];
  for (const chunk of String(text || '').split(RS)) {
    if (!chunk.trim()) continue;
    const lines = chunk.split('\n');
    const [sha, author, at, ...rest] = lines[0].split(US);
    if (!SHA_RE.test(sha || '') || !/^\d+$/.test(at || '')) continue;
    const files = lines.slice(1).map((l) => l.replace(/\r$/, '')).filter(Boolean);
    if (!files.length) continue;
    out.push({ sha, author: author || '', ts: Number(at) * 1000, message: rest.join(US), path: files[files.length - 1] });
  }
  return out;
}

function mergeTimeline(commits, local) {
  const items = [];
  // git log vem do mais novo para o mais antigo; invertido, empates de segundo mantêm a ordem.
  for (const c of [...(commits || [])].reverse()) {
    items.push({
      versionId: `git:${c.sha}:${c.path}`, kind: 'commit', ts: c.ts,
      sha: c.sha, author: c.author, message: c.message,
    });
  }
  for (const e of local || []) {
    items.push({ versionId: `local:${e.id}`, kind: 'local', ts: e.ts, origin: e.origin, size: e.size });
  }
  return items.sort((a, b) => a.ts - b.ts || (a.kind === b.kind ? 0 : a.kind === 'commit' ? -1 : 1));
}

function parseVersionId(versionId) {
  if (typeof versionId === 'string') {
    const local = LOCAL_RE.exec(versionId);
    if (local) return { kind: 'local', id: local[1] };
    const g = GIT_RE.exec(versionId);
    if (g) {
      const rel = g[2];
      const parts = rel.split('/');
      if (!rel.startsWith('/') && !rel.includes('\0') && !rel.includes('\\') && !parts.includes('..') && !parts.includes('')) {
        return { kind: 'git', sha: g[1], rel };
      }
    }
  }
  throw new Error('Versão inválida');
}

async function gitCommits(absPath, { runGitFor, maxCommits }) {
  try {
    const { stdout } = await runGitFor(pathMod(absPath).dirname(absPath), gitLogArgs(pathMod(absPath).basename(absPath), maxCommits));
    return { git: true, commits: parseGitLog(stdout) };
  } catch {
    return { git: false, commits: [] };
  }
}

async function buildTimeline(absPath, { store, runGitFor, maxCommits = 200 }) {
  const { git, commits } = runGitFor ? await gitCommits(absPath, { runGitFor, maxCommits }) : { git: false, commits: [] };
  const local = store ? store.list(absPath) : [];
  return { items: mergeTimeline(commits, local), git, truncated: commits.length >= maxCommits };
}

async function readVersion(absPath, versionId, { store, runGitFor, cache, maxCommits = 200, known } = {}) {
  const v = parseVersionId(versionId);
  if (v.kind === 'local') {
    if (!store) throw new Error('Histórico local indisponível');
    return store.read(absPath, v.id);
  }
  const hit = cache?.get(versionId);
  if (hit) return hit;
  let ids = known?.get(absPath);
  if (!ids || !ids.has(versionId)) {
    const tl = await buildTimeline(absPath, { store: null, runGitFor, maxCommits });
    ids = new Set(tl.items.map((i) => i.versionId));
    known?.set(absPath, ids);
  }
  if (!ids.has(versionId)) throw new Error('Versão não encontrada na linha do tempo do arquivo');
  const { stdout } = await runGitFor(pathMod(absPath).dirname(absPath), ['show', `${v.sha}:${v.rel}`]);
  const buf = Buffer.from(stdout, 'utf8');
  cache?.set(versionId, buf);
  return buf;
}

function createLru({ maxBytes }) {
  const map = new Map();
  const lru = {
    bytes: 0,
    get(key) {
      const v = map.get(key);
      if (v === undefined) return undefined;
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, buf) {
      if (map.has(key)) { lru.bytes -= map.get(key).length; map.delete(key); }
      if (buf.length > maxBytes) return;
      map.set(key, buf);
      lru.bytes += buf.length;
      while (lru.bytes > maxBytes) {
        const [oldest, old] = map.entries().next().value;
        map.delete(oldest);
        lru.bytes -= old.length;
      }
    },
    clear() { map.clear(); lru.bytes = 0; },
  };
  return lru;
}

module.exports = {
  parseGitLog, mergeTimeline, parseVersionId, gitLogArgs, buildTimeline, readVersion, createLru,
};
