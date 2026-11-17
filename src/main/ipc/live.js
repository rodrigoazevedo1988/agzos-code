/**
 * IPC do Agzos Ao Vivo (window.agzos.live).
 *
 * Canais:
 *   live:start(target, { open = true }) → { port, url, openUrl }
 *     target = pasta ou arquivo .html (absoluto, guard da janela). Arquivo dentro da pasta da
 *     janela → serve a pasta da janela e abre o arquivo; senão serve a pasta do arquivo.
 *   live:stop() · live:status() → { running, port?, url?, root? } · live:open() → abre no navegador
 *   live:fileSaved(path) → nº de navegadores recarregados (só se o caminho está na raiz servida)
 * Evento main → renderer: 'live:changed' (status) quando inicia/para.
 *
 * Um servidor por janela (webContents.id); fechar a janela desliga o servidor. O servidor só
 * serve o que o guard daquela janela libera (isAllowed consultado a cada pedido).
 * deps: { guard | guardFor, getWindowRoot, settingsStore, openExternal, createServer? }
 * Ponto de troca para pasta remota: `createServer` / `source` de modules/live/server.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createLiveServer } = require('../modules/live/server');
const { normalizeModules } = require('../lib/settings');
const { guardResolver } = require('../lib/window-guards');

const CHANNELS = ['start', 'stop', 'status', 'open', 'fileSaved'];

function within(root, target) {
  const r = root.replace(/[\\/]+$/, '');
  return target === r || target.startsWith(r + path.sep);
}

function register(ipcMain, {
  guard, guardFor, getWindowRoot, settingsStore, openExternal = () => false, createServer = createLiveServer,
} = {}) {
  const guardOf = guardResolver({ guard, guardFor });
  const servers = new Map(); // webContents.id → { server, root, sender }
  const options = () => normalizeModules(settingsStore?.load?.()?.modules).liveServer;

  function statusOf(entry) {
    if (!entry || !entry.server.port) return { running: false };
    return { running: true, port: entry.server.port, url: entry.server.url, root: entry.root };
  }

  function notify(sender, entry) {
    try { if (!sender.isDestroyed?.()) sender.send('live:changed', statusOf(entry)); } catch { /* janela fechando */ }
  }

  async function stopFor(id) {
    const entry = servers.get(id);
    if (!entry) return;
    servers.delete(id);
    await entry.server.stop();
    notify(entry.sender, null);
  }

  ipcMain.handle('live:start', async (event, target, opts = {}) => {
    const sender = event?.sender;
    if (!options().enabled) throw new Error('O Agzos Ao Vivo está desabilitado nas Configurações.');
    if (typeof target !== 'string' || !target || target.includes('\0') || !path.isAbsolute(target)) throw new Error('Caminho inválido');
    const g = guardOf(sender);
    const abs = g.assertAllowed(target);
    const st = await fs.promises.stat(abs).catch(() => null);
    if (!st) throw new Error(`Não encontrado: ${target}`);
    let root = abs;
    let rel = '';
    if (!st.isDirectory()) {
      if (!/\.html?$/i.test(abs)) throw new Error('O Agzos Ao Vivo abre arquivos .html ou pastas.');
      const own = typeof getWindowRoot === 'function' ? getWindowRoot(sender) : null;
      const ownReal = typeof own === 'string' && own && g.isAllowed(own) ? g.assertAllowed(own) : null;
      root = ownReal && within(ownReal, abs) ? ownReal : path.dirname(abs);
      rel = path.relative(root, abs).split(path.sep).map(encodeURIComponent).join('/');
    }

    const id = sender?.id;
    let entry = servers.get(id);
    if (entry && entry.root !== root) { await stopFor(id); entry = null; }
    if (!entry) {
      const server = createServer({ root, isAllowed: (p) => guardOf(sender).isAllowed(p), startPort: options().startPort });
      entry = { server, root, sender };
      servers.set(id, entry);
      try {
        await server.start();
      } catch (e) {
        servers.delete(id);
        throw e;
      }
      if (typeof sender?.once === 'function') {
        sender.once('destroyed', () => { if (servers.get(id) === entry) stopFor(id).catch(() => {}); });
      }
    }
    const url = entry.server.url;
    const openUrl = url + rel;
    if (opts?.open !== false) openExternal(openUrl);
    notify(sender, entry);
    return { port: entry.server.port, url, openUrl };
  });

  ipcMain.handle('live:stop', async (event) => { await stopFor(event?.sender?.id); return { running: false }; });
  ipcMain.handle('live:status', (event) => statusOf(servers.get(event?.sender?.id)));
  ipcMain.handle('live:open', (event) => {
    const entry = servers.get(event?.sender?.id);
    if (!entry?.server.url) return false;
    openExternal(entry.server.url);
    return true;
  });
  ipcMain.handle('live:fileSaved', (event, p) => {
    const entry = servers.get(event?.sender?.id);
    if (!entry || typeof p !== 'string') return 0;
    return entry.server.reload(p);
  });

  return {
    stopAll: async () => { for (const id of [...servers.keys()]) await stopFor(id); },
  };
}

module.exports = { register, CHANNELS };
