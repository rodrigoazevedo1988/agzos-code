/**
 * Laço do agente: modelo → tool calls → aprovação → execução → resultado → modelo,
 * até o modelo responder sem tool calls, o limite de passos ou o cancelamento.
 *
 * Emite (via emit(evt)) os eventos do contrato IPC de window.agzos.agent:
 *   text · tool_start · approval · tool_output · tool_end · file_changed · done · error
 */

const { randomUUID } = require('crypto');

const MAX_STEPS = 50;
const MODES = ['ask', 'edit', 'auto'];

/** Precisa de OK do usuário? (risco sempre pede; leitura nunca). */
function needsApproval(mode, prepared, sessionAllow) {
  if (prepared.category === 'read') return false;
  if (prepared.risky) return true;
  if (mode === 'auto') return false;
  if (prepared.sessionKey && sessionAllow?.has(prepared.sessionKey)) return false;
  if (mode === 'edit') return prepared.category !== 'write';
  return true;
}

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && ['user', 'assistant', 'system'].includes(m.role))
    .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content ?? '') }))
    .filter((m) => m.content.length > 0);
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
  signal, systemPrompt, maxSteps = MAX_STEPS, sessionAllow = new Set(),
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
      prepared = toolbox.prepare(call.name, input);
    } catch (err) {
      emit({ type: 'tool_start', callId, tool: call.name, input, title: call.name });
      emit({ type: 'tool_end', callId, ok: false, summary: err.message, meta: {} });
      return { ok: false, content: `Erro: ${err.message}` };
    }
    emit({ type: 'tool_start', callId, tool: call.name, input, title: prepared.title });

    if (needsApproval(effectiveMode, prepared, sessionAllow)) {
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
      if (decision === 'allow_session' && prepared.sessionKey && !prepared.risky) sessionAllow.add(prepared.sessionKey);
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
    for (;;) {
      if (signal?.aborted) throw abortError();
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
      if (!calls.length) break;
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
    const { checkpointId, changes } = summary();
    const done = { type: 'done', checkpointId, changes, steps };
    if (stopped) {
      done.stopped = stopped;
      emit({ type: 'text', delta: `\n\n_Limite de ${maxSteps} passos atingido; parei aqui._` });
    }
    emit(done);
    return done;
  } catch (err) {
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

module.exports = { runAgent, needsApproval, sanitizeHistory, MAX_STEPS, MODES };
