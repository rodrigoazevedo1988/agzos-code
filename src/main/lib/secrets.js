/**
 * Cofre de segredos (API keys e tokens) sobre o safeStorage do Electron.
 * Sem dependência do Electron: recebe `safeStorage` por parâmetro.
 *
 * Arquivo: { [key]: base64(safeStorage.encryptString(valor)) }. Nunca grava texto puro.
 */

const fs = require('fs');

function createSecretStore({ filePath, safeStorage }) {
  function readAll() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  function writeAll(map) {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  function isAvailable() {
    return safeStorage.isEncryptionAvailable();
  }

  return {
    isAvailable,

    set(key, value) {
      if (!isAvailable()) throw new Error('Cofre do sistema indisponível');
      const map = readAll();
      map[key] = safeStorage.encryptString(value).toString('base64');
      writeAll(map);
    },

    get(key) {
      const map = readAll();
      if (!map[key]) return null;
      try {
        return safeStorage.decryptString(Buffer.from(map[key], 'base64'));
      } catch {
        // Chave do cofre mudou (ex.: usuário trocou de conta do SO)
        return null;
      }
    },

    has(key) {
      return Object.prototype.hasOwnProperty.call(readAll(), key);
    },

    delete(key) {
      const map = readAll();
      if (!(key in map)) return;
      delete map[key];
      writeAll(map);
    },
  };
}

module.exports = { createSecretStore };
