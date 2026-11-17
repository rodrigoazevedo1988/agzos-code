'use strict';
// Plugin de resolução do Sandbox (spike). Funciona com esbuild nativo e esbuild-wasm.
//
// Modo 'fs'      : esbuild tem acesso ao disco (Node). O plugin só trata aliases do
//                  tsconfig e os módulos next/*; o resto o esbuild resolve sozinho.
// Modo 'virtual' : esbuild-wasm no browser (sem fs). O plugin resolve TUDO (relativos,
//                  aliases, node_modules via package.json) e carrega o conteúdo através de
//                  io.readFile (no app real: IPC para o main, preso à raiz do projeto).
//
// io = { readFile(absPath) -> Promise<string|null>, join, dirname } (posix).

const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'];
const LOADERS = { '.tsx': 'tsx', '.ts': 'ts', '.jsx': 'jsx', '.js': 'jsx', '.mjs': 'js', '.cjs': 'js', '.json': 'json', '.css': 'css' };
const NEXT_SHIMS = ['next/link', 'next/image', 'next/router', 'next/navigation', 'next/head', 'next/dynamic'];

// tsconfig é JSONC: tira comentários e vírgulas finais.
function parseJsonc(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function posix() {
  const join = (...p) => normalize(p.join('/'));
  const normalize = (p) => {
    const abs = p.startsWith('/');
    const parts = [];
    for (const s of p.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') parts.pop();
      else parts.push(s);
    }
    return (abs ? '/' : '') + parts.join('/');
  };
  const dirname = (p) => normalize(p).replace(/\/[^/]*$/, '') || '/';
  const extname = (p) => (p.match(/\.[^./]+$/) || [''])[0];
  return { join, dirname, extname, normalize };
}

async function loadTsconfigPaths(projectRoot, io) {
  const P = posix();
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const raw = await io.readFile(P.join(projectRoot, name));
    if (raw == null) continue;
    const cfg = parseJsonc(raw);
    const co = cfg.compilerOptions || {};
    const base = P.join(projectRoot, co.baseUrl || '.');
    const rules = Object.entries(co.paths || {}).map(([pattern, targets]) => {
      const star = pattern.indexOf('*');
      return {
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? '' : pattern.slice(star + 1),
        wildcard: star >= 0,
        targets: targets.map((t) => P.join(base, t)),
      };
    });
    // TS: o padrão com prefixo mais longo vence.
    rules.sort((a, b) => b.prefix.length - a.prefix.length);
    return { base, rules, file: name };
  }
  return { base: projectRoot, rules: [], file: null };
}

