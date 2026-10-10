/**
 * IPC: abrir pasta como workspace (workspace:open).
 * Libera a pasta no guard só se ela já foi escolhida em diálogo ou está em recentFolders.
 */

function register(ipcMain, { guard, getRecentFolders }) {
  ipcMain.handle('workspace:open', (_evt, folderPath) => {
    if (typeof folderPath !== 'string' || !folderPath) return false;
    if (guard.isAllowed(folderPath)) return true;
    if (!getRecentFolders().includes(folderPath)) return false;
    guard.allow(folderPath);
    return true;
  });
}

module.exports = { register };
