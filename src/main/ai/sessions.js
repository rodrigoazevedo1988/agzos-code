function createChatSessions({ getProvider, send }) {
  const active = new Map();

  function cancel(requestId) {
    const session = active.get(requestId);
    if (!session) return;
    active.delete(requestId);
    session.abort();
    send('ai:error', requestId, 'Interrompido');
  }

  function start(requestId, { profileId, model, messages }) {
    if (active.has(requestId)) return;
    const controller = new AbortController();
    active.set(requestId, controller);
    (async () => {
      try {
        const provider = getProvider(profileId);
        for await (const text of provider.chat({ model, messages, signal: controller.signal })) {
          if (active.get(requestId) !== controller) return;
          send('ai:chunk', requestId, text);
        }
        if (active.get(requestId) === controller) {
          active.delete(requestId);
          send('ai:done', requestId);
        }
      } catch (err) {
        if (active.get(requestId) === controller) {
          active.delete(requestId);
          send('ai:error', requestId, controller.signal.aborted ? 'Interrompido' : (err.userMessage || 'Não foi possível iniciar a conversa'));
        }
      }
    })();
  }

  return { start, cancel, cancelAll: () => [...active.keys()].forEach(cancel) };
}
module.exports = { createChatSessions };