function createSandboxPlugin({ projectRoot, shimsDir, mode, io, stats }) {
  const P = posix();
  const cache = new Map(); // path -> conteúdo|null
  const read = async (p) => {
    if (cache.has(p)) return cache.get(p);
    const v = await io.readFile(p);
    cache.set(p, v);
    if (stats) stats.reads++;
    return v;
  };

  async function tryFile(base) {
    if (P.extname(base) && (await read(base)) != null) return base;
    for (const e of EXTS) if ((await read(base + e)) != null) return base + e;
    for (const e of EXTS) if ((await read(base + '/index' + e)) != null) return base + '/index' + e;
    return null;
  }

  function pickExport(entry, conds) {
    if (typeof entry === 'string') return entry;
    if (Array.isArray(entry)) return pickExport(entry[0], conds);
    if (entry && typeof entry === 'object') {
      for (const [k, v] of Object.entries(entry)) {
        if (k === 'default' || conds.includes(k)) {
          const r = pickExport(v, conds);
          if (r) return r;
        }
      }
    }
    return null;
  }

  async function resolveBare(spec, fromDir) {
    const parts = spec.split('/');
    const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const sub = '.' + spec.slice(pkgName.length); // '.', './jsx-runtime'
    let dir = fromDir;
    for (;;) {
      const pkgDir = P.join(dir, 'node_modules', pkgName);
      const pjRaw = await read(P.join(pkgDir, 'package.json'));
      if (pjRaw != null) {
        const pj = JSON.parse(pjRaw);
        const conds = ['browser', 'import', 'module', 'development'];
        if (pj.exports) {
          const ex = typeof pj.exports === 'string' || pj.exports['.'] === undefined && sub === '.' && !Object.keys(pj.exports).some((k) => k.startsWith('.'))
            ? { '.': pj.exports }
            : pj.exports;
          const target = pickExport(ex[sub], conds);
          if (target) return tryFile(P.join(pkgDir, target));
        }
        if (sub === '.') {
          const main = (typeof pj.browser === 'string' && pj.browser) || pj.module || pj.main || 'index.js';
          return tryFile(P.join(pkgDir, main));
        }
        return tryFile(P.join(pkgDir, sub));
      }
      if (dir === '/' || dir === projectRoot + '/..') return null;
      dir = P.dirname(dir);
    }
  }

  return {
    name: 'agzos-sandbox',
    async setup(build) {
      const ts = await loadTsconfigPaths(projectRoot, { readFile: read });
      if (stats) stats.tsconfig = ts.file;

      // 1) next/* -> shims
      build.onResolve({ filter: /^next\/(link|image|router|navigation|head|dynamic)$/ }, (args) => ({
        path: P.join(shimsDir, args.path.slice(5) + '.js'),
        namespace: mode === 'virtual' ? 'vfs' : 'file',
      }));

      // 2) aliases do tsconfig (paths)
      if (ts.rules.length) {
        build.onResolve({ filter: /^[^./]/ }, async (args) => {
          for (const r of ts.rules) {
            const hit = r.wildcard
              ? args.path.startsWith(r.prefix) && args.path.endsWith(r.suffix)
              : args.path === r.prefix;
            if (!hit) continue;
            const mid = r.wildcard ? args.path.slice(r.prefix.length, args.path.length - r.suffix.length) : '';
            for (const t of r.targets) {
              const p = await tryFile(t.replace('*', mid));
              if (p) {
                if (stats) stats.aliasHits.push(`${args.path} -> ${p.slice(projectRoot.length + 1)}`);
                return { path: p, namespace: mode === 'virtual' ? 'vfs' : 'file' };
              }
            }
          }
          return undefined;
        });
      }

      if (mode !== 'virtual') {
        // Shims moram fora do projeto: 'react' importado por eles deve vir do projeto do usuário
        // (uma única cópia de React), não de onde o shim está.
        build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, async (args) => {
          if (!args.importer.startsWith(shimsDir)) return undefined;
          const r = await build.resolve(args.path, { kind: args.kind, resolveDir: projectRoot });
          return r.errors.length ? undefined : { path: r.path };
        });
        return;
      }

      // 3) modo virtual: relativos e node_modules
      build.onResolve({ filter: /.*/ }, async (args) => {
        let fromDir = args.importer && args.importer.startsWith('/') ? P.dirname(args.importer) : args.resolveDir || projectRoot;
        if (fromDir.startsWith(shimsDir) && !args.path.startsWith('.')) fromDir = projectRoot; // idem: React do projeto
        if (args.path.startsWith('/') || args.path.startsWith('.')) {
          const p = await tryFile(args.path.startsWith('/') ? args.path : P.join(fromDir, args.path));
          if (p) return { path: p, namespace: 'vfs' };
          return { errors: [{ text: `não encontrado: ${args.path}` }] };
        }
        const p = await resolveBare(args.path, fromDir);
        if (p) {
          if (stats) stats.nodeModules.add(args.path);
          return { path: p, namespace: 'vfs' };
        }
        return { errors: [{ text: `pacote não encontrado: ${args.path}` }] };
      });

      build.onLoad({ filter: /.*/, namespace: 'vfs' }, async (args) => {
        const contents = await read(args.path);
        if (contents == null) return { errors: [{ text: `falha ao ler ${args.path}` }] };
        return { contents, loader: LOADERS[P.extname(args.path)] || 'js', resolveDir: P.dirname(args.path) };
      });
    },
  };
}

module.exports = { createSandboxPlugin, parseJsonc, loadTsconfigPaths, posix };
