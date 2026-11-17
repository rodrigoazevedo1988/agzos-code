/**
 * IPC: configurações persistidas em userData/settings.json.
 */

const path = require('path');
const { loadSettings, saveSettings, normalizeModules } = require('../lib/settings');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Mescla em profundidade (listas substituem). */
function mergeSection(base, over) {
  if (!isPlainObject(over)) return base;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSection(out[k], v) : v;
  }
  return out;
}

function register(ipcMain, { app }) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  ipcMain.handle('settings:load', () => loadSettings(settingsPath));
  // recentFolders é do main (ver ipc/workspace.js): mantém o valor do disco.
  // Perfis de IA também são do main (ver ipc/ai.js): o renderer guarda uma cópia
  // que pode estar velha, então perfis e perfil ativo vêm sempre do disco.
  // Seções ausentes no payload (ex.: `modules` numa cópia velha) ficam como no disco;
  // `modules` parcial é mesclado com o disco e normalizado.
  ipcMain.handle('settings:save', (_evt, settings) => {
    const disk = loadSettings(settingsPath);
    const { recentFolders, ai, github } = disk;
    const payload = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    const nextAi = { ...(payload.ai || {}), profiles: ai?.profiles || [], activeProfileId: ai?.activeProfileId ?? null };
    const modules = normalizeModules(mergeSection(disk.modules, payload.modules));
    // Contas GitHub são do main (ver ipc/github.js): mantém o valor do disco.
    return saveSettings(settingsPath, { ...disk, ...payload, recentFolders, ai: nextAi, github, modules });
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
