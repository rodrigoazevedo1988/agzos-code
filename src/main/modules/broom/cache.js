/**
 * Cache de análise da Vassoura (no main, em memória): LRU por
 * `path|mtimeMs|size|rulesHash`. Invalidado ao salvar o arquivo e quando as regras mudam
 * (o hash das regras entra na chave).
 */

const crypto = require('crypto');

function createAnalysisCache({ max = 200 } = {}) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value);
    },
    invalidate(filePath) {
      const prefix = `${filePath}|`;
      for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key);
    },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}

function cacheKey(filePath, stat, hash) {
  return `${filePath}|${stat.mtimeMs}|${stat.size}|${hash}`;
}

/** Hash estável das opções que afetam o resultado da análise. */
function rulesHash(options = {}) {
  const r = options.rules || {};
  const payload = JSON.stringify([
    ['console', 'comments', 'unusedImports', 'deadCode'].map((k) => r[k] !== false),
    [...(options.keepConsole || [])].sort(),
    [...(options.keepComments || [])].sort(),
  ]);
  return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 12);
}

module.exports = { createAnalysisCache, cacheKey, rulesHash };
