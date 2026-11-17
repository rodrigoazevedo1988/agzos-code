/**
 * Vassoura de Produção — interface (renderer).
 *
 * - Status bar `#status-broom` ("🧹 N") para o arquivo ativo; clique abre o preview.
 * - Preview: diff (diff-view.js) entre o disco e o resultado; "Limpar" aplica. Arquivo
 *   com alterações não salvas → pede para salvar antes (nunca perde a edição do usuário).
 * - View no hub: analisar workspace (progresso + Cancelar), lista com −N e chips por regra,
 *   checkbox por arquivo, "Limpar selecionados" e toast com "Desfazer".
 * - Comandos da paleta, menu de contexto do Explorer e do editor, badges no Explorer.
 *
 * O main avisa arquivos alterados pelo evento do agente (file_changed), que recarrega a aba.
 */

import { registerModule, openModule } from './modules-hub.js';
import { registerCommands } from './command-palette.js';
import { registerContextMenuItems, setFileBadge } from './file-tree.js';
import { showDiff } from './diff-view.js';
import { getActiveEditor, handleExternalChange, languageForPath, saveFile } from './editor.js';
import { toast } from './toast.js';

const State = window.AgzosState;
const api = () => window.agzos?.broom;

const SUPPORTED = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const RULE_LABELS = {
  console: 'console',
  comments: 'comentários',
  unusedImports: 'imports',
  deadCode: 'código morto',
};

const badges = new Map(); // caminho → contagem exibida no Explorer
let lastCheckpoint = null;
let activeSeq = 0;
let lastActive = null;
let scan = { running: false, requestId: null, done: 0, total: 0, files: null, truncated: false, cancelled: false, error: null };
let viewEl = null; // container da view do hub, quando aberta
const listeners = new Map(); // requestId → fn(evt)

const basename = (p) => String(p).split(/[\\/]/).pop();
const extname = (p) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i).toLowerCase() : '';
};
const isSupported = (p) => typeof p === 'string' && SUPPORTED.includes(extname(p));

function settings() {
  const b = State.settings?.modules?.broom || {};
  return { enabled: b.enabled !== false, statusBar: b.statusBar !== false };
}

function relPath(p) {
  const root = State.workspaceRoot;
  if (root && p.startsWith(root)) return p.slice(root.length).replace(/^[\\/]+/, '') || basename(p);
  return p;
}

/** Aplica as edições (intervalos de remoção, com trecho preservado opcional). */
function applyEdits(text, edits) {
  const pieces = [];
  for (const e of edits) {
    if (Number.isInteger(e.keepStart) && Number.isInteger(e.keepEnd)) {
      if (e.keepStart > e.start) pieces.push([e.start, e.keepStart]);
      if (e.end > e.keepEnd) pieces.push([e.keepEnd, e.end]);
    } else if (e.end > e.start) pieces.push([e.start, e.end]);
  }
  pieces.sort((a, b) => b[0] - a[0]);
  let out = text;
  let floor = Infinity;
  for (const [s, t] of pieces) {
    if (t > floor) continue; // sobreposição (não deveria acontecer: o main já deduplica)
    out = out.slice(0, s) + out.slice(t);
    floor = s;
  }
  return out;
}

function setBadge(p, count) {
  if (count > 0) badges.set(p, count);
  else badges.delete(p);
  setFileBadge(p, count > 0 ? `−${count}` : null);
}

function clearBadges() {
  for (const p of [...badges.keys()]) setFileBadge(p, null);
  badges.clear();
}

// ------------------------------------------------------------------ status bar
function statusEl() { return document.getElementById('status-broom'); }

function hideStatus() {
  const el = statusEl();
  if (el) { el.hidden = true; el.textContent = ''; }
}

async function refreshActive() {
  const seq = ++activeSeq;
  const p = State.activePath;
  const cfg = settings();
  if (!cfg.enabled || !isSupported(p) || !api()) { hideStatus(); return; }
  let r;
  try { r = await api().analyzeFile(p); } catch { if (seq === activeSeq) hideStatus(); return; }
  if (seq !== activeSeq || State.activePath !== p) return;
  setBadge(p, r.count);
  const el = statusEl();
  if (!el) return;
  if (!cfg.statusBar || !r.count) { hideStatus(); return; }
  el.textContent = `🧹 ${r.count}`;
  el.title = `Vassoura de Produção: ${r.count} ${r.count === 1 ? 'item' : 'itens'} para limpar (clique para ver)`;
  el.hidden = false;
}

