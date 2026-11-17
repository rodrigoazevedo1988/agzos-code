/**
 * Snippets — interface (renderer).
 *
 * View no hub "Módulos Agzos": busca, filtro por categoria e grade de cards com miniatura.
 * Miniatura = iframe `sandbox="allow-scripts"` (sem allow-same-origin) com srcdoc montado por
 * buildPreviewDoc (CSP com nonce; só o Tailwind embutido roda) e corpo sanitizado pelo DOMPurify.
 * Renderizada só quando o card fica visível (IntersectionObserver). Sem cliques no iframe.
 *
 * Clique no card = insere no cursor; arrastar para o editor = insere na linha de soltura.
 * Variáveis ({{cor_primaria}}…) e HTML → JSX (.jsx/.tsx) são resolvidas no main (snippets:render).
 * Editor de snippet (modal): nome, categoria, linguagem, tags, corpo (Monaco) e prévia ao vivo.
 */

import { registerModule, openModule } from './modules-hub.js';
import { registerCommands } from './command-palette.js';
import { lucideIcon } from './lucide.js';
import { toast } from './toast.js';
import { confirmGit } from './git-dialog.js';
import { getActiveEditor, getMonaco } from './editor.js';
import {
  buildPreviewDoc, makeNonce, indentFollowingLines, isJsxPath, snippetLanguageForPath, isPreviewable,
} from './snippets-utils.js';

const State = window.AgzosState;
const api = () => window.agzos.snippets;
const DRAG_TYPE = 'application/x-agzos-snippet';
const THUMB_W = 1280;
const LANG_LABELS = { html: 'HTML', tailwind: 'Tailwind', jsx: 'JSX', css: 'CSS' };

let view = null; // container da view aberta
let query = '';
let category = '';
let tailwindSrc = null; // cache do @tailwindcss/browser (vem do main)
let observer = null;
let resizeObs = null;
let snippetEditor = null; // Monaco do modal (aberto)
let refreshSeq = 0;

/* -------------------------------------------------------------------------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(name, size = 14) {
  return lucideIcon(name, { size, strokeWidth: 1.9 });
}

function iconBtn(name, title, onClick, { id, cls = '' } = {}) {
  const b = el('button', `sn-icon-btn ${cls}`.trim());
  b.type = 'button';
  if (id) b.id = id;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(icon(name));
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

function cleanError(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(cleanError(e), 'error', 5000);
    return undefined;
  }
}

function settings() {
  return State.settings?.modules?.snippets || {};
}

function variableValue(name) {
  return (settings().variables || []).find((v) => v.name === name)?.value || '';
}

async function getTailwind() {
  if (tailwindSrc === null) tailwindSrc = await api().tailwind();
  return tailwindSrc;
}

function sanitize(html) {
  const purify = window.DOMPurify;
  if (!purify) return '';
  return purify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'noscript'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
  });
}

/** srcdoc pronto para um corpo (variáveis já trocadas pelo main). */
async function previewDoc(interpolatedBody) {
  return buildPreviewDoc({
    body: sanitize(interpolatedBody),
    tailwind: await getTailwind(),
    nonce: makeNonce(),
    background: variableValue('cor_fundo'),
  });
}

function makeFrame(cls) {
  const frame = document.createElement('iframe');
  frame.className = cls;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Prévia do snippet';
  return frame;
}

/* -------------------------------------------------------------------------- */
/*  Inserção                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Insere o snippet no editor ativo. Sem `line`: no cursor/seleção (linhas seguintes herdam a
 * indentação da linha). Com `line`: como linhas inteiras antes da linha indicada (soltura).
 */
