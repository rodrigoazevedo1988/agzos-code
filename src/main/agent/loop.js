/**
 * Laço do agente: modelo → tool calls → aprovação → execução → resultado → modelo,
 * até o modelo responder sem tool calls, o limite de passos ou o cancelamento.
 *
 * Emite (via emit(evt)) os eventos do contrato IPC de window.agzos.agent:
 *   text · tool_start · approval · tool_output · tool_end · file_changed · user_steer · done · error
 *
 * Steer ("Enviar agora"): mensagens do usuário que chegam durante a execução entram
 * numa fila (createSteerQueue). No próximo ponto seguro — depois de terminar as
 * chamadas de ferramenta em andamento e antes da próxima chamada ao modelo — elas
 * viram mensagens `user` e o laço emite `user_steer` para cada uma. Se chegarem
 * enquanto o modelo dá a resposta final, o laço continua em vez de terminar.
 * A fila é fechada (push → false) de forma síncrona antes de `done`/`error`.
 */

const { randomUUID } = require('crypto');
const { normalizeContent } = require('../ai/content');

const MAX_STEPS = 50;
const MODES = ['ask', 'edit', 'auto'];

/** Precisa de OK do usuário? (risco sempre pede, inclusive leitura de módulo; leitura comum nunca). */
function needsApproval(mode, prepared, sessionAllow) {
  if (prepared.risky) return true;
  if (prepared.category === 'read') return false;
  if (mode === 'auto') return false;
  if (prepared.sessionKey && sessionAllow?.has(prepared.sessionKey)) return false;
  if (mode === 'edit') return prepared.category !== 'write';
  return true;
}

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && ['user', 'assistant', 'system'].includes(m.role))
    .map((m) => ({ role: m.role, content: m.role === 'user' ? normalizeContent(m.content) : (typeof m.content === 'string' ? m.content : String(m.content ?? '')) }))
    .filter((m) => m.content.length > 0);
}

/** Fila de mensagens "Enviar agora" de um pedido. */
function createSteerQueue() {
  const items = [];
  const queue = {
    closed: false,
    push(item) {
      if (queue.closed || !item) return false;
      const content = normalizeContent(item.content);
      if (!content.length) return false;
      items.push({ id: typeof item.id === 'string' && item.id ? item.id : randomUUID(), content, text: item.text });
      return true;
    },
    take: () => items.splice(0, items.length),
    get size() { return items.length; },
    close() { queue.closed = true; },
  };
  return queue;
}

function abortError() {
  const err = new Error('Interrompido');
  err.name = 'AbortError';
  return err;
}

/**
 * Executa um pedido do agente. Sempre termina emitindo `done` ou `error`.
 * requestApproval(callId) → Promise<'allow'|'deny'|'allow_session'> (rejeita no cancelamento).
 */
