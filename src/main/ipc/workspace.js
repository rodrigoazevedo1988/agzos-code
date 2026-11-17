/**
 * IPC: abrir pasta como workspace (workspace:open), fechar (workspace:close)
 * e limpar recentes (workspace:clearRecent).
 * Libera a pasta no guard só se ela já foi escolhida em diálogo ou está em recentFolders.
 * recentFolders é controlado só pelo main (settings:save ignora o valor vindo do renderer);
 * senão o renderer poderia gravar qualquer pasta ali e liberá-la.
 *
 * Várias janelas: cada uma tem a sua pasta, guardada por webContents.id (rootFor),
 * e o seu guard (guardFor(sender), lib/window-guards.js). Trocar ou fechar a pasta
 * revoga a anterior no guard daquela janela; recentes continuam podendo ser
 * reabertos por este mesmo fluxo.
 */

const { guardResolver } = require('../lib/window-guards');
const { isRemote, parseRemoteUri, toRemoteUri, providerFor, getRemoteManager } = require('../workspace/provider-for');

function register(ipcMain, {
  guard, guardFor, getRecentFolders, addRecentFolder, clearRecentFolders = () => {},
  remoteManager = () => getRemoteManager(),
}) {
  const guardOf = guardResolver({ guard, guardFor });
  const roots = new Map(); // webContents.id → pasta aberta naquela janela

  function track(sender, folderPath) {
    if (!sender || sender.id === undefined) return;
    if (!roots.has(sender.id) && typeof sender.once === 'function') {
      sender.once('destroyed', () => roots.delete(sender.id));
    }
    roots.set(sender.id, folderPath);
  }

  function revokePrevious(sender, next) {
    if (!sender || sender.id === undefined) return;
    const prev = roots.get(sender.id);
    const g = guardOf(sender);
    if (prev && prev !== next && typeof g?.revoke === 'function') g.revoke(prev);
  }

  /**
   * Pasta remota (ssh://…): só com conexão SSH aberta por esta janela para o host
   * (o usuário conectou e autenticou nela) e se o caminho for uma pasta no host.
   * Recentes remotos passam pelo mesmo fluxo (o renderer reconecta antes).
   */
  async function openRemote(evt, folderPath) {
    const r = parseRemoteUri(folderPath);
    const sender = evt?.sender;
    if (!r || !sender || sender.id === undefined) return false;
    const m = remoteManager();
    if (!m || !m.get(sender.id, r.authority)) return false;
    const uri = toRemoteUri(r.authority, r.path);
    try {
      const st = await providerFor(uri, sender).stat(uri);
      if (!st.isDirectory) return false;
    } catch {
      return false;
    }
    const g = guardOf(sender);
    revokePrevious(sender, uri);
    g.allow(uri);
    addRecentFolder(uri);
    track(sender, uri);
    return true;
  }

  ipcMain.handle('workspace:open', (evt, folderPath) => {
    if (typeof folderPath !== 'string' || !folderPath) return false;
    if (isRemote(folderPath)) return openRemote(evt, folderPath);
    const g = guardOf(evt?.sender);
    if (!g.isAllowed(folderPath)) {
      if (!getRecentFolders().includes(folderPath)) return false;
      g.allow(folderPath);
    }
    revokePrevious(evt?.sender, folderPath);
    // Raiz explícita no guard (mesmo se liberada por estar dentro de outra raiz).
    g.allow(folderPath);
    addRecentFolder(folderPath);
    track(evt?.sender, folderPath);
    return true;
  });

  ipcMain.handle('workspace:close', (evt) => {
    if (evt?.sender) {
      revokePrevious(evt.sender, null);
      roots.set(evt.sender.id, null);
    }
    return true;
  });

  ipcMain.handle('workspace:clearRecent', () => {
    clearRecentFolders();
    return getRecentFolders();
  });

  return {
    rootFor: (id) => roots.get(id) || null,
  };
}

module.exports = { register };