export async function insertSnippet(id, { line } = {}) {
  const ed = getActiveEditor();
  const model = ed?.getModel();
  if (!ed || !model || !State.activePath) {
    toast('Abra um arquivo no editor para inserir o snippet.', 'info', 3000);
    return false;
  }
  const res = await guarded(() => api().render(id, { jsx: isJsxPath(State.activePath) }));
  if (!res) return false;
  const monaco = getMonaco();
  const text = res.text.replace(/\r?\n$/, '');
  const eol = model.getEOL();
  let range;
  let out;
  if (Number.isInteger(line)) {
    const ln = Math.min(Math.max(1, line), model.getLineCount());
    const indent = /^\s*/.exec(model.getLineContent(ln))[0];
    range = new monaco.Range(ln, 1, ln, 1);
    out = indent + indentFollowingLines(text, indent) + eol;
  } else {
    range = ed.getSelection();
    const prefix = model.getLineContent(range.startLineNumber).slice(0, range.startColumn - 1);
    out = indentFollowingLines(text, /^\s*/.exec(prefix)[0]);
  }
  if (eol === '\r\n') out = out.replace(/\r?\n/g, '\r\n');
  ed.pushUndoStop();
  ed.executeEdits('agzos-snippets', [{ range, text: out, forceMoveMarkers: true }]);
  ed.pushUndoStop();
  ed.focus();
  return true;
}

function setupEditorDrop() {
  const host = document.getElementById('editor-host');
  if (!host) return;
  const ours = (e) => [...(e.dataTransfer?.types || [])].includes(DRAG_TYPE);
  host.addEventListener('dragover', (e) => {
    if (!ours(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, true);
  host.addEventListener('drop', (e) => {
    if (!ours(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const ed = getActiveEditor();
    const target = ed?.getTargetAtClientPoint?.(e.clientX, e.clientY);
    const line = target?.position?.lineNumber ?? ed?.getModel()?.getLineCount() ?? 1;
    if (id) insertSnippet(id, { line });
  }, true);
}

/* -------------------------------------------------------------------------- */
/*  Menu do card                                                               */
/* -------------------------------------------------------------------------- */

function closeMenu() {
  document.querySelectorAll('.sn-menu').forEach((m) => m.remove());
}

function openMenu(anchor, snippet) {
  closeMenu();
  const menu = el('div', 'sn-menu');
  menu.setAttribute('role', 'menu');
  const items = [
    ['insert', 'Inserir no cursor', 'corner-down-left', () => insertSnippet(snippet.id)],
    ['edit', 'Editar', 'pencil', () => openSnippetEditor(snippet)],
    ['duplicate', 'Duplicar', 'files', async () => {
      const d = await guarded(() => api().duplicate(snippet.id));
      if (d) toast(`"${d.name}" criado.`, 'success', 1800);
    }],
    ['copy', 'Copiar código', 'copy', async () => {
      const r = await guarded(() => api().render(snippet.id));
      if (!r) return;
      try { await navigator.clipboard.writeText(r.text); toast('Snippet copiado.', 'success', 1500); } catch { toast('Não foi possível copiar.', 'error'); }
    }],
    ['delete', 'Apagar', 'trash', async () => {
      const ok = await confirmGit({
        title: 'Apagar snippet',
        message: `Apagar "${snippet.name}"?${snippet.builtin ? ' Você pode trazê-lo de volta com "Restaurar originais".' : ''}`,
        confirmLabel: 'Apagar',
        danger: true,
      });
      if (ok) await guarded(() => api().remove(snippet.id));
    }],
  ];
  for (const [action, label, ic, run] of items) {
    const b = el('button', `sn-menu-item${action === 'delete' ? ' danger' : ''}`);
    b.type = 'button';
    b.dataset.action = action;
    b.setAttribute('role', 'menuitem');
    b.append(icon(ic, 13), el('span', null, label));
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); run(); });
    menu.append(b);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  menu.querySelector('button')?.focus();
}

/* -------------------------------------------------------------------------- */
/*  Grade                                                                      */
/* -------------------------------------------------------------------------- */

async function renderThumb(thumb) {
  if (thumb.dataset.rendered) return;
  thumb.dataset.rendered = '1';
  const { id, language } = thumb.dataset;
  if (!isPreviewable(language)) return;
  const res = await api().render(id).catch(() => null);
  if (!res || !thumb.isConnected) return;
  const frame = makeFrame('sn-thumb-frame');
  frame.srcdoc = await previewDoc(res.text);
  thumb.querySelector('.sn-thumb-code')?.remove();
  thumb.append(frame);
}

function updateScale(grid) {
  const thumb = grid.querySelector('.sn-thumb');
  if (thumb && thumb.clientWidth) grid.style.setProperty('--sn-scale', String(thumb.clientWidth / THUMB_W));
}

function buildCard(s) {
  const card = el('div', 'sn-card');
  card.dataset.id = s.id;
  card.draggable = true;
  card.title = `${s.name} — clique para inserir no cursor ou arraste para o editor`;
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(DRAG_TYPE, s.id);
    e.dataTransfer.effectAllowed = 'copy';
  });

  const main = el('button', 'sn-card-main');
  main.type = 'button';
  main.setAttribute('aria-label', `Inserir ${s.name} no cursor`);
  const thumb = el('div', 'sn-thumb');
  thumb.dataset.id = s.id;
  thumb.dataset.language = s.language;
  if (!isPreviewable(s.language)) {
    const pre = el('pre', 'sn-thumb-code', s.body.split('\n').slice(0, 12).join('\n'));
    thumb.append(pre);
  }
  const meta = el('span', 'sn-card-meta');
  meta.append(el('span', 'sn-card-name', s.name), el('span', 'sn-card-cat', `${s.category} · ${LANG_LABELS[s.language] || s.language}`));
  main.append(thumb, meta);
  main.addEventListener('click', () => insertSnippet(s.id));

  const menuBtn = iconBtn('ellipsis', 'Mais ações', (e) => openMenu(e.currentTarget, s), { cls: 'sn-menu-btn' });
  card.append(main, menuBtn);
  return card;
}

async function refresh() {
  const host = view;
  if (!host?.isConnected) return;
  const seq = ++refreshSeq;
  if (settings().enabled === false) {
    host.replaceChildren(el('p', 'hint', 'Os Snippets estão desabilitados em Configurações → Módulos Agzos.'));
    return;
  }
  const data = await guarded(() => api().list({ query, category }));
  if (!data || seq !== refreshSeq || view !== host) return;

  let grid = host.querySelector('.sn-grid');
  if (!host.querySelector('.sn-top')) buildChrome(host);
  const select = host.querySelector('#snippets-category');
  const current = select.value;
  select.replaceChildren(new Option('Todas as categorias', ''));
  for (const c of data.categories) select.append(new Option(c, c));
  select.value = data.categories.includes(current) ? current : '';
  if (select.value !== category) category = select.value;

  grid = host.querySelector('.sn-grid');
  observer?.disconnect();
  grid.replaceChildren();
  host.querySelector('.sn-empty').hidden = data.snippets.length > 0;
  for (const s of data.snippets) grid.append(buildCard(s));
  updateScale(grid);
  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        observer.unobserve(en.target);
        renderThumb(en.target);
      }
    }
  }, { rootMargin: '200px 0px' });
  grid.querySelectorAll('.sn-thumb').forEach((t) => observer.observe(t));
}

