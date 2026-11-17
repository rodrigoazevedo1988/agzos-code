/**
 * Agzos Árvore — gera a árvore de uma pasta em texto (`├──`, `└──`, `│`).
 *
 * generateTree(root, { depth, gitignore, dirsOnly, hidden, max }, source?) →
 *   Promise<{ text, count, truncated }>
 *   - depth: níveis abaixo da raiz (1..20, padrão 3)
 *   - gitignore: respeita `.gitignore` da raiz e das subpastas (padrão true; `.git` nunca entra)
 *   - dirsOnly: só pastas · hidden: inclui nomes começando com `.` (padrão false)
 *   - max: limite de entradas (1..5000, padrão 5000); passou → última linha avisa
 *   Pastas primeiro, depois arquivos, em ordem alfabética. Symlinks não são seguidos.
 *
 * Ponto de troca para pasta remota: `source` = { readDir(dir) → [{ name, isDirectory }],
 * readFile(path) → string|null, join(a, b), basename(p) }. Padrão: `localSource` (fs local).
 *
 * createIgnoreMatcher(text) → (relPath, isDir) → true (ignorado) | false (negado com !) | undefined.
 * Suporta comentários, `\#`, `!`, `/` no início (âncora), `/` no fim (só pasta), `*`, `?`, `**`, `[...]`.
 */

const fs = require('node:fs');
const path = require('node:path');

const LIMITS = { depthDefault: 3, depthMax: 20, maxEntries: 5000 };

const localSource = {
  async readDir(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    // Symlink conta como arquivo (não é seguido): evita laços e saída da pasta.
    return entries.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
  },
  async readFile(file) {
    try {
      const st = await fs.promises.stat(file);
      if (!st.isFile() || st.size > 256 * 1024) return null;
      return await fs.promises.readFile(file, 'utf8');
    } catch {
      return null;
    }
  },
  join: (a, b) => path.join(a, b),
  basename: (p) => path.basename(p),
};

/**
 * Fonte sobre um provider de workspace (pasta remota ssh://, workspace/provider-for.js).
 * Links no host são resolvidos pelo provider; o limite de profundidade/entradas segura laços.
 */
function providerSource(prov) {
  return {
    async readDir(dir) {
      return (await prov.readDir(dir)).map((e) => ({ name: e.name, isDirectory: !!e.isDirectory }));
    },
    async readFile(file) {
      try {
        const st = await prov.stat(file);
        if (!st.isFile || st.size > 256 * 1024) return null;
        return await prov.readFile(file, 'utf8');
      } catch {
        return null;
      }
    },
    join: (a, b) => prov.join(a, b),
    basename: (p) => path.posix.basename(p),
  };
}

/** Fonte certa para o caminho: ssh:// → provider da janela (sender ou contexto); senão local. */
function sourceFor(p, sender) {
  if (typeof p !== 'string' || !p.startsWith('ssh://')) return localSource;
  const { providerFor } = require('../../workspace/provider-for');
  return providerSource(providerFor(p, sender));
}

function escapeRegex(ch) {
  return /[.+^${}()|\\]/.test(ch) ? `\\${ch}` : ch;
}

/** Glob do .gitignore → corpo de regex (sem âncoras). */
function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        const slashBefore = i === 0 || glob[i - 1] === '/';
        if (slashBefore && slashAfter) { out += '(?:.*/)?'; i += 2; continue; }
        out += '.*';
        i += 1;
        continue;
      }
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) { out += '\\['; continue; }
      let cls = glob.slice(i + 1, end).replace(/\\/g, '\\\\');
      if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
      out += `[${cls}]`;
      i = end;
    } else if (ch === '\\' && i + 1 < glob.length) {
      out += escapeRegex(glob[i + 1]);
      i += 1;
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

function parseRule(line) {
  let s = line.replace(/\r$/, '');
  if (!s.trim() || s.startsWith('#')) return null;
  // Espaços no fim são ignorados (salvo escapados).
  s = s.replace(/(?<!\\)\s+$/, '');
  let negate = false;
  if (s.startsWith('!')) { negate = true; s = s.slice(1); }
  if (s.startsWith('\\#') || s.startsWith('\\!')) s = s.slice(1);
  let dirOnly = false;
  if (s.endsWith('/')) { dirOnly = true; s = s.slice(0, -1); }
  if (!s) return null;
  const anchored = s.includes('/');
  if (s.startsWith('/')) s = s.slice(1);
  const body = globToRegex(s);
  const re = new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`);
  return { negate, dirOnly, re };
}

function createIgnoreMatcher(text) {
  const rules = String(text || '').split('\n').map(parseRule).filter(Boolean);
  return (rel, isDir) => {
    let result;
    for (const r of rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(rel)) result = !r.negate;
    }
    return result;
  };
}

function intIn(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function normalizeOptions(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    depth: Math.min(LIMITS.depthMax, intIn(o.depth, 1, Infinity, LIMITS.depthDefault)),
    gitignore: o.gitignore !== false,
    dirsOnly: o.dirsOnly === true,
    hidden: o.hidden === true,
    max: Math.min(LIMITS.maxEntries, intIn(o.max, 1, Infinity, LIMITS.maxEntries)),
  };
}

async function generateTree(root, opts = {}, source = localSource) {
  const o = normalizeOptions(opts);
  const lines = [`${source.basename(root) || root}/`];
  let count = 0;
  let truncated = false;

  // matchers: [{ base: 'src/' relativo à raiz, match }] — mais profundos depois (última regra vence).
  async function matchersFor(dir, rel, parent) {
    if (!o.gitignore) return parent;
    const text = await source.readFile(source.join(dir, '.gitignore'));
    if (!text) return parent;
    return [...parent, { base: rel ? `${rel}/` : '', match: createIgnoreMatcher(text) }];
  }

  function ignored(matchers, rel, isDir) {
    let result = false;
    for (const m of matchers) {
      if (!rel.startsWith(m.base)) continue;
      const r = m.match(rel.slice(m.base.length), isDir);
      if (r !== undefined) result = r;
    }
    return result;
  }

  async function walk(dir, rel, prefix, level, parentMatchers) {
    let entries;
    try { entries = await source.readDir(dir); } catch { return; }
    const matchers = await matchersFor(dir, rel, parentMatchers);
    const visible = entries.filter((e) => {
      if (o.dirsOnly && !e.isDirectory) return false;
      if (!o.hidden && e.name.startsWith('.')) return false;
      if (o.gitignore && e.name === '.git') return false;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      return !(o.gitignore && ignored(matchers, childRel, e.isDirectory));
    });
    visible.sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name, 'pt-BR'));
    for (let i = 0; i < visible.length; i++) {
      if (count >= o.max) { truncated = true; return; }
      const e = visible[i];
      const last = i === visible.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}${e.isDirectory ? '/' : ''}`);
      count++;
      if (e.isDirectory && level < o.depth) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        await walk(source.join(dir, e.name), childRel, prefix + (last ? '    ' : '│   '), level + 1, matchers);
        if (truncated) return;
      }
    }
  }

  await walk(root, '', '', 1, []);
  if (truncated) lines.push(`… (limite de ${o.max} entradas atingido)`);
  return { text: lines.join('\n'), count, truncated };
}

module.exports = { generateTree, createIgnoreMatcher, normalizeOptions, localSource, providerSource, sourceFor, LIMITS };
