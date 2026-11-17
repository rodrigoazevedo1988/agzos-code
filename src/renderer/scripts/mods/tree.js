/**
 * Agzos Árvore — interface (renderer).
 *
 * Menu de contexto de pasta no Explorer, comando da paleta e card no hub abrem o diálogo:
 * opções (profundidade, respeitar .gitignore, só pastas, ocultos), prévia ao vivo e ações
 * Copiar, Inserir no cursor e Criar ARVORE.md. A árvore vem do main (tree:generate, guardado).
 */

import { registerModule } from '../modules-hub.js';
import { registerCommands } from '../command-palette.js';
import { registerContextMenuItems, refreshTree } from '../file-tree.js';
import { getActiveEditor, openFile } from '../editor.js';
import { toast } from '../toast.js';
import {
  moduleEnabled, buildModuleToggle, openToolDialog, button, field, copyText, joinPath, baseName,
} from './tool-common.js';

const State = window.AgzosState;
const KEY = 'tree';

export function treeMarkdown(name, text) {
  return `# Árvore de ${name}\n\n\`\`\`text\n${text}\n\`\`\`\n`;
}

function checkbox(checked) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  return input;
}

export function openTreeDialog(dir = State.workspaceRoot) {
  if (!dir) { toast('Abra uma pasta para gerar a árvore.', 'info'); return null; }
  if (!moduleEnabled(KEY)) { toast('A Agzos Árvore está desabilitada nas Configurações.', 'info'); return null; }
  const ui = openToolDialog({ title: `Agzos Árvore — ${baseName(dir)}`, className: 'tree-dialog' });

  const depth = document.createElement('input');
  depth.type = 'number';
  depth.min = '1';
  depth.max = '20';
  depth.value = '3';
  const gitignore = checkbox(true);
  const dirsOnly = checkbox(false);
  const hidden = checkbox(false);
  const options = document.createElement('div');
  options.className = 'tree-options';
  options.append(
    field('Profundidade', depth),
    field('Respeitar .gitignore', gitignore),
    field('Só pastas', dirsOnly),
    field('Mostrar ocultos', hidden),
  );
  const preview = document.createElement('pre');
  preview.className = 'tree-preview';
  preview.tabIndex = 0;
  const info = document.createElement('div');
  info.className = 'tree-info';
  ui.body.append(options, preview, info);

  let current = '';
  let seq = 0;
  let pending = null;
  function refresh() {
    pending = generate();
    return pending;
  }
  async function generate() {
    const my = ++seq;
    const d = Number.parseInt(depth.value, 10);
    try {
      const r = await window.agzos.tree.generate(dir, {
        depth: Number.isInteger(d) ? Math.min(20, Math.max(1, d)) : 3,
        gitignore: gitignore.checked,
        dirsOnly: dirsOnly.checked,
        hidden: hidden.checked,
      });
      if (my !== seq) return;
      current = r.text;
      preview.textContent = r.text;
      info.textContent = `${r.count} entrada(s)${r.truncated ? ' — limite de 5 mil atingido' : ''}`;
    } catch (e) {
      if (my !== seq) return;
      current = '';
      preview.textContent = '';
      info.textContent = `Erro: ${e.message}`;
    }
  }
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { timer = null; refresh(); }, 120); };
  /** Ações usam a árvore das opções atuais: espera a prévia pendente (ou agendada) terminar. */
  async function ensureFresh() {
    if (timer) { clearTimeout(timer); timer = null; await refresh(); return; }
    if (pending) await pending;
  }
  for (const el of [depth, gitignore, dirsOnly, hidden]) {
    el.addEventListener(el === depth ? 'input' : 'change', schedule);
  }
  ui.onClose(() => { clearTimeout(timer); seq++; });

  const copy = button('Copiar', {
    onClick: async () => {
      await ensureFresh();
      if (!current) return;
      await copyText(current);
      toast('Árvore copiada.', 'success', 1500);
    },
  });
  const insert = button('Inserir no cursor', {
    onClick: async () => {
      await ensureFresh();
      const editor = getActiveEditor();
      if (!current || !editor || !State.activePath) { toast('Abra um arquivo para inserir a árvore.', 'info'); return; }
      ui.close();
      const selection = editor.getSelection();
      editor.executeEdits('agzos-tree', [{ range: selection, text: current, forceMoveMarkers: true }]);
      editor.focus();
    },
  });
  const create = button('Criar ARVORE.md', {
    primary: true,
    onClick: async () => {
      await ensureFresh();
      if (!current) return;
      const file = joinPath(dir, 'ARVORE.md');
      try {
        if (await window.agzos.fs.exists(file) && !window.confirm('ARVORE.md já existe nesta pasta. Substituir?')) return;
        await window.agzos.fs.writeFile(file, treeMarkdown(baseName(dir), current));
        ui.close();
        refreshTree(true);
        await openFile(file);
        toast('ARVORE.md criado.', 'success', 1800);
      } catch (e) {
        toast(`Erro ao criar ARVORE.md: ${e.message}`, 'error');
      }
    },
  });
  ui.actions.append(button('Fechar', { onClick: () => ui.close() }), copy, insert, create);
  refresh();
  setTimeout(() => preview.focus(), 0);
  return ui;
}

export function setupTree() {
  registerContextMenuItems((node) => (node.isDirectory && moduleEnabled(KEY)
    ? [{ label: 'Gerar árvore (Agzos Árvore)', run: () => openTreeDialog(node.path) }]
    : []));
  registerCommands([{
    id: 'agzos.tree.generate',
    label: 'Agzos Árvore: Gerar árvore do projeto',
    run: () => openTreeDialog(State.workspaceRoot),
  }]);
  registerModule({
    id: KEY,
    label: 'Agzos Árvore',
    icon: 'folder-tree',
    description: 'Gera a árvore de pastas em texto para copiar, inserir ou salvar em ARVORE.md.',
    open(view) {
      const p = document.createElement('p');
      p.className = 'tool-mod-desc';
      p.textContent = 'Gere a árvore de uma pasta pelo menu de contexto do Explorer ou pela paleta. '
        + 'Respeita o .gitignore e limita a 5 mil entradas.';
      const go = button('Gerar árvore do projeto', { primary: true, onClick: () => openTreeDialog(State.workspaceRoot) });
      view.append(buildModuleToggle(KEY), p, go);
    },
  });
}