function watchActive() {
  setInterval(() => {
    if (State.activePath !== lastActive) {
      lastActive = State.activePath;
      refreshActive();
    }
  }, 300);
}

// ------------------------------------------------------------------- diálogos
/** Pede para salvar um arquivo com alterações. → 'save' | 'cancel' */
function askToSave(p) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'broom-dirty-overlay';
    const box = document.createElement('div');
    box.className = 'broom-dirty';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const msg = document.createElement('p');
    msg.textContent = `${basename(p)} tem alterações não salvas. Salve antes de limpar para não perder o que você digitou.`;
    const actions = document.createElement('div');
    actions.className = 'broom-dirty-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'primary';
    save.textContent = 'Salvar e limpar';
    actions.append(cancel, save);
    box.append(msg, actions);
    overlay.append(box);
    document.body.append(overlay);
    const done = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); } };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => done('cancel'));
    save.addEventListener('click', () => done('save'));
    cancel.focus();
  });
}

function undoToast(message, checkpointId) {
  const host = document.getElementById('toast-container');
  if (!host) { toast(message, 'success'); return; }
  host.querySelectorAll('.broom-undo-toast').forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = 'toast success broom-undo-toast';
  const text = document.createElement('span');
  text.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'broom-undo';
  btn.textContent = 'Desfazer';
  btn.addEventListener('click', async () => {
    el.remove();
    await undo(checkpointId);
  });
  el.append(text, btn);
  host.append(el);
  setTimeout(() => el.remove(), 10000);
}

// ----------------------------------------------------------------- ações
function ensureEnabled() {
  if (!api()) { toast('Vassoura indisponível.', 'error'); return false; }
  if (!settings().enabled) { toast('A Vassoura de Produção está desabilitada nas Configurações.', 'info'); return false; }
  return true;
}

async function afterChange(paths) {
  for (const p of paths) {
    try { await handleExternalChange(p); } catch {}
  }
  await refreshActive();
}

/** Preview de um arquivo (diff) e limpeza ao confirmar. */
export async function previewFile(p) {
  if (!ensureEnabled()) return;
  if (!p) { toast('Abra um arquivo para limpar.', 'info'); return; }
  if (!isSupported(p)) { toast('A Vassoura só analisa arquivos .ts, .tsx, .js, .jsx, .mjs e .cjs.', 'info'); return; }
  const open = State.files.get(p);
  if (open?.dirty) {
    if (await askToSave(p) !== 'save') return;
    await saveFile(p);
    if (State.files.get(p)?.dirty) return; // não salvou
  }
  let analysis;
  let disk;
  try {
    [analysis, disk] = await Promise.all([api().analyzeFile(p), window.agzos.fs.readFile(p)]);
  } catch (err) {
    toast(`Vassoura: ${err.message}`, 'error');
    return;
  }
  setBadge(p, analysis.count);
  if (analysis.error) { toast(`Vassoura: ${analysis.error}`, 'error', 5000); return; }
  if (!analysis.count) { toast(`Nada para limpar em ${basename(p)}.`, 'info'); return; }
  const cleaned = applyEdits(disk.content, analysis.edits);
  const accepted = await showDiff({
    title: `Vassoura: ${basename(p)} (−${analysis.count})`,
    original: disk.content,
    modified: cleaned,
    language: languageForPath(p),
    applyLabel: 'Limpar',
  });
  if (!accepted) return;
  if (State.files.get(p)?.dirty) { toast(`${basename(p)} foi alterado no editor; salve e tente de novo.`, 'error'); return; }
  try {
    const r = await api().cleanFile(p, { editIds: analysis.edits.map((e) => e.id) });
    if (!r.removed) { toast(r.error ? `Vassoura: ${r.error}` : 'Nada foi removido.', r.error ? 'error' : 'info'); return; }
    lastCheckpoint = r.checkpointId;
    setBadge(p, 0);
    await afterChange([p]);
    undoToast(`Limpeza aplicada: ${r.removed} ${r.removed === 1 ? 'item removido' : 'itens removidos'} de ${basename(p)}.`, r.checkpointId);
  } catch (err) {
    toast(`Vassoura: ${err.message}`, 'error');
  }
}