function buildChrome(host) {
  host.replaceChildren();
  const top = el('div', 'sn-top');
  const searchWrap = el('label', 'sn-search');
  searchWrap.append(icon('search', 13));
  const search = el('input');
  search.id = 'snippets-search';
  search.type = 'search';
  search.placeholder = 'Buscar snippets…';
  search.setAttribute('aria-label', 'Buscar snippets');
  search.value = query;
  let t = null;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { query = search.value; refresh(); }, 120);
  });
  searchWrap.append(search);

  const row = el('div', 'sn-row');
  const select = el('select', 'sn-select');
  select.id = 'snippets-category';
  select.setAttribute('aria-label', 'Categoria');
  select.addEventListener('change', () => { category = select.value; refresh(); });
  const tools = el('div', 'sn-tools');
  tools.append(
    iconBtn('plus', 'Novo snippet', () => openSnippetEditor(null), { id: 'snippets-new' }),
    iconBtn('upload', 'Importar JSON', async () => {
      const r = await guarded(() => api().import());
      if (r && !r.canceled) toast(`${r.added} novo(s), ${r.updated} atualizado(s)${r.skipped ? `, ${r.skipped} ignorado(s)` : ''}.`, 'success', 2500);
    }, { id: 'snippets-import' }),
    iconBtn('download', 'Exportar JSON', async () => {
      const r = await guarded(() => api().export());
      if (r?.path) toast('Snippets exportados.', 'success', 2000);
    }, { id: 'snippets-export' }),
    iconBtn('rotate-ccw', 'Restaurar originais', async () => {
      const ok = await confirmGit({
        title: 'Restaurar originais',
        message: 'Os snippets da biblioteca Agzos voltam ao original (os apagados voltam). Os seus snippets não mudam.',
        confirmLabel: 'Restaurar',
      });
      if (ok) {
        const r = await guarded(() => api().restoreDefaults());
        if (r) toast(`${r.restored} snippets restaurados.`, 'success', 2000);
      }
    }, { id: 'snippets-restore' }),
  );
  row.append(select, tools);
  top.append(searchWrap, row);

  const hint = el('p', 'sn-hint', 'Clique para inserir no cursor ou arraste para o editor.');
  const empty = el('p', 'sn-empty hint', 'Nenhum snippet encontrado.');
  empty.hidden = true;
  const grid = el('div', 'sn-grid');
  resizeObs?.disconnect();
  resizeObs = new ResizeObserver(() => updateScale(grid));
  resizeObs.observe(grid);
  host.append(top, hint, empty, grid);
}

