/**
 * Histórico local e Agzos Git Slider (renderer).
 *
 * - Após cada salvamento (`agzos:file-saved`), pede ao main para guardar a versão
 *   salva no histórico local (window.agzos.history.recordSave).
 * - Barra "Linha do tempo" acima do editor do arquivo ativo (comando
 *   "Agzos: Linha do tempo do arquivo", Ctrl+Alt+H, botão na barra das abas):
 *   marcadores = commits do git + versões locais, da mais antiga para a mais nova,
 *   e o "presente" no fim. Clicar/arrastar mostra o diff (Monaco, somente leitura)
 *   entre a versão e o presente; "Comparar com a anterior" troca para o diff entre a
 *   versão anterior e a escolhida. ←/→ navegam; Esc ou "Voltar ao presente" fecha.
 * - "Restaurar esta versão": o main escreve a versão (com checkpoint) e ela entra no
 *   histórico; o editor recarrega do disco.
 */

import { registerModule } from './modules-hub.js';
import { registerCommands } from './command-palette.js';
import { getMonaco, getActiveEditor, handleExternalChange, languageForPath, isUntitled } from './editor.js';
import { isEditableTarget } from './keymap.js';
import { lucideIcon } from './lucide.js';
import { toast } from './toast.js';

const State = window.AgzosState;
const api = () => window.agzos?.history;

const ORIGIN_LABEL = {
  salvar: 'salvo',
  agente: 'antes do agente',
  vassoura: 'antes da Vassoura',
  cofre: 'antes do Cofre',
  restaurar: 'restaurado',
  externo: 'alteração externa',
};

let panel = null; // <section id="timeline">
let diffHost = null; // <div id="timeline-diff">
let diff = null; // { editor, original, modified }
let current = null; // { path, items, git, truncated, index, mode: 'present'|'previous' }
let loadToken = 0;

const settings = () => State.settings?.modules?.gitSlider || {};
const enabled = () => settings().enabled !== false;
const basename = (p) => String(p || '').split(/[\\/]/).pop();

function isTextFile(path) {
  const file = path ? State.files.get(path) : null;
  return !!file && !file.viewer && !file.preview && !isUntitled(path);
}

// ------------------------------------------------------------------ rótulos
const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
function relativeTime(ts) {
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 30 * 86400) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (abs < 365 * 86400) return rtf.format(Math.round(diffSec / (30 * 86400)), 'month');
  return rtf.format(Math.round(diffSec / (365 * 86400)), 'year');
}

export function itemLabel(item) {
  if (!item) return 'Presente (conteúdo atual do editor)';
  const when = `${relativeTime(item.ts)} · ${new Date(item.ts).toLocaleString('pt-BR')}`;
  if (item.kind === 'commit') return `${item.author} — ${item.message} · ${item.sha.slice(0, 7)} · ${when}`;
  return `Histórico local (${ORIGIN_LABEL[item.origin] || item.origin}) · ${when}`;
}

// ------------------------------------------------------------------ conteúdo
function presentContent(path) {
  const editor = getActiveEditor();
  if (path === State.activePath && editor?.getModel()) return editor.getValue();
  return State.files.get(path)?.content ?? '';
}

async function versionContent(path, item) {
  const r = await api().read(path, item.versionId);
  return r.content;
}

// ------------------------------------------------------------------ diff
function ensureDiffHost() {
  if (diffHost?.isConnected) return diffHost;
  diffHost = document.createElement('div');
  diffHost.id = 'file-timeline-diff';
  diffHost.className = 'timeline-diff';
  diffHost.hidden = true;
  document.getElementById('editor-row')?.append(diffHost);
  return diffHost;
}

function disposeDiff() {
  if (!diff) return;
  diff.editor.dispose();
  diff.original.dispose();
  diff.modified.dispose();
  diff = null;
}

function hideDiff() {
  disposeDiff();
  if (diffHost) {
    diffHost.hidden = true;
    diffHost.replaceChildren();
  }
}

