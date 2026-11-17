/**
 * IPC do histórico local e do Git Slider (window.agzos.history).
 *
 * Canais (todos `history:*`):
 *   list(path) → [{ versionId: 'local:<id>', id, ts, size, origin }] (mais nova primeiro)
 *   read(path, versionId) → { content }            (texto UTF-8)
 *   recordSave(path) → entry | null                (renderer chama após salvar)
 *   restore(path, versionId) → { checkpointId }    (escreve a versão; checkpoint + histórico)
 *   clear(path?) → { ok: true }
 *
 * Todo caminho passa pelo guard da janela que pediu (guardOf(event.sender)).
 * Leitura/escrita do arquivo via ./modules/history/io.js (troca local ↔ remoto na integração).
 * deps: { guard | guardFor, settingsStore, userDataDir, io? }
 */

const path = require('node:path');
const { createCheckpointStore } = require('../agent/checkpoints');
const { guardResolver } = require('../lib/window-guards');
const history = require('../modules/history');
const defaultIo = require('../modules/history/io');

const CHANNELS = ['list', 'read', 'recordSave', 'restore', 'clear'];
const LOCAL_RE = /^local:(\d{10,16}(?:-\d{1,4})?)$/;

function parseVersionId(versionId) {
  const m = typeof versionId === 'string' ? LOCAL_RE.exec(versionId) : null;
  if (!m) throw new Error('Versão inválida');
  return { kind: 'local', id: m[1] };
}

function register(ipcMain, { guard, guardFor, settingsStore, userDataDir, io = defaultIo } = {}) {
  const guardOf = guardResolver({ guard, guardFor });
  const loadSettings = () => settingsStore?.load?.() || {};
  history.configureHistory({ userDataDir, getSettings: loadSettings });
  const cpDir = userDataDir ? path.join(userDataDir, 'history-checkpoints') : undefined;
  const checkpoints = createCheckpointStore({ dir: cpDir, maxCount: 20 });

  const store = () => {
    const s = history.getHistoryStore();
    if (!s) throw new Error('Histórico local indisponível');
    return s;
  };

  function filePath(sender, p) {
    if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('Caminho inválido');
    return guardOf(sender).assertAllowed(p);
  }

  async function versionContent(abs, versionId) {
    const v = parseVersionId(versionId);
    return store().read(abs, v.id);
  }

  const handlers = {
    list: (sender, p) => store().list(filePath(sender, p))
      .map(({ id, ts, size, origin }) => ({ versionId: `local:${id}`, id, ts, size, origin })),

    read: async (sender, p, versionId) => {
      const abs = filePath(sender, p);
      return { content: (await versionContent(abs, versionId)).toString('utf8') };
    },

    recordSave: async (sender, p) => {
      const abs = filePath(sender, p);
      if (!history.isEnabled()) return null;
      const buf = await io.readFileFor(abs);
      return history.recordBefore(abs, 'salvar', { content: buf });
    },

    restore: async (sender, p, versionId) => {
      const abs = filePath(sender, p);
      const buf = await versionContent(abs, versionId);
      history.recordBefore(abs, 'externo');
      const cp = checkpoints.create({ root: path.dirname(abs) });
      cp.record(abs);
      await io.writeFileFor(abs, buf);
      cp.finalize();
      history.recordBefore(abs, 'restaurar', { content: buf });
      return { checkpointId: cp.id };
    },

    clear: (sender, p) => {
      store().clear(p === undefined || p === null ? undefined : filePath(sender, p));
      return { ok: true };
    },
  };

  for (const name of CHANNELS) {
    ipcMain.handle(`history:${name}`, async (e, ...args) => handlers[name](e?.sender, ...args));
  }
  return { handlers };
}

module.exports = { register, CHANNELS, parseVersionId };
