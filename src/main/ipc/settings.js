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

function isDeepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && isDeepEqual(a[k], b[k]));
}

/**
 * Merge de 3 vias: aplica sobre `disk` só os campos em que `next` difere de todas as
 * `bases` (versões que a janela recebeu: load, save, avisos ainda em trânsito).
 * Campos que a janela não mexeu ficam como no disco, mesmo se outra janela os mudou.
 */
function applyChanges(disk, bases, next) {
  const out = isPlainObject(disk) ? { ...disk } : {};
  for (const [k, v] of Object.entries(next)) {
    const olds = bases.filter(isPlainObject).map((b) => b[k]);
    if (olds.some((b) => isDeepEqual(v, b))) continue;
    const objs = olds.filter(isPlainObject);
    out[k] = isPlainObject(v) && objs.length && isPlainObject(out[k]) ? applyChanges(out[k], objs, v) : v;
  }
  return out;
}

const MAX_BASES = 5;

/**
 * deps.listWebContents(): webContents das janelas abertas (para avisar as outras
 * com 'settings:changed'). Sem ele, não avisa ninguém (testes antigos).
 */
function register(ipcMain, { app, listWebContents = () => [] }) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  // webContents.id → versões que aquela janela recebeu (bases do merge). load/save
  // recomeçam a lista; avisos 'settings:changed' acrescentam (a janela pode salvar
  // antes de processar o aviso).
  // A janela confirma com 'settings:ack' (seq) depois de aplicar o aviso.
  const bases = new Map(); // id → [{ seq, snap }]
  let seq = 0;

  function remember(sender, settings, { append = false } = {}) {
    if (!sender || sender.id === undefined) return 0;
    if (!bases.has(sender.id) && typeof sender.once === 'function') {
      sender.once('destroyed', () => bases.delete(sender.id));
    }
    const list = append ? (bases.get(sender.id) || []) : [];
    const entry = { seq: ++seq, snap: structuredClone(settings) };
    bases.set(sender.id, [...list, entry].slice(-MAX_BASES));
    return entry.seq;
  }

  if (typeof ipcMain.on === 'function') {
    ipcMain.on('settings:ack', (evt, acked) => {
      const list = evt?.sender ? bases.get(evt.sender.id) : null;
      if (!list || typeof acked !== 'number') return;
      const rest = list.filter((e) => e.seq >= acked);
      if (rest.length) bases.set(evt.sender.id, rest);
    });
  }

  ipcMain.handle('settings:load', (evt) => {
    const s = loadSettings(settingsPath);
    remember(evt?.sender, s);
    return s;
  });
  // recentFolders é do main (ver ipc/workspace.js): mantém o valor do disco.
  // Perfis de IA também são do main (ver ipc/ai.js): o renderer guarda uma cópia
  // que pode estar velha, então perfis e perfil ativo vêm sempre do disco.
  // Seções ausentes no payload (ex.: `modules` numa cópia velha) ficam como no disco;
  // `modules` parcial é mesclado com o disco e normalizado.
  // Várias janelas: só os campos que esta janela mudou (vs. o que ela recebeu) vão
  // ao disco; as outras janelas recebem 'settings:changed' com o resultado.
  ipcMain.handle('settings:save', (evt, settings) => {
    const sender = evt?.sender;
    const disk = loadSettings(settingsPath);
    const { recentFolders, ai, github } = disk;
    const payload = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    const base = sender && sender.id !== undefined ? bases.get(sender.id) : undefined;
    const merged = base?.length ? applyChanges(disk, base.map((e) => e.snap), payload) : { ...disk, ...payload };
    const nextAi = { ...(merged.ai || {}), profiles: ai?.profiles || [], activeProfileId: ai?.activeProfileId ?? null };
    const modules = normalizeModules(base?.length ? merged.modules : mergeSection(disk.modules, payload.modules));
    // Contas GitHub são do main (ver ipc/github.js): mantém o valor do disco.
    const ok = saveSettings(settingsPath, { ...merged, recentFolders, ai: nextAi, github, modules });
    if (!ok) return ok;
    const saved = loadSettings(settingsPath);
    remember(sender, saved);
    const changed = !isDeepEqual(saved, disk);
    for (const wc of listWebContents()) {
      if (!wc || wc.isDestroyed?.()) continue;
      const self = sender && wc.id === sender.id;
      // A própria janela só recebe se o resultado difere do que ela mandou (campos de outra janela).
      if (self ? isDeepEqual(saved, payload) : !changed) continue;
      const n = remember(wc, saved, { append: !self });
      try { wc.send('settings:changed', saved, n); } catch { /* janela fechando */ }
    }
    return ok;
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