function showDiffOf(path, originalText, modifiedText) {
  const monaco = getMonaco();
  if (!monaco) return;
  const host = ensureDiffHost();
  disposeDiff();
  host.replaceChildren();
  host.hidden = false;
  const language = languageForPath(path);
  const original = monaco.editor.createModel(originalText, language);
  const modified = monaco.editor.createModel(modifiedText, language);
  const editor = monaco.editor.createDiffEditor(host, {
    automaticLayout: true, readOnly: true, originalEditable: false, renderOverviewRuler: false,
  });
  editor.setModel({ original, modified });
  diff = { editor, original, modified };
}

// ------------------------------------------------------------------ painel
function button(label, onClick, { cls = 'secondary-btn', icon } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  if (icon) b.append(lucideIcon(icon, { size: 14 }));
  b.append(document.createTextNode(label));
  b.addEventListener('click', onClick);
  return b;
}

function ensurePanel() {
  if (panel?.isConnected) return panel;
  panel = document.createElement('section');
  panel.id = 'file-timeline';
  panel.className = 'timeline';
  panel.setAttribute('aria-label', 'Linha do tempo do arquivo');
  panel.hidden = true;
  panel.addEventListener('keydown', onPanelKey);
  const row = document.getElementById('editor-row');
  row?.parentElement?.insertBefore(panel, row);
  return panel;
}

function render() {
  const el = ensurePanel();
  if (!current) { el.hidden = true; return; }
  el.hidden = false;
  const { items, index } = current;

  const head = document.createElement('div');
  head.className = 'timeline-head';
  const title = document.createElement('span');
  title.className = 'timeline-title';
  title.textContent = `Linha do tempo — ${basename(current.path)}`;
  const status = document.createElement('span');
  status.className = 'timeline-status';
  const commits = items.filter((i) => i.kind === 'commit').length;
  const parts = [`${commits} commit${commits === 1 ? '' : 's'}`, `${items.length - commits} versão(ões) locais`];
  if (!current.git) parts[0] = 'sem Git';
  if (current.truncated) parts.push('só os commits mais recentes');
  status.textContent = parts.join(' · ');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'timeline-close';
  close.title = 'Voltar ao presente (Esc)';
  close.setAttribute('aria-label', 'Fechar a linha do tempo');
  close.append(lucideIcon('x', { size: 14 }));
  close.addEventListener('click', () => closeTimeline());
  head.append(title, status, close);

  const track = document.createElement('div');
  track.className = 'timeline-track';
  track.setAttribute('role', 'listbox');
  track.setAttribute('aria-label', 'Versões do arquivo');
  const markers = [...items, null];
  markers.forEach((item, i) => {
    const m = document.createElement('button');
    m.type = 'button';
    m.className = 'timeline-marker';
    m.dataset.index = String(i);
    m.setAttribute('role', 'option');
    if (item) m.dataset.kind = item.kind;
    else m.classList.add('present');
    if (item?.kind === 'local') m.dataset.origin = item.origin;
    if (i === index) { m.classList.add('selected'); m.setAttribute('aria-selected', 'true'); }
    m.title = itemLabel(item);
    m.setAttribute('aria-label', itemLabel(item));
    m.tabIndex = i === index ? 0 : -1;
    m.addEventListener('click', () => select(i));
    track.append(m);
  });

  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'timeline-range';
  range.min = '0';
  range.max = String(items.length);
  range.value = String(index);
  range.setAttribute('aria-label', 'Deslize para navegar pelas versões');
  range.addEventListener('input', () => select(Number(range.value), { focus: false }));

  const info = document.createElement('div');
  info.className = 'timeline-info';
  const selected = items[index] || null;
  info.textContent = current.mode === 'previous' && selected
    ? `Comparando com a anterior: ${itemLabel(selected)}`
    : itemLabel(selected);
  if (!items.length) info.textContent = 'Nenhuma versão ainda. Salve o arquivo para criar a primeira.';

  const actions = document.createElement('div');
  actions.className = 'timeline-actions';
  const restore = button('Restaurar esta versão', () => restoreSelected(), { cls: 'primary-btn', icon: 'rotate-ccw' });
  restore.disabled = !selected;
  const prev = button('Comparar com a anterior', () => comparePrevious(), { icon: 'arrow-left-right' });
  prev.disabled = !selected || index === 0;
  const present = button('Voltar ao presente', () => closeTimeline());
  actions.append(restore, prev, present);

  el.replaceChildren(head, track, range, info, actions);
  syncToggleButton();
}

