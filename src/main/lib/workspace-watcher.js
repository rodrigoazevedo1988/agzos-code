'use strict';

/**
 * Observa a pasta aberta em cada janela (fs.watch recursivo) e avisa o renderer
 * quais diretórios mudaram, para a árvore recarregar — como o VS Code faz.
 * Sem isso, um arquivo criado por outro programa (ex.: um download) não aparecia
 * numa pasta já lida.
 */

const fs = require('fs');
const path = require('path');

const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '__pycache__']);

/** true se a mudança deve ser ignorada (pastas pesadas ou internas). */
function isIgnoredChange(relative) {
  return String(relative || '').split(/[\\/]/).some((seg) => IGNORED_SEGMENTS.has(seg));
}

function createWorkspaceWatcher({ watchImpl = fs.watch, debounceMs = 250, send, log = console } = {}) {
  const watchers = new Map(); // ownerId → { watcher, root, pending:Set, timer }

  function unwatch(ownerId) {
    const w = watchers.get(ownerId);
    if (!w) return;
    clearTimeout(w.timer);
    try { w.watcher.close(); } catch { /* já fechado */ }
    watchers.delete(ownerId);
  }

  function flush(ownerId) {
    const w = watchers.get(ownerId);
    if (!w || !w.pending.size) return;
    const dirs = [...w.pending];
    w.pending.clear();
    send(ownerId, dirs);
  }

  function watch(ownerId, root) {
    unwatch(ownerId);
    if (!root) return false;
    let watcher;
    try {
      watcher = watchImpl(root, { recursive: true, persistent: false });
    } catch (err) {
      log.warn?.('[watcher] não foi possível observar a pasta:', err.message);
      return false;
    }
    const entry = { watcher, root, pending: new Set(), timer: null };
    watchers.set(ownerId, entry);
    watcher.on('change', (_type, filename) => {
      const rel = filename ? String(filename) : '';
      if (rel && isIgnoredChange(rel)) return;
      const dir = rel ? path.dirname(path.join(root, rel)) : root;
      entry.pending.add(dir);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => flush(ownerId), debounceMs);
    });
    watcher.on('error', (err) => {
      log.warn?.('[watcher] observação encerrada:', err.message);
      unwatch(ownerId);
    });
    return true;
  }

  return { watch, unwatch, size: () => watchers.size };
}

module.exports = { createWorkspaceWatcher, isIgnoredChange };
