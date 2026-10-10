/**
 * IPC: configurações persistidas em userData/settings.json.
 */

const path = require('path');
const fs = require('fs');

function register(ipcMain, { app }) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  function loadSettings() {
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
    } catch (e) {
      console.error('settings load error', e);
    }
    return {
      theme: 'agzos-dark',
      performanceMode: 'balanced', // economy | balanced | high
      aiProvider: null,
      aiApiKey: null,
      telemetry: false,
      fontSize: 14,
      recentFolders: [],
    };
  }

  function saveSettings(s) {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.error('settings save error', e);
      return false;
    }
  }

  ipcMain.handle('settings:load', () => loadSettings());
  ipcMain.handle('settings:save', (_evt, settings) => saveSettings(settings));
}

module.exports = { register };
