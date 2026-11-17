/**
 * Escolhe o provider de workspace pelo caminho: `ssh://…` → provider SSH da
 * conexão da janela; o resto → disco local.
 *
 *   providerFor(pathOrUri, sender) → provider (interface em providers/local.js)
 *   sender: webContents (ou o id dele). Caminho remoto sem sender → erro.
 *
 * O manager de conexões é configurado uma vez no main (setRemoteManager).
 * Quem chama continua responsável pelo guard da janela (assertAllowed) antes.
 *
 * Camadas sem `sender` (runner do git, Vassoura…) usam a janela do contexto:
 * os handlers IPC chamam runAsOwner(sender, fn) e providerFor(p) sem sender
 * pega currentOwner() (AsyncLocalStorage, atravessa os await).
 */

const { AsyncLocalStorage } = require('async_hooks');

const { localProvider } = require('./providers/local');
const { createSshProvider } = require('./providers/ssh');
const { isRemote, parseRemoteUri, toRemoteUri, remoteJoin, remoteRelative, joinAny } = require('./remote-uri');

let manager = null;
let rootsResolver = null; // (ownerId) → raízes liberadas na janela (guard.roots())
const ownerContext = new AsyncLocalStorage();
const cache = new Map(); // `${ownerId}|${authority}` → provider

function setRemoteManager(m) {
  manager = m;
  cache.clear();
}

function getRemoteManager() {
  return manager;
}

/**
 * Raízes da janela para a contenção de symlinks do provider SSH (configurado no
 * main com guardFor(id).roots()). Sem resolver, o provider não contém.
 */
function setRootsResolver(fn) {
  rootsResolver = typeof fn === 'function' ? fn : null;
  cache.clear();
}

function ownerIdOf(sender) {
  if (sender && typeof sender === 'object' && sender.id !== undefined) return sender.id;
  if (typeof sender === 'number') return sender;
  return null;
}

/** Roda fn com a janela `sender` (webContents ou id) como dona das chamadas remotas. */
function runAsOwner(sender, fn) {
  const id = ownerIdOf(sender);
  return id == null ? fn() : ownerContext.run(id, fn);
}

function currentOwner() {
  const id = ownerContext.getStore();
  return id === undefined ? null : id;
}

function providerFor(pathOrUri, sender) {
  if (!isRemote(pathOrUri)) return localProvider;
  const r = parseRemoteUri(pathOrUri);
  if (!r) throw new Error(`Caminho remoto inválido: ${pathOrUri}`);
  const ownerId = sender == null ? currentOwner() : ownerIdOf(sender);
  if (ownerId == null) throw new Error('Caminho remoto sem janela de origem.');
  if (!manager) throw new Error('Pasta remota indisponível.');
  const key = `${ownerId}|${r.authority}`;
  let p = cache.get(key);
  if (!p) {
    const resolver = rootsResolver;
    p = createSshProvider({
      manager, ownerId, authority: r.authority,
      getRoots: resolver ? () => { try { return resolver(ownerId) || []; } catch { return []; } } : null,
    });
    cache.set(key, p);
  }
  return p;
}

module.exports = {
  providerFor, runAsOwner, currentOwner, setRemoteManager, getRemoteManager, setRootsResolver, isRemote, parseRemoteUri, toRemoteUri, remoteJoin, remoteRelative, joinAny,
};
