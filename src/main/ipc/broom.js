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
 * Todo caminho passa pelo path-guard da janela que pediu (guardFor(sender)); raiz padrão =
 * pasta daquela janela (getWindowRoot(sender)). broom:undo só vale para a janela que criou o
 * checkpoint (checkpointId → webContents.id), com cada caminho passando pelo guard dela. deps: { guard | guardFor, getWindowRoot?,
 * settingsStore, userDataDir, workerHost }
 */

const fs = require('fs');
const path = require('path');
const { createCheckpointStore } = require('../agent/checkpoints');
const {
  createBroomEngine, optionsFromSettings, summarize, setDefaultEngine,
} = require('../modules/broom/engine');
const { guardResolver } = require('../lib/window-guards');
const { recordBefore } = require('../modules/history');
const { runAsOwner, providerFor, isRemote } = require('../workspace/provider-for');

const CHANNELS = ['analyzeFile', 'cleanFile', 'scanWorkspace', 'cleanWorkspace', 'cancel', 'undo'];

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function register(ipcMain, {
  guard, guardFor, getWindowRoot, settingsStore, userDataDir, workerHost,
  engine = createBroomEngine({ workerHost }),
  checkpoints = createCheckpointStore({ dir: userDataDir ? path.join(userDataDir, 'broom-checkpoints') : null, maxCount: 20 }),
} = {}) {
  // Pasta remota: a janela que pediu é a dona das leituras/escritas pelo provider SSH.
  const rawIpc = ipcMain;
  ipcMain = { handle: (ch, fn) => rawIpc.handle(ch, (event, ...args) => runAsOwner(event?.sender, () => fn(event, ...args))) };
  setDefaultEngine(engine, () => settingsStore.load());
  const running = new Map();
  const guardOf = guardResolver({ guard, guardFor });
  const owners = new Map(); // checkpointId → webContents.id
  const senderId = (sender) => (sender && sender.id !== undefined ? sender.id : null);
  const own = (id, sender) => {
    owners.set(id, senderId(sender));
    while (owners.size > 200) owners.delete(owners.keys().next().value);
  };

  function options() {
    const o = optionsFromSettings(settingsStore.load());
    if (!o.enabled) throw new Error('A Vassoura de Produção está desabilitada nas Configurações.');
    return o;
  }

  function resolve(sender, p) {
    if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('Caminho inválido');
    return guardOf(sender).assertAllowed(p);
  }

  function getRoot(sender, explicit) {
    const candidates = [];
    if (typeof explicit === 'string' && explicit) candidates.push(explicit);
    if (typeof getWindowRoot === 'function') {
      const own = sender ? getWindowRoot(sender) : null;
      if (typeof own === 'string' && own) candidates.push(own);
    } else {
      const recent = settingsStore.load().recentFolders;
      if (Array.isArray(recent) && typeof recent[0] === 'string') candidates.push(recent[0]);
    }
    const g = guardOf(sender);
    for (const c of candidates) {
      if (isRemote(c)) { if (g.isAllowed(c)) return g.assertAllowed(c); continue; }
      if (path.isAbsolute(c) && g.isAllowed(c) && isDirectory(c)) return g.assertAllowed(c);
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

  ipcMain.handle('broom:analyzeFile', async (event, filePath) => {
    const abs = resolve(event?.sender, filePath);
    const { result } = await engine.analyzeFile(abs, options());
    return summarize(result);
  });

  ipcMain.handle('broom:cleanFile', async (event, filePath, opts = {}) => {
    const abs = resolve(event?.sender, filePath);
    const editIds = Array.isArray(opts?.editIds) ? opts.editIds : undefined;
    const p = await engine.plan(abs, options(), { editIds });
    if (!p.edits.length) return { checkpointId: null, removed: 0, ...(p.error ? { error: p.error } : {}) };
    const cp = checkpoints.create({ root: isRemote(abs) ? null : path.dirname(abs) });
    const original = await checkpointBefore(cp, abs, event?.sender);
    recordBefore(abs, 'vassoura', original ? { content: original } : undefined);
    await engine.write(abs, p.text, p.after);
    if (isRemote(abs)) cp.noteRemote(abs, p.after);
    cp.finalize();
    own(cp.id, event?.sender);
    fileChanged(event.sender, abs);
    return { checkpointId: cp.id, removed: p.edits.length };
  });

  ipcMain.handle('broom:scanWorkspace', async (event, requestId, root) => {
    const { signal, done } = track(requestId);
    try {
      const dir = getRoot(event?.sender, root);
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
    const abs = paths.map((p) => resolve(event?.sender, p)); // valida tudo antes de alterar qualquer arquivo
    const opts = options();
    const { signal, done } = track(requestId);
    const cp = checkpoints.create({ root: getRootOrNull(event?.sender) });
    let files = 0;
    let removed = 0;
    try {
      for (let i = 0; i < abs.length; i++) {
        if (signal.aborted) break;
        const p = await engine.plan(abs[i], opts);
        if (p.edits.length) {
          const original = await checkpointBefore(cp, abs[i], event?.sender);
          recordBefore(abs[i], 'vassoura', original ? { content: original } : undefined);
          await engine.write(abs[i], p.text, p.after);
          if (isRemote(abs[i])) cp.noteRemote(abs[i], p.after);
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
    if (files) own(cp.id, event?.sender);
    const result = { checkpointId: files ? cp.id : null, files, removed };
    emit(event.sender, requestId, { type: 'done', ...result });
    return result;
  });

  /** Original no checkpoint (local) antes de gravar; remoto lido pelo provider da janela. */
  // → Buffer original no remoto (para o histórico local), null no disco local.
  async function checkpointBefore(cp, abs, sender) {
    if (!isRemote(abs)) { cp.record(abs); return null; }
    const prov = providerFor(abs, sender);
    await cp.recordRemote(abs, prov);
    try { return await prov.readFile(abs); } catch { return null; }
  }

  function getRootOrNull(sender) {
    try { return getRoot(sender); } catch { return null; }
  }

  ipcMain.handle('broom:cancel', (_event, requestId) => {
    const ac = running.get(String(requestId));
    if (!ac) return false;
    ac.abort();
    running.delete(String(requestId));
    return true;
  });

  ipcMain.handle('broom:undo', async (event, checkpointId) => {
    if (owners.has(checkpointId) && owners.get(checkpointId) !== senderId(event?.sender)) {
      return { restored: [], errors: [{ path: null, message: 'Este checkpoint pertence a outra janela.' }] };
    }
    let r;
    try {
      const g = guardOf(event?.sender);
      r = await checkpoints.undoAsync(checkpointId, { assertPath: (p) => g.assertAllowed(p), providerFor: (p) => providerFor(p, event?.sender) });
    } catch (err) { return { restored: [], errors: [{ path: null, message: err.message }] }; }
    if (!r.errors.length || r.restored.length) owners.delete(checkpointId);
    for (const p of r.restored) {
      engine.invalidate(p);
      fileChanged(event.sender, p);
    }
    return r;
  });

  return { engine, checkpoints };
}

module.exports = { register, CHANNELS };
