/**
 * Restringe o acesso do IPC de arquivos às raízes liberadas
 * (pasta aberta, arquivo escolhido em diálogo).
 * Sem dependência do Electron.
 */

const fs = require('fs');
const path = require('path');

function createPathGuard({
  platform = process.platform,
  realpath = (p) => fs.realpathSync.native(p),
} = {}) {
  const roots = new Set();

  const norm = (p) => (platform === 'win32' ? p.toLowerCase() : p);

  // Resolve symlinks. Se o caminho não existe (arquivo novo), resolve o pai.
  function resolveReal(p) {
    const abs = path.resolve(p);
    try {
      return realpath(abs);
    } catch {
      const parent = path.dirname(abs);
      if (parent === abs) return abs;
      return path.join(resolveReal(parent), path.basename(abs));
    }
  }

  function within(root, target) {
    const r = norm(root).replace(/[\\/]+$/, '');
    const t = norm(target);
    return t === r || t.startsWith(r + path.sep);
  }

  function isAllowed(p) {
    const target = resolveReal(p);
    for (const root of roots) {
      if (within(root, target)) return true;
    }
    return false;
  }

  return {
    allow(p) {
      roots.add(resolveReal(p));
    },

    isAllowed,

    // Retorna o caminho resolvido para o chamador usar no lugar do original.
    assertAllowed(p) {
      if (!isAllowed(p)) throw new Error(`Acesso negado: ${p}`);
      return resolveReal(p);
    },

    roots() {
      return [...roots];
    },
  };
}

module.exports = { createPathGuard };
