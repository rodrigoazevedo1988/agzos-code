/**
 * Processo utilitário dos módulos nativos (utilityProcess, criado sob demanda por
 * worker-host.js no main). Trabalho pesado de CPU (AST etc.) roda aqui.
 * Cada handler recebe (params, signal) — ver serveWorker em worker-host.js.
 */

const { serveWorker } = require('./worker-host');

const handlers = {
  // broom.* — Vassoura de Produção (Agente V): broom.analyze, broom.analyzeMany
};

serveWorker(handlers);
