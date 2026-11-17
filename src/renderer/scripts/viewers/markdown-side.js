/**
 * Pré-visualização de Markdown ao lado do editor (#md-preview-side) e os botões
 * de ação do editor (#editor-actions) quando a aba ativa é Markdown.
 *
 * - Atualiza ao digitar (debounce de 150 ms) a partir do texto do Monaco.
 * - Acompanha o scroll de forma proporcional.
 * - Segue a aba ativa: outro .md → passa a mostrar ele; arquivo não-Markdown → esconde
 *   (e volta quando o .md é reativado). Fechar a aba ou o X fecha o painel.
 */

import { getActiveEditor, openMarkdownPreview, isMarkdownPath } from '../editor.js';
import { renderMarkdownInto } from './markdown-view.js';
import { el, actionButton, basename } from './common.js';

const State = window.AgzosState;
const DEBOUNCE_MS = 150;

let sidePath = null;
let timer = null;
let hookedEditor = null;
let pane = null;
let doc = null;
let titleEl = null;
let syncingScroll = false;

function ensurePane() {
  if (pane) return pane;
  pane = document.getElementById('md-preview-side');
  titleEl = el('span', { class: 'md-side-title' });
  doc = el('article', { class: 'md-doc' });
  pane.replaceChildren(
    el('div', { class: 'md-side-header' },
      titleEl,
      actionButton('close-preview', 'Fechar pré-visualização', 'x', () => closeSidePreview(), { iconOnly: true })),
    el('div', { class: 'md-side-body' }, doc));
  return pane;
}

function currentText() {
  const editor = getActiveEditor();
  if (State.activePath === sidePath && editor?.getModel()) return editor.getValue();
  return State.files.get(sidePath)?.content ?? '';
}

function render() {
  if (!sidePath || !pane || pane.hidden) return;
  const body = doc.parentElement;
  const top = body.scrollTop;
  renderMarkdownInto(doc, currentText(), { filePath: sidePath });
  body.scrollTop = top;
}

function scheduleRender() {
  clearTimeout(timer);
  timer = setTimeout(render, DEBOUNCE_MS);
}

function syncScroll() {
  const editor = getActiveEditor();
  if (!editor || !pane || pane.hidden || State.activePath !== sidePath || syncingScroll) return;
  const max = editor.getScrollHeight() - editor.getLayoutInfo().height;
  const ratio = max > 0 ? editor.getScrollTop() / max : 0;
  const body = doc.parentElement;
  syncingScroll = true;
  body.scrollTop = ratio * (body.scrollHeight - body.clientHeight);
  requestAnimationFrame(() => { syncingScroll = false; });
}

function hookEditor() {
  const editor = getActiveEditor();
  if (!editor || hookedEditor === editor) return;
  hookedEditor = editor;
  editor.onDidChangeModelContent(() => { if (sidePath && State.activePath === sidePath) scheduleRender(); });
  editor.onDidScrollChange(() => syncScroll());
}

function show(path) {
  ensurePane();
  sidePath = path;
  titleEl.textContent = `Pré-visualização: ${basename(path)}`;
  titleEl.title = path;
  pane.hidden = false;
  document.getElementById('editor-row')?.classList.add('has-side-preview');
  hookEditor();
  render();
  syncScroll();
}

function hide() {
  if (!pane) return;
  pane.hidden = true;
  document.getElementById('editor-row')?.classList.remove('has-side-preview');
}

export function openSidePreview(path) {
  if (!path) return;
  show(path);
}

export function closeSidePreview() {
  sidePath = null;
  clearTimeout(timer);
  hide();
  renderEditorActions();
}

export function isSidePreviewOpen() {
  return !!sidePath && !!pane && !pane.hidden;
}

function renderEditorActions() {
  const bar = document.getElementById('editor-actions');
  if (!bar) return;
  const path = State.activePath;
  const file = path ? State.files.get(path) : null;
  if (!file || file.viewer || !isMarkdownPath(path)) {
    bar.hidden = true;
    bar.replaceChildren();
    return;
  }
  bar.hidden = false;
  const buttons = [
    actionButton('md-preview-side', 'Abrir pré-visualização ao lado', 'columns-2', () => openMarkdownPreview(path, 'side'), { iconOnly: true, title: 'Abrir pré-visualização ao lado (Ctrl+Shift+V)' }),
  ];
  buttons.push(file.preview
    ? actionButton('md-edit', 'Editar texto', 'code', () => window.AgzosEditor.openFile(path, undefined, { as: 'text' }), { iconOnly: true, title: 'Voltar ao texto' })
    : actionButton('md-preview-tab', 'Abrir pré-visualização', 'eye', () => openMarkdownPreview(path, 'tab'), { iconOnly: true, title: 'Abrir pré-visualização na aba atual' }));
  bar.replaceChildren(...buttons);
}

export function setupMarkdownSide() {
  window.addEventListener('agzos:md-preview-side', (e) => openSidePreview(e.detail?.path));
  window.addEventListener('agzos:active-file-changed', (e) => {
    const path = e.detail?.path;
    renderEditorActions();
    if (!sidePath) return;
    if (path && path === sidePath && !e.detail.file?.preview) show(path);
    else if (path && isMarkdownPath(path) && !e.detail.file?.preview) show(path);
    else hide();
  });
  window.addEventListener('agzos:tab-closed', (e) => {
    if (e.detail?.path === sidePath) closeSidePreview();
  });
}
