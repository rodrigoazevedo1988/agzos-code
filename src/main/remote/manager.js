/**
 * Conexões SSH por janela: uma por host (authority) por janela, compartilhada por
 * SFTP, exec, terminais e busca. Sem Electron.
 *
 * - connect(ownerId, target, { askSecret, askHostKey }) → { authority, label, home }
 * - ensure(ownerId, authority) → entrada conectada (espera a reconexão em curso)
 * - sftp(ownerId, authority) → SFTPWrapper (um por conexão, sob demanda)
 * - Queda: estado 'lost' e até 3 tentativas com espera crescente ('reconnecting');
 *   sem sucesso → 'failed' (a UI mostra "Reconectar" → reconnect()). Host key
 *   divergente na reconexão para na hora.
 * - Senha/passphrase digitadas ficam só na memória do main para a reconexão
 *   automática não pedir de novo (o cofre só recebe com "Lembrar").
 * - onState(ownerId, { authority, label, state, attempt?, error? }).
 */

const { resolveTarget: defaultResolve, openConnection: defaultOpen, RemoteError } = require('./connection');

const DEFAULT_DELAYS = [1000, 3000, 7000];

function createRemoteManager({
  resolveTarget = (t) => defaultResolve(t),
  openConnection = defaultOpen,
  connectionOptions = () => ({}),
  retryDelays = DEFAULT_DELAYS,
  onState = () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const owners = new Map(); // ownerId → Map(authority → entry)

  const mapFor = (ownerId) => {
    if (!owners.has(ownerId)) owners.set(ownerId, new Map());
    return owners.get(ownerId);
  };

  function emit(entry, state, extra = {}) {
    entry.state = state;
    try { onState(entry.ownerId, { authority: entry.authority, label: entry.label, state, ...extra }); } catch { /* janela fechou */ }
  }

  function wrapPrompts(entry, prompts) {
    // Reaproveita na reconexão o que o usuário digitou nesta sessão (memória do main).
    const used = new Set();
    return {
      askHostKey: (info) => (prompts?.askHostKey ? prompts.askHostKey(info) : Promise.resolve(false)),
      askSecret: async (req) => {
        const k = `${req.kind}:${req.keyPath || ''}`;
        if (!used.has(k) && entry.memory.has(k)) {
          used.add(k);
          return { value: entry.memory.get(k), remember: false };
        }
        const res = prompts?.askSecret ? await prompts.askSecret(req) : null;
        if (res && typeof res.value === 'string') entry.memory.set(k, res.value);
        return res;
      },
    };
  }

  async function open(entry) {
    const { client } = await openConnection(entry.resolved, {
      ...connectionOptions(),
      ...wrapPrompts(entry, entry.prompts),
    });
    entry.client = client;
    entry.sftpP = null;
    entry.home = null;
    client.on('error', () => {});
    client.once('close', () => onClosed(entry, client));
    emit(entry, 'connected');
    return entry;
  }

  function onClosed(entry, client) {
    if (entry.client !== client) return;
    entry.client = null;
    entry.sftpP = null;
    if (entry.closedByUser || entry.disposed) { emit(entry, 'closed'); return; }
    emit(entry, 'lost');
    entry.reconnectP = autoReconnect(entry).finally(() => { entry.reconnectP = null; });
  }

  async function autoReconnect(entry) {
    for (let i = 0; i < retryDelays.length; i++) {
      await sleep(retryDelays[i]);
      if (entry.disposed || entry.closedByUser) return null;
      emit(entry, 'reconnecting', { attempt: i + 1 });
      try {
        return await open(entry);
      } catch (err) {
        if (err?.code === 'HOSTKEY_MISMATCH' || err?.code === 'CANCELLED') {
          emit(entry, 'failed', { error: err.message, code: err.code });
          return null;
        }
      }
    }
    emit(entry, 'failed', { error: `Não foi possível reconectar a ${entry.label}.` });
    return null;
  }

  function publicInfo(entry) {
    return { authority: entry.authority, label: entry.label, host: entry.resolved.host, port: entry.resolved.port, user: entry.resolved.user, state: entry.state };
  }

  async function connect(ownerId, target, prompts = {}) {
    // Alvo já resolvido (ipc/remote resolve com o ~/.ssh/config) ou cru.
    const resolved = target && typeof target === 'object' && target.authority && target.host ? target : resolveTarget(target);
    const map = mapFor(ownerId);
    let entry = map.get(resolved.authority);
    if (entry && entry.state === 'connected' && entry.client) {
      entry.prompts = prompts;
      return publicInfo(entry);
    }
    if (entry && entry.connectP) return entry.connectP;
    if (!entry) {
      entry = { ownerId, authority: resolved.authority, label: resolved.label, resolved, client: null, sftpP: null, state: 'connecting', memory: new Map() };
      map.set(resolved.authority, entry);
    }
    entry.prompts = prompts;
    entry.closedByUser = false;
    entry.disposed = false;
    emit(entry, 'connecting');
    entry.connectP = open(entry)
      .then(() => publicInfo(entry))
      .catch((err) => {
        if (!entry.client) {
          map.delete(entry.authority);
          emit(entry, 'failed', { error: err.message, code: err.code });
        }
        throw err;
      })
      .finally(() => { entry.connectP = null; });
    return entry.connectP;
  }

  function get(ownerId, authority) {
    return owners.get(ownerId)?.get(authority) || null;
  }

  async function ensure(ownerId, authority) {
    const entry = get(ownerId, authority);
    if (!entry) throw new RemoteError(`Sem conexão com ${authority}. Abra a pasta remota de novo.`, 'NOT_CONNECTED');
    if (entry.client && entry.state === 'connected') return entry;
    if (entry.connectP) { await entry.connectP; return ensure(ownerId, authority); }
    if (entry.reconnectP) {
      const r = await entry.reconnectP;
      if (r && r.client) return r;
    }
    throw new RemoteError(`Conexão com ${entry.label} perdida.`, 'REMOTE_LOST');
  }

  async function sftp(ownerId, authority) {
    const entry = await ensure(ownerId, authority);
    if (!entry.sftpP) {
      const client = entry.client;
      entry.sftpP = new Promise((resolve, reject) => {
        client.sftp((err, s) => {
          if (err) return reject(new RemoteError(`SFTP indisponível em ${entry.label}: ${err.message}`, 'SFTP_FAILED'));
          s.on('close', () => { if (entry.client === client) entry.sftpP = null; });
          resolve(s);
        });
      });
      entry.sftpP.catch(() => { entry.sftpP = null; });
    }
    return entry.sftpP;
  }

  async function reconnect(ownerId, authority, prompts) {
    const entry = get(ownerId, authority);
    if (!entry) throw new RemoteError(`Sem conexão com ${authority}.`, 'NOT_CONNECTED');
    if (entry.client && entry.state === 'connected') return publicInfo(entry);
    if (prompts) entry.prompts = prompts;
    entry.closedByUser = false;
    emit(entry, 'reconnecting', { attempt: 0 });
    try {
      await open(entry);
    } catch (err) {
      emit(entry, 'failed', { error: err.message, code: err.code });
      throw err;
    }
    return publicInfo(entry);
  }

  function disconnect(ownerId, authority) {
    const entry = get(ownerId, authority);
    if (!entry) return false;
    entry.closedByUser = true;
    owners.get(ownerId)?.delete(authority);
    try { entry.client?.end(); } catch { /* já fechado */ }
    return true;
  }

  function disposeOwner(ownerId) {
    const map = owners.get(ownerId);
    if (!map) return;
    for (const entry of map.values()) {
      entry.disposed = true;
      try { entry.client?.end(); } catch { /* já fechado */ }
    }
    owners.delete(ownerId);
  }

  function list(ownerId) {
    return [...(owners.get(ownerId)?.values() || [])].map(publicInfo);
  }

  function disposeAll() {
    for (const id of [...owners.keys()]) disposeOwner(id);
  }

  return { connect, get, ensure, sftp, reconnect, disconnect, disposeOwner, disposeAll, list };
}

module.exports = { createRemoteManager, DEFAULT_DELAYS };
