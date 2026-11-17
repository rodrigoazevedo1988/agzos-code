/**
 * Restringe o acesso do IPC de arquivos às raízes liberadas
 * (pasta aberta, arquivo escolhido em diálogo).
 * Sem dependência do Electron.
 *
 * Raízes remotas (1.2.0): URIs `ssh://<authority>/<caminho>` aceitas por prefixo
 * da URI normalizada (POSIX, mesmo host). `..`, `%2e%2e`, barra dupla, `\` e NUL
 * são negados por parseRemoteUri. Symlinks do host não são resolvidos aqui.
 */

const fs = require('fs');
const path = require('path');
const { isRemote, parseRemoteUri, toRemoteUri, isWithinRemote } = require('../workspace/remote-uri');

function normRemote(p) {
  const r = parseRemoteUri(p);
  return r ? toRemoteUri(r.authority, r.path) : null;
}

function createPathGuard({
  platform = process.platform,
  realpath = (p) => fs.realpathSync.native(p),
} = {}) {
  const roots = new Set();
  const remoteRoots = new Set();

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
    if (isRemote(p)) {
      const uri = normRemote(p);
      if (!uri) return false;
      for (const root of remoteRoots) if (isWithinRemote(root, uri)) return true;
      return false;
    }
    if (typeof p !== 'string' || !p) return false;
    const target = resolveReal(p);
    for (const root of roots) {
      if (within(root, target)) return true;
    }
    return false;
  }

  return {
    allow(p) {
      if (isRemote(p)) {
        const uri = normRemote(p);
        if (!uri) throw new Error(`Caminho remoto inválido: ${p}`);
        remoteRoots.add(uri);
        return;
      }
      roots.add(resolveReal(p));
    },

    // Tira uma raiz liberada antes (ex.: pasta antiga ao trocar de pasta na janela).
    revoke(p) {
      if (isRemote(p)) { const uri = normRemote(p); if (uri) remoteRoots.delete(uri); return; }
      roots.delete(resolveReal(p));
    },

    isAllowed,

    // Retorna o caminho resolvido para o chamador usar no lugar do original.
    assertAllowed(p) {
      if (!isAllowed(p)) throw new Error(`Acesso negado: ${p}`);
      return isRemote(p) ? normRemote(p) : resolveReal(p);
    },

    roots() {
      return [...roots, ...remoteRoots];
    },
  };
}

module.exports = { createPathGuard };
