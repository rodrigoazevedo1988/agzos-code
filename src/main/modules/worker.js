/**
 * Processo utilitário dos módulos nativos (utilityProcess, criado sob demanda por
 * worker-host.js no main). Trabalho pesado de CPU (AST etc.) roda aqui.
 * Cada handler recebe (params, signal) — ver serveWorker em worker-host.js.
 */

const fs = require('fs');
const nodePath = require('path');
const { serveWorker } = require('./worker-host');

// typescript só é carregado aqui (na primeira análise), nunca no main.
let broomAnalyze = null;
function analyzeBroom(filePath, text, options) {
  if (!broomAnalyze) broomAnalyze = require('./broom/analyze').analyze;
  return broomAnalyze(text, { ...(options || {}), fileName: filePath });
}

function abortError() {
  const err = new Error('Operação cancelada');
  err.name = 'AbortError';
  return err;
}

const yieldLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Lista arquivos analisáveis a partir de uma raiz já validada pelo main (path-guard).
 * Não segue links simbólicos. → { files: [{ path, mtimeMs, size }], truncated }
 */
async function listFiles({ root, ignoredDirs = [], extensions = [], maxFiles = 5000, maxBytes = 1024 * 1024 } = {}, signal) {
  const ignored = new Set(ignoredDirs);
  const exts = new Set(extensions);
  const files = [];
  let truncated = false;
  const stack = [root];
  let visited = 0;
  while (stack.length && !truncated) {
    if (++visited % 50 === 0) await yieldLoop();
    if (signal && signal.aborted) throw abortError();
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const subdirs = [];
    for (const d of entries) {
      const full = nodePath.join(dir, d.name);
      if (d.isDirectory()) {
        if (!ignored.has(d.name)) subdirs.push(full);
        continue;
      }
      if (!d.isFile() || !exts.has(nodePath.extname(d.name).toLowerCase())) continue;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.size > maxBytes) continue;
      if (files.length >= maxFiles) { truncated = true; break; }
      files.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
    }
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]);
  }
  return { files, truncated };
}

/** Lê o arquivo aqui quando o main não mandou o texto (evita I/O no processo principal). */
function readEntry(file, maxBytes) {
  if (typeof file.text === 'string') return { text: file.text };
  const st = fs.statSync(file.path);
  if (!st.isFile() || st.size > maxBytes) return { text: null, mtimeMs: st.mtimeMs, size: st.size };
  return { text: fs.readFileSync(file.path, 'utf8'), mtimeMs: st.mtimeMs, size: st.size };
}

const handlers = {
  // broom.* — Vassoura de Produção
  'broom.analyze': ({ path, text, options } = {}) => analyzeBroom(path, text, options),
  // files: [{ path, text? }] — sem text, o worker lê o arquivo (até maxBytes).
  'broom.analyzeMany': async ({ files, options, maxBytes = 1024 * 1024 } = {}, signal) => {
    const out = [];
    for (const file of Array.isArray(files) ? files : []) {
      // Cede o loop entre arquivos para receber o pedido de cancelamento.
      await yieldLoop();
      if (signal && signal.aborted) throw abortError();
      try {
        const { text, mtimeMs, size } = readEntry(file, maxBytes);
        const stat = mtimeMs !== undefined ? { mtimeMs, size } : {};
        if (text === null) out.push({ path: file.path, edits: [], skipped: true, ...stat });
        else out.push({ path: file.path, ...stat, ...analyzeBroom(file.path, text, options) });
      } catch (err) {
        out.push({ path: file.path, edits: [], error: (err && err.message) || String(err) });
      }
    }
    return out;
  },
  'broom.listFiles': listFiles,
  // formatter.* — Agzos Formatador (prettier embutido; nunca código do projeto)
  'formatter.format': (params) => require('./formatter/worker').format(params),
};

serveWorker(handlers);
