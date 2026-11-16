/**
 * Decorações de status git na árvore de arquivos (cor por status).
 * Sem dependências: file-tree.js consulta `gitStatusFor(path)` ao renderizar,
 * git-panel.js chama `setGitDecorations()` a cada atualização de status.
 */

const map = new Map(); // caminho normalizado → 'modified' | 'added' | 'untracked' | 'deleted' | 'conflict' | 'renamed' | 'dir'

const norm = (p) => {
  const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(s) ? s.toLowerCase() : s;
};

function kindOf(f) {
  if (f.conflicted) return 'conflict';
  if (f.untracked) return 'untracked';
  const letters = `${f.index}${f.worktree}`;
  if (letters.includes('D')) return 'deleted';
  if (letters.includes('A')) return 'added';
  if (letters.includes('R')) return 'renamed';
  return 'modified';
}

/**
 * status: resultado de git:status. workspaceRoot: pasta aberta (pode ser subpasta do repo).
 */
export function setGitDecorations(status, workspaceRoot) {
  map.clear();
  if (status && !status.notRepo && workspaceRoot) {
    const prefix = status.prefix || '';
    const base = norm(workspaceRoot);
    const files = [...(status.conflicts || []), ...(status.staged || []), ...(status.changes || [])];
    for (const f of files) {
      if (!f.path.startsWith(prefix)) continue;
      const rel = f.path.slice(prefix.length);
      const abs = `${base}/${rel}`;
      const kind = kindOf(f);
      // Conflito > não rastreado/novo > modificado: o primeiro que chegar mantém prioridade
      if (!map.has(abs) || kind === 'conflict') map.set(abs, kind);
      const parts = rel.split('/');
      parts.pop();
      let dir = base;
      for (const part of parts) {
        dir = `${dir}/${part}`;
        if (!map.has(dir)) map.set(dir, 'dir');
      }
    }
  }
  applyToDom();
}

export function gitStatusFor(p) {
  return map.get(norm(p)) || null;
}

export function applyToDom(root = document.getElementById('file-tree')) {
  if (!root) return;
  root.querySelectorAll('.tree-node[data-path]').forEach((row) => {
    const kind = map.get(norm(row.dataset.path));
    if (kind) row.dataset.git = kind;
    else delete row.dataset.git;
  });
}
