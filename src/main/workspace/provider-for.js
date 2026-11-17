/**
 * Escolhe o provider de workspace pelo caminho: `ssh://…` → provider SSH da
 * conexão da janela; o resto → disco local.
 *
 *   providerFor(pathOrUri, sender) → provider (interface em providers/local.js)
 *   sender: webContents (ou o id dele). Caminho remoto sem sender → erro.
 *
 * O manager de conexões é configurado uma vez no main (setRemoteManager).
 * Quem chama continua responsável pelo guard da janela (assertAllowed) antes.
 */

const { localProvider } = require('./providers/local');
const { createSshProvider } = require('./providers/ssh');
const { isRemote, parseRemoteUri, toRemoteUri, remoteJoin, remoteRelative, joinAny } = require('./remote-uri');

let manager = null;
const cache = new Map(); // `${ownerId}|${authority}` → provider

function setRemoteManager(m) {
  manager = m;
  cache.clear();
}

function getRemoteManager() {
  return manager;
}

function ownerIdOf(sender) {
  if (sender && typeof sender === 'object' && sender.id !== undefined) return sender.id;
  if (typeof sender === 'number') return sender;
  return null;
}

function providerFor(pathOrUri, sender) {
  if (!isRemote(pathOrUri)) return localProvider;
  const r = parseRemoteUri(pathOrUri);
  if (!r) throw new Error(`Caminho remoto inválido: ${pathOrUri}`);
  const ownerId = ownerIdOf(sender);
  if (ownerId == null) throw new Error('Caminho remoto sem janela de origem.');
  if (!manager) throw new Error('Pasta remota indisponível.');
  const key = `${ownerId}|${r.authority}`;
  let p = cache.get(key);
  if (!p) {
    p = createSshProvider({ manager, ownerId, authority: r.authority });
    cache.set(key, p);
  }
  return p;
}

module.exports = {
  providerFor, setRemoteManager, getRemoteManager, isRemote, parseRemoteUri, toRemoteUri, remoteJoin, remoteRelative, joinAny,
};