async function runAgent({
  provider, model, history, mode = 'edit', toolbox, checkpoint, emit, requestApproval,
  signal, systemPrompt, maxSteps = MAX_STEPS, sessionAllow = new Set(), steering = createSteerQueue(),
  readOnly = false,
}) {
  const effectiveMode = MODES.includes(mode) ? mode : 'edit';
  const messages = [{ role: 'system', content: systemPrompt }, ...sanitizeHistory(history)];
  let steps = 0;

  function summary() {
    const changes = checkpoint ? checkpoint.changes() : [];
    const saved = checkpoint ? checkpoint.finalize() : false;
    return { checkpointId: saved ? checkpoint.id : null, changes };
  }

  async function executeCall(call) {
    const callId = call.id || `call_${randomUUID()}`;
    const input = call.input && typeof call.input === 'object' ? call.input : {};
    let prepared;
    try {
      // ferramentas de módulos podem preparar de forma assíncrona
      prepared = await toolbox.prepare(call.name, input);
    } catch (err) {
      emit({ type: 'tool_start', callId, tool: call.name, input, title: call.name });
      emit({ type: 'tool_end', callId, ok: false, summary: err.message, meta: {} });
      return { ok: false, content: `Erro: ${err.message}` };
    }
    emit({ type: 'tool_start', callId, tool: call.name, input, title: prepared.title });

    // Skill readOnly (ex.: Cyber Security): toda ação que não é leitura pede OK.
    const forced = readOnly && prepared.category !== 'read';
    if (forced || needsApproval(effectiveMode, prepared, sessionAllow)) {
      const evt = { type: 'approval', callId, tool: call.name, input, preview: prepared.preview || {} };
      if (prepared.risky) { evt.risky = true; evt.reason = prepared.riskReason; }
      emit(evt);
      let decision;
      try {
        decision = await requestApproval(callId);
      } catch (err) {
        emit({ type: 'tool_end', callId, ok: false, summary: 'Cancelado', meta: {} });
        throw err;
      }
      if (decision !== 'allow' && decision !== 'allow_session') {
        emit({ type: 'tool_end', callId, ok: false, summary: 'Negado pelo usuário', meta: { denied: true } });
        return { ok: false, content: 'O usuário negou esta ação. Não repita a mesma ação; ajuste o plano ou pergunte ao usuário como prosseguir.' };
      }
      if (decision === 'allow_session' && prepared.sessionKey && !prepared.risky && !forced) sessionAllow.add(prepared.sessionKey);
    }

    let result;
    try {
      result = await prepared.execute({
        signal,
        onOutput: (chunk) => emit({ type: 'tool_output', callId, chunk }),
      });
    } catch (err) {
      emit({ type: 'tool_end', callId, ok: false, summary: err.message, meta: {} });
      if (signal?.aborted) throw abortError();
      return { ok: false, content: `Erro: ${err.message}` };
    }
    emit({ type: 'tool_end', callId, ok: !!result.ok, summary: result.summary || '', meta: result.meta || {} });
    for (const p of result.changed || []) emit({ type: 'file_changed', path: p });
    if (signal?.aborted) throw abortError();
    return { ok: !!result.ok, content: result.result };
  }

  try {
    if (typeof provider?.chatTools !== 'function') {
      const err = new Error('Este provedor não suporta ferramentas (tool calling).');
      err.code = 'tools_unsupported';
      throw err;
    }
    let stopped = null;
    const applySteers = () => {
      const pending = steering.take();
      for (const item of pending) {
        messages.push({ role: 'user', content: item.content });
        emit({ type: 'user_steer', id: item.id, content: typeof item.text === 'string' ? item.text : textOf(item.content) });
      }
      return pending.length;
    };
    for (;;) {
      if (signal?.aborted) throw abortError();
      applySteers();
      let text = '';
      const calls = [];
      for await (const ev of provider.chatTools({ model, messages, tools: toolbox.definitions, signal })) {
        if (signal?.aborted) throw abortError();
        if (ev.type === 'text' && ev.delta) {
          text += ev.delta;
          emit({ type: 'text', delta: ev.delta });
        } else if (ev.type === 'tool_call') {
          calls.push({ ...ev, id: ev.id || `call_${randomUUID()}` });
        }
      }
      if (signal?.aborted) throw abortError();
      messages.push({ role: 'assistant', content: text, toolCalls: calls });
      if (!calls.length) {
        if (steering.size) continue; // chegou mensagem durante a resposta final
        break;
      }
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        if (steps >= maxSteps) {
          stopped = 'step_limit';
          break;
        }
        steps++;
        const res = await executeCall(call);
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: res.content, isError: !res.ok });
      }
      if (stopped) break;
    }
    steering.close();
    const { checkpointId, changes } = summary();
    const done = { type: 'done', checkpointId, changes, steps };
    if (stopped) {
      done.stopped = stopped;
      emit({ type: 'text', delta: `\n\n_Limite de ${maxSteps} passos atingido; parei aqui._` });
    }
    emit(done);
    return done;
  } catch (err) {
    steering.close();
    const { checkpointId, changes } = summary();
    const evt = { type: 'error', message: err.userMessage || err.message || 'Erro no agente' };
    if (signal?.aborted || err.name === 'AbortError') { evt.message = 'Interrompido'; evt.code = 'cancelled'; }
    else if (err.code === 'tools_unsupported') {
      evt.code = 'tools_unsupported';
      evt.message = `Este modelo não suporta ferramentas (tool calling). ${evt.message}`.trim();
    } else evt.code = 'provider_error';
    if (checkpointId) { evt.checkpointId = checkpointId; evt.changes = changes; }
    evt.steps = steps;
    emit(evt);
    return evt;
  }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n');
}

module.exports = { runAgent, needsApproval, sanitizeHistory, createSteerQueue, MAX_STEPS, MODES };