/* -------------------------------------------------------------------------- */
/*  Editor de snippet (modal)                                                  */
/* -------------------------------------------------------------------------- */

export function getSnippetEditor() {
  return snippetEditor;
}

function monacoLanguage(lang) {
  if (lang === 'css') return 'css';
  if (lang === 'jsx') return 'javascript';
  return 'html';
}

function closeSnippetEditor() {
  const overlay = document.getElementById('snippet-editor-overlay');
  snippetEditor?.dispose();
  snippetEditor = null;
  overlay?.remove();
}

/** Abre o modal. `snippet` null = novo; objeto sem id = novo pré-preenchido. */
export function openSnippetEditor(snippet) {
  closeSnippetEditor();
  const monaco = getMonaco();
  const isEdit = Boolean(snippet?.id);
  const overlay = el('div', 'overlay sn-editor-overlay');
  overlay.id = 'snippet-editor-overlay';
  const dlg = el('div', 'sn-editor');
  dlg.id = 'snippet-editor';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'snippet-editor-title');

  const head = el('div', 'sn-editor-head');
  const title = el('h2', null, isEdit ? 'Editar snippet' : 'Novo snippet');
  title.id = 'snippet-editor-title';
  head.append(title, iconBtn('x', 'Fechar (Esc)', () => closeSnippetEditor()));

  const field = (label, input) => {
    const wrap = el('label', 'sn-field');
    wrap.append(el('span', null, label), input);
    return wrap;
  };
  const name = el('input');
  name.id = 'snippet-name';
  name.maxLength = 120;
  name.value = snippet?.name || '';
  const cat = el('input');
  cat.id = 'snippet-category';
  cat.maxLength = 60;
  cat.value = snippet?.category || '';
  cat.setAttribute('list', 'snippet-category-list');
  const datalist = el('datalist');
  datalist.id = 'snippet-category-list';
  api().list().then((d) => { for (const c of d.categories) datalist.append(new Option(c)); }).catch(() => {});
  const lang = el('select');
  lang.id = 'snippet-language';
  for (const [v, l] of Object.entries(LANG_LABELS)) lang.append(new Option(l, v));
  lang.value = snippet?.language || 'tailwind';
  const tags = el('input');
  tags.id = 'snippet-tags';
  tags.placeholder = 'separadas por vírgula';
  tags.value = (snippet?.tags || []).join(', ');

  const fields = el('div', 'sn-editor-fields');
  fields.append(field('Nome', name), field('Categoria', cat), field('Linguagem', lang), field('Tags', tags), datalist);

  const panes = el('div', 'sn-editor-panes');
  const codeHost = el('div', 'sn-editor-code');
  const previewWrap = el('div', 'sn-editor-preview');
  const preview = makeFrame('sn-preview');
  const previewNote = el('p', 'sn-preview-note hint', 'Prévia disponível para HTML e Tailwind.');
  previewWrap.append(preview, previewNote);
  panes.append(codeHost, previewWrap);

  const actions = el('div', 'sn-editor-actions');
  const cancel = el('button', 'sn-btn', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeSnippetEditor());
  const save = el('button', 'sn-btn sn-btn-primary', 'Salvar');
  save.type = 'button';
  save.id = 'snippet-save';
  actions.append(cancel, save);

  dlg.append(head, fields, panes, actions);
  overlay.append(dlg);
  document.body.append(overlay);

  snippetEditor = monaco.editor.create(codeHost, {
    value: snippet?.body || '',
    language: monacoLanguage(lang.value),
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
  });

  let seq = 0;
  let timer = null;
  const updatePreview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      const can = isPreviewable(lang.value);
      preview.hidden = !can;
      previewNote.hidden = can;
      if (!can || !snippetEditor) return;
      const body = await api().interpolate(snippetEditor.getValue()).catch(() => '');
      const doc = await previewDoc(body);
      if (mine === seq && preview.isConnected) preview.srcdoc = doc;
    }, 200);
  };
  snippetEditor.onDidChangeModelContent(updatePreview);
  lang.addEventListener('change', () => {
    monaco.editor.setModelLanguage(snippetEditor.getModel(), monacoLanguage(lang.value));
    updatePreview();
  });
  updatePreview();

  save.addEventListener('click', async () => {
    const input = {
      name: name.value,
      category: cat.value,
      language: lang.value,
      body: snippetEditor.getValue(),
      tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    };
    if (isEdit) input.id = snippet.id;
    const saved = await guarded(() => api().save(input));
    if (saved) {
      closeSnippetEditor();
      toast(isEdit ? 'Snippet salvo.' : `"${saved.name}" criado.`, 'success', 1800);
    }
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSnippetEditor(); }
  });
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeSnippetEditor(); });
  (name.value ? snippetEditor : name).focus();
}

