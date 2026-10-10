/**
 * IPC: abrir pasta como workspace (workspace:open).
 * Libera a pasta no guard só se ela já foi escolhida em diálogo ou está em recentFolders.
 * recentFolders é controlado só pelo main (settings:save ignora o valor vindo do renderer);
 * senão o renderer poderia gravar qualquer pasta ali e liberá-la.
 */

function register(ipcMain, { guard, getRecentFolders, addRecentFolder }) {
  ipcMain.handle('workspace:open', (_evt, folderPath) => {
    if (typeof folderPath !== 'string' || !folderPath) return false;
    if (!guard.isAllowed(folderPath)) {
      if (!getRecentFolders().includes(folderPath)) return false;
      guard.allow(folderPath);
    }
    addRecentFolder(folderPath);
    return true;
  });
}

module.exports = { register };