function focusSelected() {
  panel?.querySelector('.timeline-marker.selected')?.focus();
}

async function select(i, { focus = true, mode = 'present' } = {}) {
  if (!current) return;
  const max = current.items.length;
  current.index = Math.max(0, Math.min(max, i));
  current.mode = mode;
  render();
  if (focus) focusSelected();
  const item = current.items[current.index];
  const token = ++loadToken;
  if (!item) { hideDiff(); return; }
  const path = current.path;
  try {
    let original;
    let modified;
    if (mode === 'previous' && current.index > 0) {
      [original, modified] = await Promise.all([
        versionContent(path, current.items[current.index - 1]),
        versionContent(path, item),
      ]);
    } else {
      original = await versionContent(path, item);
      modified = presentContent(path);
    }
    if (token !== loadToken || !current || current.path !== path) return;
    showDiffOf(path, original, modified);
  } catch (err) {
    if (token === loadToken) toast(`Não foi possível abrir a versão: ${err.message}`, 'error');
  }
}

function comparePrevious() {
  if (!current || !current.items[current.index] || current.index === 0) return;
  select(current.index, { mode: 'previous' });
}

async function restoreSelected() {
  if (!current) return;
  const item = current.items[current.index];
  if (!item) return;
  const path = current.path;
  const file = State.files.get(path);
  if (file?.dirty && !confirm(`${basename(path)} tem alterações não salvas. Restaurar esta versão e descartá-las?`)) return;
  try {
    await api().restore(path, item.versionId);
    await handleExternalChange(path, { force: true });
    toast('Versão restaurada. A versão anterior continua no histórico.', 'success', 2500);
    hideDiff();
    await load(path, { keepOpen: true });
  } catch (err) {
    toast(`Erro ao restaurar: ${err.message}`, 'error');
  }
}

async function load(path, { keepOpen = false } = {}) {
  const token = ++loadToken;
  let tl;
  try {
    tl = await api().timeline(path);
  } catch (err) {
    toast(`Linha do tempo indisponível: ${err.message}`, 'error');
    return;
  }
  if (token !== loadToken) return;
  if (!keepOpen && current && current.path !== path) hideDiff();
  current = { path, items: tl.items, git: tl.git, truncated: tl.truncated, index: tl.items.length, mode: 'present' };
  render();
}

export async function openTimeline(path = State.activePath) {
  if (!enabled()) { toast('O Agzos Git Slider está desabilitado nas Configurações.', 'info'); return false; }
  if (!isTextFile(path)) { toast('Abra um arquivo de texto para ver a linha do tempo.', 'info'); return false; }
  await load(path);
  focusSelected();
  return true;
}

export function closeTimeline() {
  loadToken++;
  current = null;
  hideDiff();
  if (panel) { panel.hidden = true; panel.replaceChildren(); }
  syncToggleButton();
  getActiveEditor()?.focus?.();
}

export function toggleTimeline() {
  if (current) closeTimeline();
  else openTimeline();
}

// ------------------------------------------------------------------ teclado
function onPanelKey(e) {
  if (!current) return;
  if (e.target?.classList?.contains('timeline-range')) return; // o range trata as setas sozinho
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    select(current.index + (e.key === 'ArrowRight' ? 1 : -1));
  }
}

