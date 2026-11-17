/**
 * IPC: informações do app e links externos (app:*).
 */

const { openExternalSafe } = require('../lib/external-url');

function register(ipcMain, { app, shell, isDev, APP_NAME }) {
  ipcMain.handle('app:info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    isDev,
  }));

  // Só https:, http: e mailto: (lib/external-url.js).
  ipcMain.handle('app:openExternal', (_evt, url) => openExternalSafe(shell, url));
}

module.exports = { register };
