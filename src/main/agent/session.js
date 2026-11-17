/**
 * Sessões do agente por janela: run / approve / cancel, sem dependência do Electron.
 */

const fs = require('fs');
const { runAgent, MODES } = require('./loop');
const { createToolbox } = require('./tools');
const { buildSystemPrompt } = require('./prompt');
const { pickShell } = require('./exec');
const { secretValues } = require('./text');
const winEnv = require('../lib/win-env');

/**
 * deps:
 *   getRoot(payload) → caminho absoluto da raiz liberada ou null
 *   getProvider(payload) → { provider, model, apiKey } (lança Error com code em falha)
 *   getMode() → modo salvo nas settings
 *   checkpoints: createCheckpointStore(...)
 *   send(requestId, evt)
 */
function createAgentSessions({
  getRoot, getProvider, getMode = () => 'edit', checkpoints, send,
  platform = process.platform, getEnv = () => winEnv.freshEnv({ platform }),
  runCommand, shell, maxSteps,
}) {
  const active = new Map(); // requestId → { controller, pending: Map(callId → { resolve, reject }) }
  const conversations = new Map(); // conversationId → Set(sessionKey)

  function allowSetFor(key) {
    if (!conversations.has(key)) conversations.set(key, new Set());
    return conversations.get(key);
  }

  function run(requestId, payload = {}) {
    if (typeof requestId !== 'string' || !requestId || active.has(requestId)) return false;
    const emit = (evt) => send(requestId, evt);
    const root = getRoot(payload);
    if (!root) {
      emit({ type: 'error', message: 'Abra uma pasta de projeto para usar o agente.', code: 'no_workspace' });
      return false;
    }
    let resolved;
    try {
      resolved = getProvider(payload);
    } catch (err) {
      emit({ type: 'error', message: err.userMessage || err.message, code: err.code || 'no_profile' });
      return false;
    }
    const mode = MODES.includes(payload.mode) ? payload.mode : (MODES.includes(getMode()) ? getMode() : 'edit');
    const controller = new AbortController();
    const session = { controller, pending: new Map() };
    active.set(requestId, session);

    const env = getEnv();
    const sh = shell || pickShell({ platform, env });
    const checkpoint = checkpoints.create({ root });
    const toolbox = createToolbox({
      root, checkpoint, platform, shell: sh, env, runCommand,
      secrets: secretValues(env, [resolved.apiKey]),
    });
    const conversationKey = typeof payload.conversationId === 'string' && payload.conversationId
      ? `c:${payload.conversationId}` : `r:${requestId}`;

    const requestApproval = (callId) => new Promise((resolve, reject) => {
      if (controller.signal.aborted) { reject(Object.assign(new Error('Interrompido'), { name: 'AbortError' })); return; }
      session.pending.set(callId, { resolve, reject });
    });

    const promise = (async () => {
      try {
        return await runAgent({
          provider: resolved.provider,
          model: resolved.model,
          history: payload.messages,
          mode,
          toolbox,
          checkpoint,
          emit,
          requestApproval,
          signal: controller.signal,
          systemPrompt: buildSystemPrompt({ root, platform, shell: sh, mode }),
          sessionAllow: allowSetFor(conversationKey),
          ...(maxSteps ? { maxSteps } : {}),
        });
      } finally {
        if (active.get(requestId) === session) active.delete(requestId);
      }
    })();
    session.promise = promise;
    return true;
  }

  function approve(requestId, callId, decision) {
    const session = active.get(requestId);
    const pending = session?.pending.get(callId);
    if (!pending) return false;
    session.pending.delete(callId);
    pending.resolve(['allow', 'allow_session'].includes(decision) ? decision : 'deny');
    return true;
  }

  function cancel(requestId) {
    const session = active.get(requestId);
    if (!session) return false;
    session.controller.abort();
    for (const { reject } of session.pending.values()) {
      reject(Object.assign(new Error('Interrompido'), { name: 'AbortError' }));
    }
    session.pending.clear();
    return true;
  }

  return {
    run,
    approve,
    cancel,
    cancelAll: () => [...active.keys()].forEach(cancel),
    // Para testes: aguarda o fim de um pedido.
    wait: (requestId) => active.get(requestId)?.promise,
    isActive: (requestId) => active.has(requestId),
  };
}

/** Diretório existente? (para validar a raiz) */
function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

module.exports = { createAgentSessions, isDirectory };
