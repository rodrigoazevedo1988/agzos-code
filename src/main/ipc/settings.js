/**
 * IPC: configurações persistidas em userData/settings.json.
 */

const path = require('path');
const { loadSettings, saveSettings } = require('../lib/settings');

function register(ipcMain, { app }) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  ipcMain.handle('settings:load', () => loadSettings(settingsPath));
  ipcMain.handle('settings:save', (_evt, settings) => saveSettings(settingsPath, settings));

  // Usado pelo main no boot (migrações), fora do IPC.
  return {
    settingsPath,
    load: () => loadSettings(settingsPath),
    save: (settings) => saveSettings(settingsPath, settings),
  };
}

module.exports = { register };
