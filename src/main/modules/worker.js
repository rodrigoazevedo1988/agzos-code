/**
 * Processo utilitário dos módulos nativos (utilityProcess, criado sob demanda por
 * worker-host.js no main). Trabalho pesado de CPU (AST etc.) roda aqui.
 * Cada handler recebe (params, signal) — ver serveWorker em worker-host.js.
 */

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

const handlers = {
  // broom.* — Vassoura de Produção
  'broom.analyze': ({ path, text, options } = {}) => analyzeBroom(path, text, options),
  'broom.analyzeMany': async ({ files, options } = {}, signal) => {
    const out = [];
    for (const file of Array.isArray(files) ? files : []) {
      // Cede o loop entre arquivos para receber o pedido de cancelamento.
      await yieldLoop();
      if (signal && signal.aborted) throw abortError();
      try {
        out.push({ path: file.path, ...analyzeBroom(file.path, file.text, options) });
      } catch (err) {
        out.push({ path: file.path, edits: [], error: (err && err.message) || String(err) });
      }
    }
    return out;
  },
};

serveWorker(handlers);
