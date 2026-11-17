/**
 * Sessões do agente por janela: run / approve / cancel, sem dependência do Electron.
 */

const fs = require('fs');
const { runAgent, createSteerQueue, MODES } = require('./loop');
const { createToolbox, ToolError } = require('./tools');
const { filterDefinitions } = require('./skills');
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
 *   getExtraTools() → ferramentas extras dos módulos habilitados (ver modules/agent-tools.js)
 */
function createAgentSessions({
  getRoot, getProvider, getMode = () => 'edit', checkpoints, send,
  platform = process.platform, getEnv = () => winEnv.freshEnv({ platform }),
  runCommand, shell, maxSteps, getExtraTools = () => [],
  buildContent = (text) => text,
  getSkill = () => null,
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
    const steering = createSteerQueue();
    const session = { controller, pending: new Map(), steering };
    active.set(requestId, session);

    const env = getEnv();
    const sh = shell || pickShell({ platform, env });
    const checkpoint = checkpoints.create({ root });
    const skill = safeSkill(getSkill, payload.skill, root);
    const toolbox = restrictToolbox(createToolbox({
      root, checkpoint, platform, shell: sh, env, runCommand,
      secrets: secretValues(env, [resolved.apiKey]),
      extraTools: safeExtraTools(getExtraTools),
    }), skill);
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
          history: expandHistory(payload.messages),
          mode,
          toolbox,
          checkpoint,
          emit,
          requestApproval,
          signal: controller.signal,
          systemPrompt: buildSystemPrompt({ root, platform, shell: sh, mode, skill }),
          readOnly: !!skill?.readOnly,
          sessionAllow: allowSetFor(conversationKey),
          steering,
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

  /**
   * "Enviar agora": acrescenta uma mensagem do usuário ao pedido em andamento.
   * payload: { id?, content, attachments? } → true se aceita (vira `user_steer` no
   * próximo ponto seguro); false se o pedido já terminou ou o conteúdo é vazio.
   */
  /** Mensagens do usuário com `attachments` (refs do renderer) viram conteúdo multimodal. */
  function expandHistory(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map((m) => {
      if (!m || m.role !== 'user' || !Array.isArray(m.attachments) || !m.attachments.length) return m;
      try {
        return { role: 'user', content: buildContent(typeof m.content === 'string' ? m.content : '', m.attachments) };
      } catch (err) {
        console.error('[agent] anexos ignorados:', err.message);
        return { role: 'user', content: m.content };
      }
    });
  }

  function steer(requestId, payload = {}) {
    const session = active.get(requestId);
    if (!session || session.steering.closed || session.controller.signal.aborted) return false;
    const text = typeof payload.content === 'string' ? payload.content : '';
    let content = text;
    try {
      content = buildContent(text, payload.attachments);
    } catch (err) {
      console.error('[agent] anexos do steer ignorados:', err.message);
    }
    return session.steering.push({ id: payload.id, content, text });
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
    steer,
    cancel,
    cancelAll: () => [...active.keys()].forEach(cancel),
    // Para testes: aguarda o fim de um pedido.
    wait: (requestId) => active.get(requestId)?.promise,
    isActive: (requestId) => active.has(requestId),
  };
}

/** Skill pedida (id) → objeto da skill ou null. Erro no loader nunca derruba o agente. */
function safeSkill(getSkill, id, root) {
  if (typeof id !== 'string' || !id) return null;
  try {
    return getSkill(id, root) || null;
  } catch (err) {
    console.error('[agent] skill indisponível:', err.message);
    return null;
  }
}

/** Aplica a allowlist da skill: só as definitions permitidas e prepare recusa o resto. */
function restrictToolbox(toolbox, skill) {
  if (!skill || !Array.isArray(skill.tools)) return toolbox;
  const allowed = new Set(skill.tools);
  return {
    ...toolbox,
    definitions: filterDefinitions(toolbox.definitions, skill),
    prepare(name, input) {
      if (!allowed.has(name)) throw new ToolError(`Ferramenta ${name} não está disponível no modo ${skill.label}.`);
      return toolbox.prepare(name, input);
    },
  };
}

/** Falha ao carregar ferramentas de módulos não derruba o agente. */
function safeExtraTools(getExtraTools) {
  try {
    const tools = getExtraTools();
    return Array.isArray(tools) ? tools : [];
  } catch (err) {
    console.error('[agent] ferramentas de módulos indisponíveis:', err.message);
    return [];
  }
}

/** Diretório existente? (para validar a raiz) */
function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

module.exports = { createAgentSessions, isDirectory, restrictToolbox };
