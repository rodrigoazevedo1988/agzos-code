/**
 * IPC do Cofre .env (window.agzos.envVault). Stub da Fase A: os canais existem
 * e respondem "não implementado"; o Agente C preenche.
 *
 * Canais: envvault:list · reveal(path, key) · setValue(path, key, value) · addKey(path, key, value) ·
 *   removeKey(path, key) · generateExample(path) · copy(path, key) · scanStaged ·
 *   installHook · removeHook · hookStatus · gitignoreStatus · addToGitignore
 * Valores de .env só saem do main por envvault:reveal.
 *
 * deps: { guard, settingsStore, userDataDir, workerHost }
 */

const CHANNELS = [
  'list', 'reveal', 'setValue', 'addKey', 'removeKey', 'generateExample', 'copy', 'scanStaged',
  'installHook', 'removeHook', 'hookStatus', 'gitignoreStatus', 'addToGitignore',
];

function register(ipcMain, _deps = {}) {
  for (const name of CHANNELS) {
    ipcMain.handle(`envvault:${name}`, () => {
      throw new Error('Cofre .env: ainda não implementado');
    });
  }
}

module.exports = { register, CHANNELS };
