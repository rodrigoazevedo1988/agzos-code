/**
 * Path-guards por janela (como no VS Code): cada janela só acessa a pasta aberta
 * nela, arquivos que ela própria abriu por diálogo/arrastar e caminhos de sistema
 * liberados para ela (ex.: ~/.ssh/config do seletor SSH).
 *
 * guardFor(webContents | id) → guard da janela. Com o objeto webContents, cria o
 * guard na primeira chamada e o descarta no 'destroyed'. Id sem guard → guard
 * que nega tudo (e recusa allow).
 *
 * Protocolo agzos-file: o pedido não traz o webContents. Cada janela recebe um
 * token aleatório (tokenFor), usado como host da URL; guardForToken(token) devolve
 * o guard daquela janela (null se desconhecido → 403). Sem dependência do Electron.
 */

const crypto = require('crypto');
const { createPathGuard } = require('./path-guard');

const DENY_GUARD = Object.freeze({
  allow() { throw new Error('Acesso negado: janela desconhecida'); },
  revoke() {},
  isAllowed: () => false,
  assertAllowed(p) { throw new Error(`Acesso negado: ${p}`); },
  roots: () => [],
});

function createWindowGuards({
  createGuard = () => createPathGuard(),
  randomToken = () => crypto.randomBytes(16).toString('hex'),
} = {}) {
  const byId = new Map(); // webContents.id → { guard, token }
  const byToken = new Map(); // token → entry

  function register(wc) {
    if (byId.has(wc.id)) return byId.get(wc.id);
    const entry = { guard: createGuard(), token: randomToken(), wc };
    byId.set(wc.id, entry);
    byToken.set(entry.token, entry);
    if (typeof wc.once === 'function') {
      wc.once('destroyed', () => {
        if (byId.get(wc.id) === entry) byId.delete(wc.id);
        byToken.delete(entry.token);
      });
    }
    return entry;
  }

  function entryFor(wcOrId) {
    if (wcOrId && typeof wcOrId === 'object' && wcOrId.id !== undefined) {
      if (typeof wcOrId.isDestroyed === 'function' && wcOrId.isDestroyed()) return null;
      return register(wcOrId);
    }
    return byId.get(wcOrId) || null;
  }

  return {
    register: (wc) => register(wc).guard,
    guardFor: (wcOrId) => entryFor(wcOrId)?.guard || DENY_GUARD,
    tokenFor: (wcOrId) => entryFor(wcOrId)?.token || null,
    guardForToken: (token) => (typeof token === 'string' && byToken.get(token)?.guard) || null,
    /** Só para testes E2E: libera o caminho em todas as janelas abertas. */
    allowAll: (p) => { for (const e of byId.values()) e.guard.allow(p); },
    ids: () => [...byId.keys()],
  };
}

/** Handlers aceitam `guard` (único, testes antigos) ou `guardFor(sender)`. */
function guardResolver({ guard, guardFor } = {}) {
  if (typeof guardFor === 'function') return (sender) => guardFor(sender);
  return () => guard;
}

module.exports = { createWindowGuards, guardResolver, DENY_GUARD };