function onGlobalKey(e) {
  if (!current || e.key !== 'Escape') return;
  if (isEditableTarget(e.target) && !e.target.closest('#file-timeline')) return;
  if (document.querySelector('.diff-overlay, .modal-overlay.active, #cmd-palette.active')) return;
  e.preventDefault();
  e.stopPropagation();
  closeTimeline();
}

// ------------------------------------------------------------------ botão na barra das abas
function syncToggleButton() {
  const bar = document.getElementById('tabs-bar');
  if (!bar) return;
  let btn = document.getElementById('file-timeline-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'file-timeline-toggle';
    btn.className = 'timeline-toggle-btn';
    btn.title = 'Linha do tempo do arquivo (Ctrl+Alt+H)';
    btn.setAttribute('aria-label', 'Linha do tempo do arquivo');
    btn.append(lucideIcon('file-clock', { size: 16 }));
    btn.addEventListener('click', () => toggleTimeline());
    bar.append(btn);
  }
  btn.hidden = !enabled() || !isTextFile(State.activePath);
  btn.classList.toggle('active', !!current);
}

// ------------------------------------------------------------------ view do hub
function openView(container) {
  container.replaceChildren();
  const intro = document.createElement('p');
  intro.className = 'timeline-view-intro';
  intro.textContent = 'Linha do tempo do arquivo: commits do Git e o histórico local (cópia a cada salvamento '
    + 'e antes de alterações do agente, da Vassoura e do Cofre). Mostra o diff de qualquer versão com o presente '
    + 'e restaura com um clique.';
  const hint = document.createElement('p');
  hint.className = 'timeline-view-hint';
  hint.textContent = 'Atalho: Ctrl+Alt+H ou o botão de relógio na barra das abas.';
  const actions = document.createElement('div');
  actions.className = 'timeline-view-actions';
  actions.append(
    button('Abrir a linha do tempo do arquivo ativo', () => openTimeline(), { cls: 'primary-btn', icon: 'file-clock' }),
    button('Limpar o histórico local do arquivo ativo', async () => {
      const p = State.activePath;
      if (!isTextFile(p)) { toast('Abra um arquivo de texto primeiro.', 'info'); return; }
      if (!confirm(`Apagar todas as versões locais de ${basename(p)}? Os commits do Git não são afetados.`)) return;
      await api().clear(p);
      toast('Histórico local do arquivo apagado.', 'success', 1800);
      if (current?.path === p) load(p);
    }),
  );
  container.append(intro, hint, actions);
}

// ------------------------------------------------------------------ setup
export function setupTimeline() {
  registerModule({
    id: 'gitSlider',
    label: 'Agzos Git Slider',
    icon: 'git-commit-horizontal',
    description: 'Linha do tempo do arquivo (commits + histórico local), com diff e restauração.',
    open: openView,
  });

  registerCommands([
    { id: 'history.timeline', label: 'Agzos: Linha do tempo do arquivo', hint: 'Ctrl+Alt+H', run: () => toggleTimeline() },
  ]);

  document.addEventListener('keydown', onGlobalKey, true);

  window.addEventListener('agzos:file-saved', (e) => {
    const p = e.detail?.path;
    if (!p) return;
    Promise.resolve(api()?.recordSave(p))
      .then(() => { if (current?.path === p && current.index === current.items.length) load(p); })
      .catch((err) => console.warn('[histórico] recordSave', err?.message));
  });

  window.addEventListener('agzos:active-file-changed', (e) => {
    syncToggleButton();
    const p = e.detail?.path;
    if (!current || p === current.path) return;
    if (isTextFile(p) && enabled()) load(p);
    else closeTimeline();
  });

  window.addEventListener('agzos:modules-settings', () => {
    if (!enabled() && current) closeTimeline();
    syncToggleButton();
  });

  syncToggleButton();
}
