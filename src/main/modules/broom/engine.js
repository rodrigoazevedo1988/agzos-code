/**
 * Motor da Vassoura no main: lê arquivos, consulta o cache e delega a análise ao
 * worker dos módulos (typescript nunca é carregado no main). Compartilhado pelo IPC
 * (ipc/broom.js) e pela ferramenta `clean_code` do agente.
 */

const fs = require('fs');
const path = require('path');
const { normalizeModules } = require('../../lib/settings');
const { createAnalysisCache, cacheKey, rulesHash } = require('./cache');
const { applyEdits } = require('./apply');

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const LIMITS = { maxFiles: 5000, maxBytes: 1024 * 1024, chunk: 50 };
const RULES = ['console', 'comments', 'unusedImports', 'deadCode'];

const isSupported = (p) => SUPPORTED_EXTENSIONS.includes(path.extname(String(p)).toLowerCase());

function abortError() {
  const err = new Error('Operação cancelada');
  err.name = 'AbortError';
  return err;
}

/** Opções de análise a partir de settings.modules.broom (com override de regras). */
function optionsFromSettings(settings, ruleOverride) {
  const broom = normalizeModules(settings?.modules).broom;
  const rules = { ...broom.rules };
  if (ruleOverride && typeof ruleOverride === 'object') {
    for (const r of RULES) if (typeof ruleOverride[r] === 'boolean') rules[r] = ruleOverride[r];
  }
  return { enabled: broom.enabled, rules, keepConsole: broom.keepConsole, keepComments: broom.keepComments };
}

function countByRule(edits) {
  const byRule = { console: 0, comments: 0, unusedImports: 0, deadCode: 0 };
  for (const e of edits) if (Object.hasOwn(byRule, e.rule)) byRule[e.rule]++;
  return byRule;
}

/** Resumo enviado ao renderer: { count, byRule, edits, error? }. */
function summarize(result) {
  const edits = Array.isArray(result?.edits) ? result.edits : [];
  const out = { count: edits.length, byRule: countByRule(edits), edits };
  if (result?.error) out.error = result.error;
  return out;
}

function createBroomEngine({ workerHost, cache = createAnalysisCache({ max: 200 }), limits = LIMITS }) {
  const workerOptions = (o) => ({ rules: o.rules, keepConsole: o.keepConsole, keepComments: o.keepComments });

  async function readForAnalysis(abs) {
    const st = await fs.promises.stat(abs);
    if (!st.isFile()) throw new Error(`Não é um arquivo: ${abs}`);
    if (st.size > limits.maxBytes) return { st, text: null, tooLarge: true };
    const text = await fs.promises.readFile(abs, 'utf8');
    return { st, text };
  }

  /** Analisa um arquivo (cache por path+mtime+size+regras). → { text, result } */
  async function analyzeFile(abs, options, { signal } = {}) {
    if (!isSupported(abs)) return { text: null, result: { edits: [] } };
    const { st, text, tooLarge } = await readForAnalysis(abs);
    if (tooLarge) return { text: null, result: { edits: [], error: 'Arquivo maior que 1 MB; ignorado' } };
    const key = cacheKey(abs, st, rulesHash(options));
    let result = cache.get(key);
    if (!result) {
      result = await workerHost.call('broom.analyze', { path: abs, text, options: workerOptions(options) }, { signal });
      cache.set(key, result);
    }
    return { text, result };
  }

  /** Lista os arquivos analisáveis da raiz no worker (ignorados, 1 MB, máx. maxFiles). */
  function listFiles(root, { signal } = {}) {
    return workerHost.call('broom.listFiles', {
      root,
      ignoredDirs: [...IGNORED_DIRS],
      extensions: SUPPORTED_EXTENSIONS,
      maxFiles: limits.maxFiles,
      maxBytes: limits.maxBytes,
    }, { signal });
  }

  /**
   * Varre a raiz. onProgress({ done, total, path }). Cancelável por signal: devolve o
   * parcial com cancelled: true. O worker lê os arquivos (sem I/O pesado no main).
   * → { files: [{ path, count, byRule }], truncated, cancelled }
   */
  async function scan(root, options, { signal, onProgress = () => {} } = {}) {
    const found = [];
    let truncated = false;
    let cancelled = false;
    try {
      const listed = await listFiles(root, { signal });
      truncated = listed.truncated;
      const total = listed.files.length;
      const hash = rulesHash(options);
      let done = 0;
      for (let i = 0; i < listed.files.length; i += limits.chunk) {
        if (signal?.aborted) throw abortError();
        const chunk = listed.files.slice(i, i + limits.chunk);
        const results = new Map();
        const pending = [];
        for (const f of chunk) {
          const cached = cache.get(cacheKey(f.path, f, hash));
          if (cached) results.set(f.path, cached);
          else pending.push(f.path);
        }
        if (pending.length) {
          const out = await workerHost.call('broom.analyzeMany', {
            files: pending.map((p) => ({ path: p })),
            options: workerOptions(options),
            maxBytes: limits.maxBytes,
          }, { signal });
          for (const r of out) {
            if (r.skipped) continue;
            const result = { edits: r.edits || [], ...(r.error ? { error: r.error } : {}) };
            if (r.mtimeMs !== undefined && !r.error) cache.set(cacheKey(r.path, r, hash), result);
            results.set(r.path, result);
          }
        }
        for (const f of chunk) {
          const r = results.get(f.path);
          if (r && r.edits.length) {
            const s = summarize(r);
            found.push({ path: f.path, count: s.count, byRule: s.byRule });
          }
        }
        done += chunk.length;
        onProgress({ done, total, path: chunk[chunk.length - 1].path });
      }
    } catch (err) {
      if (err?.name !== 'AbortError') throw err;
      cancelled = true;
    }
    return { files: found, truncated, cancelled };
  }

  /** Calcula a limpeza de um arquivo sem gravar. → { text, after, edits, error? } */
  async function plan(abs, options, { editIds, signal } = {}) {
    const { text, result } = await analyzeFile(abs, options, { signal });
    let edits = result.edits || [];
    if (Array.isArray(editIds)) {
      const wanted = new Set(editIds.map(String));
      edits = edits.filter((e) => wanted.has(e.id));
    }
    if (!text || !edits.length) return { text, after: text, edits: [], error: result.error };
    return { text, after: applyEdits(text, edits), edits, error: result.error };
  }

  /** Grava o resultado se o arquivo não mudou desde a leitura. */
  async function write(abs, before, after) {
    const current = await fs.promises.readFile(abs, 'utf8');
    if (current !== before) throw new Error(`${path.basename(abs)} mudou durante a limpeza; tente de novo`);
    await fs.promises.writeFile(abs, after, 'utf8');
    cache.invalidate(abs);
  }

  return { analyzeFile, listFiles, scan, plan, write, cache, invalidate: (p) => cache.invalidate(p) };
}

// Instância usada pela ferramenta do agente (registrada por ipc/broom.js no main),
// com o leitor das Configurações (regras e listas de "manter").
let defaultEngine = null;
let defaultGetSettings = () => ({});
const setDefaultEngine = (engine, getSettings) => {
  defaultEngine = engine || null;
  defaultGetSettings = typeof getSettings === 'function' ? getSettings : () => ({});
};
const getDefaultEngine = () => defaultEngine;
const getDefaultSettings = () => defaultGetSettings();

module.exports = {
  createBroomEngine, optionsFromSettings, summarize, countByRule, isSupported,
  setDefaultEngine, getDefaultEngine, getDefaultSettings, SUPPORTED_EXTENSIONS, IGNORED_DIRS, LIMITS,
};
