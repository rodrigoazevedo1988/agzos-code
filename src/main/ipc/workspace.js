/**
 * IPC: abrir pasta como workspace (workspace:open), fechar (workspace:close)
 * e limpar recentes (workspace:clearRecent).
 * Libera a pasta no guard só se ela já foi escolhida em diálogo ou está em recentFolders.
 * recentFolders é controlado só pelo main (settings:save ignora o valor vindo do renderer);
 * senão o renderer poderia gravar qualquer pasta ali e liberá-la.
 *
 * Várias janelas: cada uma tem a sua pasta, guardada por webContents.id
 * (rootFor). O guard continua único: libera a união das pastas abertas.
 */

function register(ipcMain, { guard, getRecentFolders, addRecentFolder, clearRecentFolders = () => {} }) {
  const roots = new Map(); // webContents.id → pasta aberta naquela janela

  function track(sender, folderPath) {
    if (!sender || sender.id === undefined) return;
    if (!roots.has(sender.id) && typeof sender.once === 'function') {
      sender.once('destroyed', () => roots.delete(sender.id));
    }
    roots.set(sender.id, folderPath);
  }

  ipcMain.handle('workspace:open', (evt, folderPath) => {
    if (typeof folderPath !== 'string' || !folderPath) return false;
    if (!guard.isAllowed(folderPath)) {
      if (!getRecentFolders().includes(folderPath)) return false;
      guard.allow(folderPath);
    }
    addRecentFolder(folderPath);
    track(evt?.sender, folderPath);
    return true;
  });

  ipcMain.handle('workspace:close', (evt) => {
    if (evt?.sender) roots.set(evt.sender.id, null);
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
