/**
 * File Tree (sidebar esquerda).
 *
 * Renderiza uma árvore lazy: lê diretório sob demanda ao expandir.
 * Suporta:
 *  - Click → seleciona
 *  - Double click → abre arquivo
 *  - Twisty → expande/colapsa
 *  - Right-click → context menu (renomear, excluir, novo…)
 *  - Drag & drop básico (sortable nos próximos passos)
 */

import { toast } from './toast.js';
import { openFile } from './editor.js';
import { renderTabs, focusTab } from './tabs.js';

const State = window.AgzosState;

const treeHost = () => document.getElementById('file-tree');
const emptyHost = () => document.getElementById('empty-explorer');
const contextMenu = () => document.getElementById('context-menu');

let treeRoot = null; // { name, path, isDirectory, children?, expanded? }

/* --------------------------------------------------------------------------
   Render
   -------------------------------------------------------------------------- */
function render() {
  const host = treeHost();
  host.innerHTML = '';
  if (!State.workspaceRoot) {
    host.hidden = true;
    emptyHost().hidden = false;
    return;
  }
  host.hidden = false;
  emptyHost().hidden = true;

  if (!treeRoot) {
    treeRoot = { name: basename(State.workspaceRoot), path: State.workspaceRoot, isDirectory: true, children: null, expanded: true };
  }
  host.appendChild(buildNode(treeRoot, 0));
}

function buildNode(node, depth) {
  const row = document.createElement('div');
  row.className = 'tree-node';
  row.dataset.path = node.path;
  row.dataset.isDir = String(node.isDirectory);
  row.style.paddingLeft = `${4 + depth * 14}px`;

  if (State.files.get(node.path)?.path === node.path && !node.isDirectory) {
    // (opcional) realce do arquivo aberto
  }

  const twisty = document.createElement('span');
  twisty.className = 'twisty';
  twisty.textContent = node.isDirectory ? (node.expanded ? '▾' : '▸') : '';
  row.appendChild(twisty);

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = node.isDirectory
    ? (node.expanded ? '📂' : '📁')
    : iconForFile(node.name);
  row.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = node.name;
  row.appendChild(name);

  // Click
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    if (node.isDirectory) toggleDir(node, row);
    else selectAndOpen(node);
  });

  row.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (node.isDirectory) {
      toggleDir(node, row);
    } else {
      openFile(node.path);
    }
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, node);
  });

  // filhos
  if (node.isDirectory && node.expanded && node.children) {
    const frag = document.createDocumentFragment();
    for (const child of node.children) {
      frag.appendChild(buildNode(child, depth + 1));
    }
    row.appendChild(frag);
  }
  return row;
}

function selectAndOpen(node) {
  document.querySelectorAll('.tree-node.selected').forEach((n) => n.classList.remove('selected'));
  const el = treeHost().querySelector(`.tree-node[data-path="${cssEscape(node.path)}"]`);
  if (el) el.classList.add('selected');
  // double click já abre; single click só seleciona
}

async function toggleDir(node, rowEl) {
  if (!node.isDirectory) return;
  if (node.expanded) {
    node.expanded = false;
    render();
    return;
  }
  // Expande — carrega filhos se ainda não tem
  if (!node.children) {
    try {
      const items = await window.agzos.fs.readDir(node.path);
      node.children = items
        .map((it) => ({ name: it.name, path: it.path, isDirectory: it.isDirectory, children: null, expanded: false }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch (e) {
      toast(`Erro ao ler pasta: ${e.message}`, 'error');
      return;
    }
  }
  node.expanded = true;
  render();
}

/* --------------------------------------------------------------------------
   Context menu
   -------------------------------------------------------------------------- */
function showContextMenu(x, y, node) {
  const m = contextMenu();
  m.hidden = false;
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  m.dataset.targetPath = node.path;
  m.dataset.targetIsDir = String(node.isDirectory);
}

document.addEventListener('click', () => {
  contextMenu().hidden = true;
});

contextMenu().addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  const m = contextMenu();
  const target = m.dataset.targetPath;
  const isDir = m.dataset.targetIsDir === 'true';
  m.hidden = true;

  try {
    if (action === 'rename') {
      const newName = prompt('Novo nome:', basename(target));
      if (!newName || newName === basename(target)) return;
      const newPath = joinPath(dirname(target), newName);
      await window.agzos.fs.rename(target, newPath);
      // Atualiza paths em State.files
      for (const [p, f] of State.files) {
        if (p === target) State.files.set(newPath, f);
        else if (p.startsWith(target + sep())) {
          const replaced = newPath + p.slice(target.length);
          const v = State.files.get(p);
          State.files.delete(p);
          State.files.set(replaced, { ...v, path: replaced });
        }
      }
      invalidateTree(); toast('Renomeado', 'success'); render();
    } else if (action === 'delete') {
      if (!confirm(`Excluir "${basename(target)}"?`)) return;
      await window.agzos.fs.delete(target);
      invalidateTree(); toast('Excluído', 'success'); render();
    } else if (action === 'new-file') {
      const name = prompt('Nome do arquivo:');
      if (!name) return;
      const newPath = joinPath(target, name);
      await window.agzos.fs.writeFile(newPath, '');
      invalidateTree(); render();
      openFile(newPath);
    } else if (action === 'new-folder') {
      const name = prompt('Nome da pasta:');
      if (!name) return;
      const newPath = joinPath(target, name);
      await window.agzos.fs.mkdir(newPath);
      invalidateTree(); render();
    } else if (action === 'reveal') {
      window.agzos.app.openExternal('file://' + target);
    }
  } catch (err) {
    toast(`Erro: ${err.message}`, 'error');
  }
});

function invalidateTree() {
  treeRoot = null;
  for (const k of State.expandedDirs) { /* manter para futuro */ }
}

/* --------------------------------------------------------------------------
   Public API
   -------------------------------------------------------------------------- */
export async function openWorkspace(folderPath) {
  const allowed = await window.agzos.workspace.open(folderPath);
  if (!allowed) {
    toast('Abra a pasta pelo diálogo.', 'error');
    return;
  }
  State.workspaceRoot = folderPath;
  treeRoot = null;
  document.getElementById('topbar-workspace').textContent = `— ${basename(folderPath)}`;
  render();
}

export function refreshTree() {
  treeRoot = null;
  render();
}

export function getCurrentDir() {
  return State.workspaceRoot;
}

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
function basename(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}
function dirname(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join(sep()) || sep();
}
function joinPath(a, b) { return a.replace(/[\\/]+$/, '') + sep() + b.replace(/^[\\/]+/, ''); }
function sep() { return navigator.userAgent.includes('Windows') || window.agzos?.app?.info?.()?.platform === 'win32' ? '\\' : '/'; }
function iconForFile(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    js: '🟨', mjs: '🟨', cjs: '🟨', ts: '🟦', tsx: '🟦', jsx: '🟨',
    json: '🟩', md: '📝', html: '🌐', css: '🎨', scss: '🎨', less: '🎨',
    py: '🐍', rb: '💎', go: '🐹', rs: '🦀', java: '☕', php: '🐘',
    sh: '🐚', bash: '🐚', zsh: '🐚', ps1: '🔵',
    yml: '⚙️', yaml: '⚙️', toml: '⚙️', xml: '📰',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', ico: '🖼️',
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
    zip: '🗜️', tar: '🗜️', gz: '🗜️', rar: '🗜️', '7z': '🗜️',
    gitignore: '⚪', env: '🔐',
  };
  return map[ext] || '📄';
}
function cssEscape(s) {
  return s.replace(/[\\"]/g, '\\$&');
}
