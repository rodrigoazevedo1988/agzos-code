/**
 * IPC: pasta remota via SSH (remote:*).
 *
 * - remote:connect(target)      → { ok, authority, label, home } | { ok: false, error, code }
 * - remote:reconnect(authority) / remote:disconnect(authority) / remote:list()
 * - remote:browse(authority, dir) → pastas do host (navegador da "Abrir pasta remota")
 * - remote:prompt:reply(id, valor) — resposta dos diálogos pedidos pelo main
 *
 * Diálogos (senha/passphrase, host key desconhecida) vão só para a janela dona da
 * conexão (`remote:prompt`); a resposta só vale se vier do mesmo webContents.
 * Estado da conexão (`remote:state`) também só para a janela dona.
 * Host key divergente não gera diálogo de escolha: connect falha com HOSTKEY_MISMATCH.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { collectHosts, isSafeAlias } = require('../lib/ssh-config');
const { resolveTarget } = require('../remote/connection');
const { toRemoteUri, parseRemoteUri } = require('../workspace/remote-uri');

function readHosts(home) {
  return collectHosts({
    home,
    configPath: path.join(home, '.ssh', 'config'),
    fs: {
      readFile: (p) => {
        const st = fs.statSync(p);
        if (!st.isFile() || st.size > 1024 * 1024) throw new Error('ignorado');
        return fs.readFileSync(p, 'utf8');
      },
      readDir: (d) => fs.readdirSync(d),
    },
  }).filter((h) => isSafeAlias(h.host));
}

function register(ipcMain, { manager, home = () => os.homedir() }) {
  const pending = new Map(); // id → { ownerId, resolve }
  const tracked = new Set();

  function track(sender) {
    if (!sender || tracked.has(sender.id) || typeof sender.once !== 'function') return;
    tracked.add(sender.id);
    const id = sender.id;
    sender.once('destroyed', () => {
      tracked.delete(id);
      for (const [pid, p] of pending) if (p.ownerId === id) { pending.delete(pid); p.resolve(null); }
      manager.disposeOwner(id);
    });
  }

  function ask(sender, payload) {
    return new Promise((resolve) => {
      if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) return resolve(null);
      const id = crypto.randomBytes(12).toString('hex');
      pending.set(id, { ownerId: sender.id, resolve });
      try { sender.send('remote:prompt', id, payload); } catch { pending.delete(id); resolve(null); }
    });
  }

  function promptsFor(sender) {
    return {
      askSecret: async (req) => {
        const { kind, ...rest } = req || {};
        // secret: 'password' | 'passphrase'
        const r = await ask(sender, { ...rest, kind: 'secret', secret: kind });
        if (!r || typeof r.value !== 'string') return null;
        return { value: r.value, remember: !!r.remember };
      },
      askHostKey: async (info) => (await ask(sender, { kind: 'hostkey', ...info })) === true,
    };
  }

  const fail = (err) => ({ ok: false, error: err?.message || String(err), code: err?.code || 'ERROR' });

  ipcMain.handle('remote:prompt:reply', (evt, id, value) => {
    const p = pending.get(id);
    if (!p || p.ownerId !== evt?.sender?.id) return false;
    pending.delete(id);
    p.resolve(value);
    return true;
  });

  ipcMain.handle('remote:connect', async (evt, target) => {
    const sender = evt?.sender;
    try {
      track(sender);
      const resolved = resolveTarget(target, { hosts: readHosts(home()) });
      // Alvo já resolvido com o ~/.ssh/config (alias → HostName/User/Port).
      const info = await manager.connect(sender.id, resolved, promptsFor(sender));
      const homeDir = await remoteHome(sender.id, info.authority).catch(() => '/');
      return { ok: true, ...info, home: homeDir, homeUri: toRemoteUri(info.authority, homeDir) };
    } catch (err) {
      return fail(err);
    }
  });

  async function remoteHome(ownerId, authority) {
    const sftp = await manager.sftp(ownerId, authority);
    return new Promise((resolve, reject) => sftp.realpath('.', (err, p) => (err ? reject(err) : resolve(p))));
  }

  ipcMain.handle('remote:reconnect', async (evt, authority) => {
    try {
      track(evt.sender);
      return { ok: true, ...(await manager.reconnect(evt.sender.id, authority, promptsFor(evt.sender))) };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('remote:disconnect', (evt, authority) => manager.disconnect(evt.sender.id, authority));
  ipcMain.handle('remote:list', (evt) => manager.list(evt.sender.id));

  // Navegador de pastas da "Abrir pasta remota": só pastas, só com conexão desta janela.
  ipcMain.handle('remote:browse', async (evt, authority, dir) => {
    try {
      if (typeof authority !== 'string' || !manager.get(evt.sender.id, authority)) {
        throw new Error('Sem conexão com este host nesta janela.');
      }
      const sftp = await manager.sftp(evt.sender.id, authority);
      let target = typeof dir === 'string' && dir ? dir : '.';
      if (target !== '.') {
        const parsed = parseRemoteUri(toRemoteUri(authority, target));
        if (!parsed) throw new Error('Caminho remoto inválido.');
        target = parsed.path;
      }
      const real = await new Promise((resolve, reject) => sftp.realpath(target, (err, p) => (err ? reject(err) : resolve(p))));
      const list = await new Promise((resolve, reject) => sftp.readdir(real, (err, l) => (err ? reject(err) : resolve(l))));
      const dirs = list
        .filter((e) => e.attrs && typeof e.attrs.isDirectory === 'function' && e.attrs.isDirectory())
        .filter((e) => !e.filename.startsWith('.'))
        .map((e) => ({ name: e.filename, path: path.posix.join(real, e.filename) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, path: real, uri: toRemoteUri(authority, real), parent: real === '/' ? null : path.posix.dirname(real), dirs };
    } catch (err) {
      return fail(err);
    }
  });

  return { promptsFor };
}

module.exports = { register, readHosts };
