/**
 * IPC do histórico local e do Git Slider (window.agzos.history).
 *
 * Canais (todos `history:*`):
 *   list(path) → [{ versionId: 'local:<id>', id, ts, size, origin }] (mais nova primeiro)
 *   timeline(path) → { items, git, truncated }     (commits + local, mais antiga primeiro;
 *                                                   ver modules/history/timeline.js)
 *   read(path, versionId) → { content }            (texto UTF-8; versionId local ou git)
 *   recordSave(path) → entry | null                (renderer chama após salvar)
 *   restore(path, versionId) → { checkpointId }    (escreve a versão; checkpoint + histórico)
 *   clear(path?) → { ok: true }
 *
 * Todo caminho passa pelo guard da janela que pediu (guardOf(event.sender)).
 * Leitura/escrita do arquivo e git via ./modules/history/io.js (troca local ↔ remoto na integração).
 * Conteúdo de commits: cache LRU de 50 MB por janela (descartado quando a janela fecha).
 * deps: { guard | guardFor, settingsStore, userDataDir, io? }
 */

const path = require('node:path');
const { createCheckpointStore } = require('../agent/checkpoints');
const { guardResolver } = require('../lib/window-guards');
const history = require('../modules/history');
const defaultIo = require('../modules/history/io');
const { buildTimeline, readVersion, createLru } = require('../modules/history/timeline');
const { normalizeModules } = require('../lib/settings');
const { runAsOwner, isRemote, providerFor } = require('../workspace/provider-for');

const CHANNELS = ['list', 'timeline', 'read', 'recordSave', 'restore', 'clear'];
const CACHE_BYTES = 50 * 1024 * 1024;

function register(ipcMain, { guard, guardFor, settingsStore, userDataDir, io = defaultIo } = {}) {
  const guardOf = guardResolver({ guard, guardFor });
  const loadSettings = () => settingsStore?.load?.() || {};
  history.configureHistory({ userDataDir, getSettings: loadSettings });
  const cpDir = userDataDir ? path.join(userDataDir, 'history-checkpoints') : undefined;
  const checkpoints = createCheckpointStore({ dir: cpDir, maxCount: 20 });

  const sliderOptions = () => normalizeModules(loadSettings().modules).gitSlider;

  // Por janela: cache LRU de conteúdos de commit + versionIds conhecidos por arquivo.
  const perWindow = new Map(); // webContents.id | null → { cache, known }
  function windowState(sender) {
    const id = sender && sender.id !== undefined ? sender.id : null;
    let st = perWindow.get(id);
    if (!st) {
      st = { cache: createLru({ maxBytes: CACHE_BYTES }), known: new Map() };
      perWindow.set(id, st);
      if (sender && typeof sender.once === 'function') sender.once('destroyed', () => perWindow.delete(id));
    }
    return st;
  }

  const store = () => {
    const s = history.getHistoryStore();
    if (!s) throw new Error('Histórico local indisponível');
    return s;
  };

  function filePath(sender, p) {
    if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('Caminho inválido');
    return guardOf(sender).assertAllowed(p);
  }

  function versionContent(sender, abs, versionId) {
    const { cache, known } = windowState(sender);
    return readVersion(abs, versionId, {
      store: history.getHistoryStore(), runGitFor: io.runGitFor, cache, known,
      maxCommits: sliderOptions().maxCommits,
    });
  }

  const handlers = {
    list: (sender, p) => store().list(filePath(sender, p))
      .map(({ id, ts, size, origin }) => ({ versionId: `local:${id}`, id, ts, size, origin })),

    timeline: async (sender, p) => {
      const abs = filePath(sender, p);
      const opts = sliderOptions();
      const tl = await buildTimeline(abs, {
        store: history.getHistoryStore(),
        runGitFor: opts.enabled ? io.runGitFor : null,
        maxCommits: opts.maxCommits,
      });
      windowState(sender).known.set(abs, new Set(tl.items.map((i) => i.versionId)));
      return tl;
    },

    read: async (sender, p, versionId) => {
      const abs = filePath(sender, p);
      return { content: (await versionContent(sender, abs, versionId)).toString('utf8') };
    },

    recordSave: async (sender, p) => {
      const abs = filePath(sender, p);
      if (!history.isEnabled()) return null;
      const buf = await io.readFileFor(abs);
      return history.recordBefore(abs, 'salvar', { content: buf });
    },

    restore: async (sender, p, versionId) => {
      const abs = filePath(sender, p);
      const buf = await versionContent(sender, abs, versionId);
      if (isRemote(abs)) {
        // Pasta remota: original lido no host vai ao histórico e ao checkpoint locais.
        const prov = providerFor(abs, sender);
        try { history.recordBefore(abs, 'externo', { content: await prov.readFile(abs) }); } catch { /* sumiu */ }
        const cp = checkpoints.create({ root: null });
        await cp.recordRemote(abs, prov);
        await io.writeFileFor(abs, buf);
        cp.noteRemote(abs, buf.toString('utf8'));
        cp.finalize();
        history.recordBefore(abs, 'restaurar', { content: buf });
        return { checkpointId: cp.id };
      }
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
    ipcMain.handle(`history:${name}`, async (e, ...args) => runAsOwner(e?.sender, () => handlers[name](e?.sender, ...args)));
  }
  return { handlers };
}

module.exports = { register, CHANNELS };
