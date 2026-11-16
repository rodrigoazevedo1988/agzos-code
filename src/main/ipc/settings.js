/**
 * IPC: configurações persistidas em userData/settings.json.
 */

const path = require('path');
const { loadSettings, saveSettings } = require('../lib/settings');

function register(ipcMain, { app }) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  ipcMain.handle('settings:load', () => loadSettings(settingsPath));
  // recentFolders é do main (ver ipc/workspace.js): mantém o valor do disco.
  // Perfis de IA também são do main (ver ipc/ai.js): o renderer guarda uma cópia
  // que pode estar velha, então perfis e perfil ativo vêm sempre do disco.
  ipcMain.handle('settings:save', (_evt, settings) => {
    const { recentFolders, ai } = loadSettings(settingsPath);
    const nextAi = { ...(settings?.ai || {}), profiles: ai?.profiles || [], activeProfileId: ai?.activeProfileId ?? null };
    return saveSettings(settingsPath, { ...settings, recentFolders, ai: nextAi });
  });
  ipcMain.handle('settings:import-vscode', (_evt, editor = 'vscode') => {
    const { importFromVSCode } = require('../lib/import-vscode');
    const res = importFromVSCode({ editor });
    if (res.ok && res.mapped) {
      const current = loadSettings(settingsPath);
      const merged = {
        ...current,
        ...res.mapped,
        editor: {
          ...(current.editor || {}),
          ...(res.mapped.editor || {}),
        },
      };
      saveSettings(settingsPath, merged);
      return { ok: true, imported: res.imported, path: res.path };
    }
    return res;
  });

  // Usado pelo main no boot (migrações), fora do IPC.
  return {
    settingsPath,
    load: () => loadSettings(settingsPath),
    save: (settings) => saveSettings(settingsPath, settings),
  };
}

module.exports = { register };
