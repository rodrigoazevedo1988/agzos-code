/**
 * IPC da Vassoura de Produção (window.agzos.broom). Stub da Fase A: os canais existem
 * e respondem "não implementado"; o Agente V preenche.
 *
 * Canais: broom:analyzeFile(path) · broom:cleanFile(path, { editIds? }) ·
 *   broom:scanWorkspace(requestId) · broom:cleanWorkspace(requestId, paths) ·
 *   broom:cancel(requestId) · broom:undo(checkpointId)
 * Evento main → renderer: 'broom:event' (requestId, { type: 'progress'|'done'|'error', … }).
 *
 * deps: { guard, settingsStore, userDataDir, workerHost }
 */

const CHANNELS = ['analyzeFile', 'cleanFile', 'scanWorkspace', 'cleanWorkspace', 'cancel', 'undo'];

function register(ipcMain, _deps = {}) {
  for (const name of CHANNELS) {
    ipcMain.handle(`broom:${name}`, () => {
      throw new Error('Vassoura de Produção: ainda não implementado');
    });
  }
}

module.exports = { register, CHANNELS };
