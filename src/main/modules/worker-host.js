// Host de processo utilitário dos módulos nativos (F0.1).
// O pai cria o processo sob demanda, encerra após idleMs sem pendências e
// recria na próxima chamada se ele morrer. Protocolo por mensagem:
//   pai → filho: { id, method, params } | { id, cancel: true }
//   filho → pai: { id, ok: true, result } | { id, ok: false, error: { message, code } }

function abortError() {
  const err = new Error('Operação cancelada');
  err.name = 'AbortError';
  return err;
}

function defaultFork(script) {
  const { utilityProcess } = require('electron');
  return utilityProcess.fork(script, [], { serviceName: 'agzos-modules', stdio: 'inherit' });
}

function createWorkerHost({ script, idleMs = 60000, fork = defaultFork } = {}) {
  if (!script) throw new Error('createWorkerHost: script é obrigatório');
  let child = null;
  let nextId = 1;
  let idleTimer = null;
  const pending = new Map();

  function clearIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function scheduleIdle() {
    clearIdle();
    if (!child || pending.size > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (pending.size === 0) stop();
    }, idleMs);
    if (idleTimer.unref) idleTimer.unref();
  }

  function rejectAll(err) {
    for (const [, p] of pending) p.settle(null, err);
    pending.clear();
  }

  function stop() {
    const c = child;
    child = null;
    clearIdle();
    if (c) {
      try {
        c.kill();
      } catch {}
    }
  }

  function ensureChild() {
    if (child) return child;
    const c = fork(script);
    child = c;
    c.on('message', (msg) => {
      if (c !== child || !msg || typeof msg.id !== 'number') return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.settle(msg.result);
      else {
        const e = new Error((msg.error && msg.error.message) || 'Erro no processo do módulo');
        if (msg.error && msg.error.code) e.code = msg.error.code;
        if (msg.error && msg.error.name === 'AbortError') e.name = 'AbortError';
        p.settle(null, e);
      }
      scheduleIdle();
    });
    c.on('exit', (code) => {
      if (c !== child) return;
      child = null;
      clearIdle();
      rejectAll(new Error(`O processo dos módulos encerrou inesperadamente (código ${code ?? '?'})`));
    });
    return c;
  }

  function call(method, params, { signal } = {}) {
    if (signal && signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const c = ensureChild();
      clearIdle();
      let onAbort = null;
      const settle = (result, err) => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(result);
      };
      pending.set(id, { settle });
      if (signal) {
        onAbort = () => {
          if (!pending.has(id)) return;
          pending.delete(id);
          try {
            if (child === c) c.postMessage({ id, cancel: true });
          } catch {}
          settle(null, abortError());
          scheduleIdle();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        c.postMessage({ id, method, params });
      } catch (e) {
        pending.delete(id);
        settle(null, e);
        scheduleIdle();
      }
    });
  }

  function dispose() {
    const had = child;
    child = null;
    clearIdle();
    rejectAll(new Error('O processo dos módulos foi encerrado'));
    if (had) {
      try {
        had.kill();
      } catch {}
    }
  }

  return { call, dispose, isAlive: () => child !== null };
}

// Lado filho: usa process.parentPort (Electron utilityProcess) ou process (child_process).
// Cada handler recebe (params, signal) e pode devolver valor ou Promise.
function serveWorker(handlers = {}) {
  const port = process.parentPort || process;
  const isElectron = Boolean(process.parentPort);
  const send = (msg) => (isElectron ? port.postMessage(msg) : process.send && process.send(msg));
  const running = new Map();

  port.on('message', async (raw) => {
    const msg = isElectron ? raw && raw.data : raw;
    if (!msg || typeof msg.id !== 'number') return;
    if (msg.cancel) {
      const ac = running.get(msg.id);
      if (ac) ac.abort();
      return;
    }
    const handler = Object.prototype.hasOwnProperty.call(handlers, msg.method) ? handlers[msg.method] : null;
    if (typeof handler !== 'function') {
      send({ id: msg.id, ok: false, error: { message: `Método desconhecido: ${msg.method}`, code: 'E_UNKNOWN_METHOD' } });
      return;
    }
    const ac = new AbortController();
    running.set(msg.id, ac);
    try {
      const result = await handler(msg.params, ac.signal);
      if (!ac.signal.aborted) send({ id: msg.id, ok: true, result });
    } catch (err) {
      if (!ac.signal.aborted) {
        send({
          id: msg.id,
          ok: false,
          error: { message: (err && err.message) || String(err), code: err && err.code, name: err && err.name },
        });
      }
    } finally {
      running.delete(msg.id);
    }
  });
}

module.exports = { createWorkerHost, serveWorker };
