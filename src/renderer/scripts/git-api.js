/**
 * Chamadas ao main (git:* e github:*) com resposta desembrulhada.
 * O main responde { ok, data } | { ok: false, error: { message, kind } };
 * aqui o erro vira exceção com `kind` (o Electron perde props de Error no IPC).
 */

export class GitUiError extends Error {
  constructor(message, kind = 'error') {
    super(message);
    this.kind = kind;
  }
}

async function unwrap(promise) {
  const res = await promise;
  if (res && res.ok === true) return res.data;
  if (res && res.ok === false) throw new GitUiError(res.error?.message || 'Falha', res.error?.kind);
  return res;
}

export const git = new Proxy({}, {
  get: (_t, name) => (...args) => unwrap(window.agzos.git[name](...args)),
});

export const github = new Proxy({}, {
  get: (_t, name) => (...args) => unwrap(window.agzos.github[name](...args)),
});
