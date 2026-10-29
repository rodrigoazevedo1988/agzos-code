/**
 * File Tree (sidebar esquerda).
 *
 * Renderiza uma árvore de arquivos e diretórios em lista vertical indentada.
 * Suporta:
 *  - Click → seleciona e abre arquivo
 *  - Double click → abre arquivo / expande pasta
 *  - Twisty → expande/colapsa diretório
 *  - Right-click → context menu (renomear, excluir, novo arquivo, nova pasta…)
 *  - Temas de ícones integrados (Lucide colorido, minimalista, badges e emojis)
 */

import { toast } from './toast.js';
import { openFile, handleDeletedPath } from './editor.js';
import { renderTabs } from './tabs.js';
import { showInputDialog } from './dialog.js';
import { renderFileIcon, renderFolderIcon } from './icon-theme.js';

const State = window.AgzosState;

const HIDDEN_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.cache', 'coverage', '.next', '.nuxt',
]);

const treeHost = () => document.getElementById('file-tree');
const emptyHost = () => document.getElementById('empty-explorer');
const contextMenu = () => document.getElementById('context-menu');

let treeRoot = null; // { name, path, isDirectory, children?, expanded? }

/* --------------------------------------------------------------------------
   Render
   -------------------------------------------------------------------------- */
export function render() {
  const host = treeHost();
  if (!host) return;
  host.replaceChildren();

  if (!State.workspaceRoot) {
    host.hidden = true;
    const empty = emptyHost();
    if (empty) empty.hidden = false;
    return;
  }
  host.hidden = false;
  const empty = emptyHost();
  if (empty) empty.hidden = true;

  if (!treeRoot) {
    treeRoot = {
      name: basename(State.workspaceRoot),
      path: State.workspaceRoot,
      isDirectory: true,
      children: null,
      expanded: true,
    };
    if (window.agzos?.fs?.readDir) {
      window.agzos.fs.readDir(State.workspaceRoot).then((items) => {
        if (!treeRoot) return;
        treeRoot.children = mapItems(items);
        render();
      }).catch((e) => console.error('Erro ao ler pasta raiz:', e));
    }
  }

  host.appendChild(buildNode(treeRoot, 0));
}

function buildNode(node, depth) {
  const container = document.createElement('div');
  container.className = 'tree-item';
  container.dataset.path = node.path;
  container.dataset.isDir = String(node.isDirectory);

  const row = document.createElement('div');
  row.className = 'tree-node tree-row';
  row.dataset.path = node.path;
  row.dataset.isDir = String(node.isDirectory);
  row.style.paddingLeft = `${6 + depth * 14}px`;
  row.title = node.path;

  if (State.activePath === node.path && !node.isDirectory) {
    row.classList.add('selected', 'active-file');
  }

  // Twisty (indicador de expansão para pastas, espaçador alinhado para arquivos)
  const twisty = document.createElement('span');
  twisty.className = 'twisty';
  if (node.isDirectory) {
    twisty.textContent = node.expanded ? '▾' : '▸';
    twisty.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDir(node);
    });
  } else {
    twisty.textContent = '';
  }
  row.appendChild(twisty);

  // Ícone estilizado conforme tema selecionado
  const currentTheme = State.settings?.iconTheme || 'lucide-color';
  const icon = node.isDirectory
    ? renderFolderIcon(node.expanded, node.name, currentTheme)
    : renderFileIcon(node.name, currentTheme);
  row.appendChild(icon);

  // Nome do arquivo ou pasta
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = node.name;
  row.appendChild(name);

  // Click na linha
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    if (node.isDirectory) {
      toggleDir(node);
    } else {
      selectAndOpen(node);
    }
  });

  row.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (node.isDirectory) {
      toggleDir(node);
    } else {
      openFile(node.path);
    }
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, node);
  });

  container.appendChild(row);

  // Filhos renderizados verticalmente abaixo do item pai
  if (node.isDirectory && node.expanded && node.children) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    for (const child of node.children) {
      childrenContainer.appendChild(buildNode(child, depth + 1));
    }
    container.appendChild(childrenContainer);
  }

  return container;
}

function selectAndOpen(node) {
  document.querySelectorAll('.tree-node.selected, .tree-row.selected').forEach((n) => n.classList.remove('selected'));
  const el = treeHost()?.querySelector(`.tree-node[data-path="${cssEscape(node.path)}"], .tree-row[data-path="${cssEscape(node.path)}"]`);
  if (el) el.classList.add('selected');
  openFile(node.path);
}

export function highlightActiveFile(filePath) {
  document.querySelectorAll('.tree-node.selected, .tree-row.selected').forEach((n) => n.classList.remove('selected', 'active-file'));
  if (!filePath) return;
  const el = treeHost()?.querySelector(`.tree-node[data-path="${cssEscape(filePath)}"], .tree-row[data-path="${cssEscape(filePath)}"]`);
  if (el) el.classList.add('selected', 'active-file');
}

async function toggleDir(node) {
  if (!node.isDirectory) return;
  if (node.expanded) {
    node.expanded = false;
    State.expandedDirs.delete(node.path);
    render();
    return;
  }
  // Expande — carrega filhos se ainda não tem
  if (!node.children) {
    try {
      const items = await window.agzos.fs.readDir(node.path);
      node.children = mapItems(items);
    } catch (e) {
      toast(`Erro ao ler pasta: ${e.message}`, 'error');
      return;
    }
  }
  node.expanded = true;
  State.expandedDirs.add(node.path);
  render();
}

/* --------------------------------------------------------------------------
   Context menu
   -------------------------------------------------------------------------- */