async function undo(checkpointId = lastCheckpoint) {
  if (!api()) return;
  if (!checkpointId) { toast('Nenhuma limpeza para desfazer.', 'info'); return; }
  const r = await api().undo(checkpointId);
  if (checkpointId === lastCheckpoint) lastCheckpoint = null;
  if (r.errors?.length) toast(`Desfazer: ${r.errors[0].message}`, 'error', 5000);
  else toast('Limpeza desfeita.', 'success');
  await afterChange(r.restored || []);
  if (scan.files && r.restored?.length) await startScan(scan.root);
}

// --------------------------------------------------------------------- scan
function newRequestId() {
  return `broom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function startScan(root) {
  if (!ensureEnabled() || scan.running) return;
  const requestId = newRequestId();
  scan = { running: true, requestId, root, done: 0, total: 0, files: scan.files, truncated: false, cancelled: false, error: null };
  renderView();
  listeners.set(requestId, (evt) => {
    if (evt.type === 'progress') {
      scan.done = evt.done;
      scan.total = evt.total;
      renderProgress();
    }
  });
  try {
    const r = await api().scanWorkspace(requestId, root || undefined);
    if (scan.requestId !== requestId) return;
    Object.assign(scan, { files: r.files, truncated: r.truncated, cancelled: r.cancelled });
    for (const f of r.files) setBadge(f.path, f.count);
  } catch (err) {
    if (scan.requestId === requestId) scan.error = err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally {
    listeners.delete(requestId);
    if (scan.requestId === requestId) scan.running = false;
    renderView();
  }
}

async function cancelScan() {
  if (!scan.running) return;
  await api().cancel(scan.requestId);
}

async function cleanSelected(paths) {
  if (!ensureEnabled() || !paths.length) return;
  const dirty = paths.filter((p) => State.files.get(p)?.dirty);
  if (dirty.length) {
    toast(`Salve antes de limpar: ${dirty.map(basename).join(', ')}`, 'error', 5000);
    return;
  }
  try {
    const r = await api().cleanWorkspace(newRequestId(), paths);
    if (!r.files) { toast('Nada foi removido.', 'info'); return; }
    lastCheckpoint = r.checkpointId;
    const cleaned = new Set(paths);
    for (const p of paths) setBadge(p, 0);
    if (scan.files) scan.files = scan.files.filter((f) => !cleaned.has(f.path));
    renderView();
    await afterChange(paths);
    undoToast(`Limpeza aplicada: ${r.removed} ${r.removed === 1 ? 'item' : 'itens'} em ${r.files} ${r.files === 1 ? 'arquivo' : 'arquivos'}.`, r.checkpointId);
  } catch (err) {
    toast(`Vassoura: ${err.message}`, 'error');
  }
}

// --------------------------------------------------------------------- view
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderProgress() {
  if (!viewEl?.isConnected) return;
  const bar = viewEl.querySelector('.broom-progress-bar');
  const label = viewEl.querySelector('.broom-progress-label');
  if (bar) bar.style.width = scan.total ? `${Math.round((scan.done / scan.total) * 100)}%` : '0%';
  if (label) label.textContent = scan.total ? `${scan.done} de ${scan.total} arquivos` : 'Listando arquivos…';
}

function summaryText() {
  if (scan.error) return `Erro: ${scan.error}`;
  if (scan.running) return 'Analisando…';
  if (!scan.files) return 'Analise o workspace para encontrar console.*, comentários, imports não usados e código morto.';
  const n = scan.files.length;
  const items = scan.files.reduce((sum, f) => sum + f.count, 0);
  const parts = [];
  if (scan.cancelled) parts.push('Cancelado.');
  parts.push(n ? `${items} ${items === 1 ? 'item' : 'itens'} em ${n} ${n === 1 ? 'arquivo' : 'arquivos'}.` : 'Nada para limpar.');
  if (scan.truncated) parts.push('Limite de 5000 arquivos atingido.');
  return parts.join(' ');
}

function renderView() {
  if (!viewEl?.isConnected) return;
  const cfg = settings();
  viewEl.replaceChildren();
  if (!cfg.enabled) {
    viewEl.append(el('p', 'hint broom-disabled', 'A Vassoura de Produção está desabilitada. Ative em Configurações → Módulos Agzos.'));
    return;
  }

  const toolbar = el('div', 'broom-toolbar');
  const scanBtn = el('button', 'broom-scan primary', 'Analisar workspace');
  scanBtn.type = 'button';
  scanBtn.disabled = scan.running;
  scanBtn.addEventListener('click', () => startScan());
  const cancelBtn = el('button', 'broom-cancel', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.hidden = !scan.running;
  cancelBtn.addEventListener('click', () => cancelScan());
  toolbar.append(scanBtn, cancelBtn);
  viewEl.append(toolbar);

  if (scan.running) {
    const progress = el('div', 'broom-progress');
    progress.append(el('div', 'broom-progress-track'), el('span', 'broom-progress-label'));
    progress.firstChild.append(el('div', 'broom-progress-bar'));
    viewEl.append(progress);
    renderProgress();
  }

  viewEl.append(el('p', 'broom-summary', summaryText()));

  const files = scan.files || [];
  if (!files.length) return;

  const list = el('div', 'broom-files');
  for (const f of files) {
    const row = el('div', 'broom-file');
    row.dataset.path = f.path;
    const check = el('input');
    check.type = 'checkbox';
    check.checked = true;
    check.title = 'Incluir na limpeza';
    const name = el('button', 'broom-name', relPath(f.path));
    name.type = 'button';
    name.title = `Ver as mudanças em ${relPath(f.path)}`;
    name.addEventListener('click', () => previewFile(f.path));
    const count = el('span', 'broom-count', `−${f.count}`);
    const chips = el('span', 'broom-chips');
    for (const [rule, n] of Object.entries(f.byRule || {})) {
      if (n > 0) chips.append(el('span', `broom-chip rule-${rule}`, `${RULE_LABELS[rule] || rule} ${n}`));
    }
    row.append(check, name, count, chips);
    list.append(row);
  }
  viewEl.append(list);

  const actions = el('div', 'broom-actions');
  const clean = el('button', 'broom-clean-selected primary', 'Limpar selecionados');
  clean.type = 'button';
  clean.disabled = scan.running;
  clean.addEventListener('click', () => {
    const paths = [...list.querySelectorAll('.broom-file')]
      .filter((r) => r.querySelector('input[type="checkbox"]').checked)
      .map((r) => r.dataset.path);
    if (!paths.length) { toast('Selecione ao menos um arquivo.', 'info'); return; }
    cleanSelected(paths);
  });
  actions.append(clean);
  viewEl.append(actions);
}

function openView(container) {
  viewEl = container;
  renderView();
}

// ------------------------------------------------------------------- setup
export function setupBroom() {
  registerModule({
    id: 'broom',
    label: 'Vassoura de Produção',
    icon: 'brush-cleaning',
    description: 'Remove console.*, comentários, imports não usados e código morto antes do deploy.',
    open: openView,
  });

  registerCommands([
    { id: 'broom.cleanFile', label: 'Agzos: Limpar Código de Produção (arquivo atual)', run: () => previewFile(State.activePath) },
    {
      id: 'broom.cleanWorkspace',
      label: 'Agzos: Limpar Código de Produção (workspace)',
      run: () => {
        if (!ensureEnabled()) return;
        openModule('broom');
        startScan();
      },
    },
    { id: 'broom.undo', label: 'Agzos: Desfazer última limpeza', run: () => undo() },
  ]);

  registerContextMenuItems((node) => {
    if (!settings().enabled) return [];
    if (node.isDirectory) {
      return [{ label: 'Limpar código de produção', run: () => { openModule('broom'); startScan(node.path); } }];
    }
    return isSupported(node.path) ? [{ label: 'Limpar código de produção', run: () => previewFile(node.path) }] : [];
  });

  const editor = getActiveEditor();
  editor?.addAction?.({
    id: 'agzos.broom.cleanFile',
    label: 'Limpar código de produção',
    contextMenuGroupId: '9_agzos',
    contextMenuOrder: 1,
    run: () => previewFile(State.activePath),
  });

  const status = statusEl();
  if (status) {
    status.addEventListener('click', () => previewFile(State.activePath));
    status.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); previewFile(State.activePath); }
    });
  }

  api()?.onEvent?.((id, evt) => listeners.get(id)?.(evt));

  window.addEventListener('agzos:file-saved', (e) => {
    const p = e.detail?.path;
    if (p === State.activePath) refreshActive();
    else if (p && badges.has(p)) {
      api()?.analyzeFile(p).then((r) => setBadge(p, r.count)).catch(() => {});
    }
  });
  window.addEventListener('agzos:modules-settings', () => {
    if (!settings().enabled) clearBadges();
    renderView();
    refreshActive();
  });
  window.addEventListener('agzos:workspace-changed', () => {
    clearBadges();
    scan = { running: false, requestId: null, done: 0, total: 0, files: null, truncated: false, cancelled: false, error: null };
    renderView();
  });

  watchActive();
}
