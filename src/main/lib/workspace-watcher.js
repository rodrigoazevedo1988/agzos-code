'use strict';

/**
 * Observa a pasta aberta em cada janela e avisa o renderer quais diretórios mudaram, para a
 * árvore recarregar — como o VS Code faz. Sem isso, um arquivo criado por outro programa
 * (ex.: um download) não aparecia numa pasta já lida.
 *
 * Windows/macOS: um fs.watch recursivo na raiz (nativo e eficiente).
 * Linux: o recursive do Node 20 percorre e observa a pasta inteira (inclusive node_modules),
 * podendo esgotar o inotify (ENOSPC) e gastar CPU no main. Lá cada janela observa, sem
 * recursive, só a raiz e as pastas que a árvore já leu (watchDir, chamado pelo fs:readDir),
 * até `maxDirs` pastas. ENOSPC/EMFILE desliga o observador daquela janela com aviso no log.
 *
 * API: watch(ownerId, root) · watchDir(ownerId, dir) · unwatch(ownerId) · size() · dirCount(ownerId)
 */

const fs = require('fs');
const path = require('path');

const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '__pycache__']);
const EXHAUSTED = new Set(['ENOSPC', 'EMFILE', 'ENFILE']);

/** true se a mudança deve ser ignorada (pastas pesadas ou internas). */
function isIgnoredChange(relative) {
  return String(relative || '').split(/[\\/]/).some((seg) => IGNORED_SEGMENTS.has(seg));
}

function createWorkspaceWatcher({
  watchImpl = fs.watch, debounceMs = 250, send, log = console, platform = process.platform, maxDirs = 2000,
} = {}) {
  const recursive = platform !== 'linux';
  // ownerId → { root, dirs: Map(dir → fs.FSWatcher), pending:Set, timer, limitWarned }
  const owners = new Map();

  function unwatch(ownerId) {
    const o = owners.get(ownerId);
    if (!o) return;
    clearTimeout(o.timer);
    for (const w of o.dirs.values()) {
      try { w.close(); } catch { /* já fechado */ }
    }
    owners.delete(ownerId);
  }

  function flush(ownerId) {
    const o = owners.get(ownerId);
    if (!o || !o.pending.size) return;
    const dirs = [...o.pending];
    o.pending.clear();
    send(ownerId, dirs);
  }

  function disable(ownerId, err) {
    log.warn?.('[watcher] observador de arquivos desligado nesta janela (limite do sistema):', err.code || '', err.message);
    unwatch(ownerId);
  }

  /** Abre um fs.watch em `dir` para o dono. → true | false (falhou; ENOSPC/EMFILE já desligou). */
  function addWatcher(ownerId, o, dir) {
    let w;
    try {
      w = watchImpl(dir, recursive ? { recursive: true, persistent: false } : { persistent: false });
    } catch (err) {
      if (EXHAUSTED.has(err.code) || /ENOSPC|EMFILE/.test(String(err.message))) disable(ownerId, err);
      else log.warn?.('[watcher] não foi possível observar a pasta:', err.message);
      return false;
    }
    o.dirs.set(dir, w);
    w.on('change', (_type, filename) => {
      const rel = filename ? String(filename) : '';
      if (rel && isIgnoredChange(rel)) return;
      o.pending.add(rel ? path.dirname(path.join(dir, rel)) : dir);
      clearTimeout(o.timer);
      o.timer = setTimeout(() => flush(ownerId), debounceMs);
    });
    w.on('error', (err) => {
      if (owners.get(ownerId) !== o) return;
      if (recursive || dir === o.root || EXHAUSTED.has(err?.code)) {
        if (EXHAUSTED.has(err?.code)) disable(ownerId, err);
        else {
          log.warn?.('[watcher] observação encerrada:', err?.message);
          unwatch(ownerId);
        }
        return;
      }
      // Subpasta apagada/inacessível: só larga aquele observador.
      try { w.close(); } catch { /* já fechado */ }
      o.dirs.delete(dir);
    });
    return true;
  }

  function watch(ownerId, root) {
    unwatch(ownerId);
    if (!root) return false;
    const o = { root: path.resolve(root), dirs: new Map(), pending: new Set(), timer: null, limitWarned: false };
    owners.set(ownerId, o);
    if (!addWatcher(ownerId, o, recursive ? root : o.root)) {
      owners.delete(ownerId);
      return false;
    }
    return true;
  }

  /** Linux: passa a observar `dir` (pasta já lida pela árvore). Outras plataformas: já coberto. */
  function watchDir(ownerId, dir) {
    const o = owners.get(ownerId);
    if (!o || typeof dir !== 'string' || !dir) return false;
    const abs = path.resolve(dir);
    const rel = path.relative(o.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    if (isIgnoredChange(rel)) return false;
    if (recursive || o.dirs.has(abs)) return true;
    if (o.dirs.size >= maxDirs) {
      if (!o.limitWarned) {
        o.limitWarned = true;
        log.warn?.(`[watcher] limite de ${maxDirs} pastas observadas atingido; as demais não atualizam sozinhas.`);
      }
      return false;
    }
    return addWatcher(ownerId, o, abs);
  }

  return {
    watch, watchDir, unwatch,
    size: () => owners.size,
    dirCount: (ownerId) => owners.get(ownerId)?.dirs.size || 0,
  };
}

module.exports = { createWorkspaceWatcher, isIgnoredChange };
