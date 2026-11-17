/**
 * IPC da Vassoura de Produção (window.agzos.broom).
 *
 * Canais: broom:analyzeFile(path) → { count, byRule, edits, error? }
 *   broom:cleanFile(path, { editIds? }) → { checkpointId, removed, error? }
 *   broom:scanWorkspace(requestId, root?) → { files, truncated, cancelled }
 *   broom:cleanWorkspace(requestId, paths) → { checkpointId, files, removed }
 *   broom:cancel(requestId) → boolean · broom:undo(checkpointId) → { restored, errors }
 * Evento main → renderer: 'broom:event' (requestId, { type: 'progress'|'done'|'error', … }).
 * Arquivos alterados avisam o editor pelo mesmo evento do agente
 * ('agent:event' { type: 'file_changed', path }), que recarrega a aba ou mostra o conflito.
 *
 * Todo caminho passa pelo path-guard. deps: { guard, settingsStore, userDataDir, workerHost }
 */

const fs = require('fs');
const path = require('path');
const { createCheckpointStore } = require('../agent/checkpoints');
const {
  createBroomEngine, optionsFromSettings, summarize, setDefaultEngine,
} = require('../modules/broom/engine');

const CHANNELS = ['analyzeFile', 'cleanFile', 'scanWorkspace', 'cleanWorkspace', 'cancel', 'undo'];

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function register(ipcMain, {
  guard, settingsStore, userDataDir, workerHost,
  engine = createBroomEngine({ workerHost }),
  checkpoints = createCheckpointStore({ dir: userDataDir ? path.join(userDataDir, 'broom-checkpoints') : null, maxCount: 20 }),
} = {}) {
  setDefaultEngine(engine);
  const running = new Map();

  function options() {
    const o = optionsFromSettings(settingsStore.load());
    if (!o.enabled) throw new Error('A Vassoura de Produção está desabilitada nas Configurações.');
    return o;
  }

  function resolve(p) {
    if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('Caminho inválido');
    return guard.assertAllowed(p);
  }

  function getRoot(explicit) {
    const candidates = [];
    if (typeof explicit === 'string' && explicit) candidates.push(explicit);
    const recent = settingsStore.load().recentFolders;
    if (Array.isArray(recent) && typeof recent[0] === 'string') candidates.push(recent[0]);
    for (const c of candidates) {
      if (path.isAbsolute(c) && guard.isAllowed(c) && isDirectory(c)) return guard.assertAllowed(c);
    }
    throw new Error('Abra uma pasta de projeto para usar a Vassoura.');
  }

  const emit = (sender, requestId, evt) => {
    if (!sender.isDestroyed()) sender.send('broom:event', requestId, evt);
  };
  const fileChanged = (sender, abs) => {
    if (!sender.isDestroyed()) sender.send('agent:event', 'broom', { type: 'file_changed', path: abs });
  };

  function track(requestId) {
    const id = String(requestId);
    running.get(id)?.abort();
    const ac = new AbortController();
    running.set(id, ac);
    return { signal: ac.signal, done: () => { if (running.get(id) === ac) running.delete(id); } };
  }

  ipcMain.handle('broom:analyzeFile', async (_event, filePath) => {
    const abs = resolve(filePath);
    const { result } = await engine.analyzeFile(abs, options());
    return summarize(result);
  });

  ipcMain.handle('broom:cleanFile', async (event, filePath, opts = {}) => {
    const abs = resolve(filePath);
    const editIds = Array.isArray(opts?.editIds) ? opts.editIds : undefined;
    const p = await engine.plan(abs, options(), { editIds });
    if (!p.edits.length) return { checkpointId: null, removed: 0, ...(p.error ? { error: p.error } : {}) };
    const cp = checkpoints.create({ root: path.dirname(abs) });
    cp.record(abs);
    await engine.write(abs, p.text, p.after);
    cp.finalize();
    fileChanged(event.sender, abs);
    return { checkpointId: cp.id, removed: p.edits.length };
  });

  ipcMain.handle('broom:scanWorkspace', async (event, requestId, root) => {
    const { signal, done } = track(requestId);
    try {
      const dir = getRoot(root);
      const r = await engine.scan(dir, options(), {
        signal,
        onProgress: (p) => emit(event.sender, requestId, { type: 'progress', ...p }),
      });
      emit(event.sender, requestId, { type: 'done', ...r });
      return r;
    } catch (err) {
      emit(event.sender, requestId, { type: 'error', message: err.message });
      throw err;
    } finally { done(); }
  });

  ipcMain.handle('broom:cleanWorkspace', async (event, requestId, paths) => {
    if (!Array.isArray(paths)) throw new Error('Lista de arquivos inválida');
    const abs = paths.map(resolve); // valida tudo antes de alterar qualquer arquivo
    const opts = options();
    const { signal, done } = track(requestId);
    const cp = checkpoints.create({ root: getRootOrNull() });
    let files = 0;
    let removed = 0;
    try {
      for (let i = 0; i < abs.length; i++) {
        if (signal.aborted) break;
        const p = await engine.plan(abs[i], opts);
        if (p.edits.length) {
          cp.record(abs[i]);
          await engine.write(abs[i], p.text, p.after);
          files++;
          removed += p.edits.length;
          fileChanged(event.sender, abs[i]);
        }
        emit(event.sender, requestId, { type: 'progress', done: i + 1, total: abs.length, path: abs[i] });
      }
    } finally {
      cp.finalize();
      done();
    }
    const result = { checkpointId: files ? cp.id : null, files, removed };
    emit(event.sender, requestId, { type: 'done', ...result });
    return result;
  });

  function getRootOrNull() {
    try { return getRoot(); } catch { return null; }
  }

  ipcMain.handle('broom:cancel', (_event, requestId) => {
    const ac = running.get(String(requestId));
    if (!ac) return false;
    ac.abort();
    running.delete(String(requestId));
    return true;
  });

  ipcMain.handle('broom:undo', (event, checkpointId) => {
    let r;
    try { r = checkpoints.undo(checkpointId); } catch (err) { return { restored: [], errors: [{ path: null, message: err.message }] }; }
    for (const p of r.restored) {
      engine.invalidate(p);
      fileChanged(event.sender, p);
    }
    return r;
  });

  return { engine, checkpoints };
}

module.exports = { register, CHANNELS };