/** "Salvar seleção como snippet": abre o modal com o texto selecionado. */
export function saveSelectionAsSnippet() {
  const ed = getActiveEditor();
  const model = ed?.getModel();
  const sel = ed?.getSelection();
  const text = model && sel ? model.getValueInRange(sel) : '';
  if (!text.trim()) {
    toast('Selecione um trecho no editor para salvar como snippet.', 'info', 3000);
    return;
  }
  openSnippetEditor({ name: '', category: '', language: snippetLanguageForPath(State.activePath), body: text, tags: [] });
}

/* -------------------------------------------------------------------------- */

export function setupSnippets() {
  registerModule({
    id: 'snippets',
    label: 'Snippets',
    icon: 'file-code',
    description: 'Componentes Agzos (HTML + Tailwind) para inserir com um clique ou arrastando.',
    open(container) {
      view = container;
      view.classList.add('snippets-view');
      refresh();
    },
  });

  registerCommands([
    { id: 'snippets.open', label: 'Agzos: Abrir Snippets', run: () => openModule('snippets') },
    { id: 'snippets.saveSelection', label: 'Agzos: Salvar seleção como snippet', run: () => saveSelectionAsSnippet() },
    { id: 'snippets.new', label: 'Agzos: Novo snippet', run: () => openSnippetEditor(null) },
  ]);

  const ed = getActiveEditor();
  ed?.addAction({
    id: 'agzos-snippets.saveSelection',
    label: 'Salvar seleção como snippet',
    contextMenuGroupId: 'agzos-snippets',
    contextMenuOrder: 0,
    precondition: 'editorHasSelection',
    run: () => saveSelectionAsSnippet(),
  });

  setupEditorDrop();
  document.addEventListener('mousedown', (e) => { if (!e.target.closest?.('.sn-menu')) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
  api().onChanged?.(() => { if (view?.isConnected) refresh(); });
  window.addEventListener('agzos:modules-settings', () => {
    if (!view?.isConnected) return;
    view.replaceChildren(); // recria (variáveis podem ter mudado as miniaturas)
    refresh();
  });
}