function showContextMenu(x, y, node) {
  const m = contextMenu();
  if (!m) return;
  m.hidden = false;
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  m.dataset.targetPath = node.path;
  m.dataset.targetIsDir = String(node.isDirectory);
}

document.addEventListener('click', () => {
  const m = contextMenu();
  if (m) m.hidden = true;
});

const ctx = contextMenu();
if (ctx) {
  ctx.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    const m = contextMenu();
    const target = m.dataset.targetPath;
    const isDir = m.dataset.targetIsDir === 'true';
    m.hidden = true;

    try {
      if (action === 'rename') {
        const newName = await showInputDialog({
          title: 'Renomear',
          label: `Novo nome para "${basename(target)}"`,
          value: basename(target),
          confirmLabel: 'Renomear',
          validate: validateEntryName,
        });
        if (!newName || newName === basename(target)) return;
        const newPath = joinPath(dirname(target), newName);
        if (await window.agzos.fs.exists(newPath)) {
          toast('Já existe um arquivo ou pasta com esse nome.', 'error');
          return;
        }
        await window.agzos.fs.rename(target, newPath);
        renameOpenPaths(target, newPath);
        invalidateTree();
        toast('Renomeado', 'success');
        render();
      } else if (action === 'delete') {
        if (!confirm(`Excluir "${basename(target)}"?`)) return;
        await window.agzos.fs.delete(target);
        handleDeletedPath(target);
        invalidateTree();
        toast('Excluído', 'success');
        render();
      } else if (action === 'new-file') {
        const name = await showInputDialog({
          title: 'Novo arquivo',
          label: `Criar dentro de "${basename(isDir ? target : dirname(target))}"`,
          placeholder: 'ex.: index.js',
          confirmLabel: 'Criar arquivo',
          validate: validateEntryName,
        });
        if (!name) return;
        const parentDir = isDir ? target : dirname(target);
        const newPath = joinPath(parentDir, name);
        if (await window.agzos.fs.exists(newPath)) {
          toast('Já existe um arquivo ou pasta com esse nome.', 'error');
          return;
        }
        await window.agzos.fs.writeFile(newPath, '');
        invalidateTree();
        render();
        await openFile(newPath);
      } else if (action === 'new-folder') {
        const name = await showInputDialog({
          title: 'Nova pasta',
          label: `Criar dentro de "${basename(isDir ? target : dirname(target))}"`,
          placeholder: 'ex.: components',
          confirmLabel: 'Criar pasta',
          validate: validateEntryName,
        });
        if (!name) return;
        const parentDir = isDir ? target : dirname(target);
        const newPath = joinPath(parentDir, name);
        if (await window.agzos.fs.exists(newPath)) {
          toast('Já existe um arquivo ou pasta com esse nome.', 'error');
          return;
        }
        await window.agzos.fs.mkdir(newPath);
        invalidateTree();
        render();
      } else if (action === 'reveal') {
        const ok = await window.agzos.app.reveal(target);
        if (!ok) toast('Não foi possível revelar este item.', 'error');
      }
    } catch (err) {
      toast(`Erro: ${err.message}`, 'error');
    }
  });
}

// Atualiza as chaves/abas abertas depois de renomear arquivo ou diretório.
function renameOpenPaths(oldPath, newPath) {
  const updates = [];
  for (const [p, f] of State.files) {
    if (p === oldPath) updates.push([p, newPath, f]);
    else if (p.startsWith(oldPath + sep())) {
      updates.push([p, newPath + p.slice(oldPath.length), f]);
    }
  }
  for (const [oldP, newP, f] of updates) {
    State.files.delete(oldP);
    State.files.set(newP, { ...f, path: newP });
    if (State.activePath === oldP) State.activePath = newP;
  }
  if (updates.length) renderTabs();
}

function validateEntryName(name) {
  if (!name) return 'Informe um nome.';
  if (name === '.' || name === '..') return 'Nome inválido.';
  if (/[\\/]/.test(name)) return 'Use apenas o nome, sem barras.';
  if (name.includes('\0')) return 'Nome inválido.';
  return null;
}

function mapItems(items) {
  return items
    .filter((it) => !isHidden(it.name))
    .map((it) => ({
      name: it.name,
      path: it.path,
      isDirectory: it.isDirectory,
      children: null,
      expanded: State.expandedDirs.has(it.path),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function isHidden(name) {
  if (HIDDEN_DIRS.has(name) || name === '.DS_Store') return true;
  return State.settings.showHiddenFiles === false && name.startsWith('.');
}

function invalidateTree() {
  treeRoot = null;
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
  State.expandedDirs.add(folderPath);
  treeRoot = {
    name: basename(folderPath),
    path: folderPath,
    isDirectory: true,
    children: null,
    expanded: true,
  };
  try {
    const items = await window.agzos.fs.readDir(folderPath);
    treeRoot.children = mapItems(items);
  } catch (err) {
    console.error('Erro ao ler diretório raiz do workspace:', err);
  }
  const topbar = document.getElementById('topbar-workspace');
  if (topbar) topbar.textContent = `— ${basename(folderPath)}`;
  render();
}

export function refreshTree(keepState = true) {
  if (!keepState) {
    treeRoot = null;
  }
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
  const normalized = p.replace(/[\\/]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (idx < 0) return '.';
  if (idx === 0) return normalized[0];
  return normalized.slice(0, idx);
}
function joinPath(a, b) { return a.replace(/[\\/]+$/, '') + sep() + b.replace(/^[\\/]+/, ''); }
function sep() { return navigator.userAgent.includes('Windows') ? '\\' : '/'; }
function cssEscape(s) {
  return s.replace(/[\\"]/g, '\\$&');
}
