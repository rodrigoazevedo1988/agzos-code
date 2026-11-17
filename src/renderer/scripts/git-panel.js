/**
 * Painel GIT (#panel-git), branch na barra de status, badge na activity bar,
 * fluxos de clonar / publicar no GitHub / Pull Request e comandos da paleta.
 *
 * Toda operação git roda no main (window.agzos.git.*); o token do GitHub nunca
 * chega aqui. Atualiza ao abrir o painel, ao focar a janela, ao trocar de pasta
 * e por polling leve (só com a janela visível).
 */

import { toast } from './toast.js';
import { lucideIcon } from './lucide.js';
import { renderFileIcon } from './icon-theme.js';
import { showDiff } from './diff-view.js';
import * as editorApi from './editor.js';
import { git, github, GitUiError } from './git-api.js';
import { openGitDialog, confirmGit, isGitDialogOpen } from './git-dialog.js';
import { setGitDecorations } from './git-decorations.js';

const State = window.AgzosState;

const POLL_MS = 3000;
const GIT_DOWNLOAD_URL = 'https://git-scm.com/downloads';
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:user&description=Agzos%20Code';

const G = {
  available: null, // { ok, version } | { ok: false, message, installUrl }
  status: null,
  view: 'loading', // loading | nofolder | nogit | norepo | repo | error
  error: null,
  log: [],
  logKey: null,
  account: null, // { remoteKey, github, account }
  accountKey: null,
  busy: null, // texto da operação em andamento
  collapsed: { conflicts: false, staged: false, changes: false, history: false },
  message: '',
};

let deps = { switchSidebarView: null };
let refreshing = null;
let refreshQueued = false;
let pollTimer = null;
let els = null;

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(name, size = 16, sw = 1.8) {
  return lucideIcon(name, { size, strokeWidth: sw });
}

function iconBtn(name, title, onClick, cls = '') {
  const b = h('button', `git-icon-btn ${cls}`.trim());
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(icon(name, 15));
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

/** Marca do GitHub (não existe no Lucide). */
export function githubMark(size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon github-mark');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z');
  svg.append(p);
  return svg;
}

function avatarEl(account, size = 18) {
  const wrap = h('span', 'git-avatar');
  wrap.style.width = wrap.style.height = `${size}px`;
  if (account?.avatarData) {
    const img = h('img');
    img.src = account.avatarData;
    img.alt = '';
    wrap.append(img);
  } else {
    wrap.textContent = (account?.login || '?').slice(0, 1).toUpperCase();
  }
  return wrap;
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function relativeTime(ms, now = Date.now()) {
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'agora';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800], ['year', 31557600]];
  let unit = 'minute';
  let value = diff / 60;
  for (const [u, sec] of units) {
    if (abs >= sec) { unit = u; value = diff / sec; }
  }
  return rtf.format(Math.round(value), unit);
}

function splitPath(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? { name: p, dir: '' } : { name: p.slice(i + 1), dir: p.slice(0, i) };
}

const STATUS_INFO = {
  M: { label: 'Modificado', cls: 'mod' },
  A: { label: 'Adicionado', cls: 'add' },
  D: { label: 'Excluído', cls: 'del' },
  R: { label: 'Renomeado', cls: 'ren' },
  C: { label: 'Copiado', cls: 'ren' },
  U: { label: 'Não rastreado', cls: 'new' },
  T: { label: 'Tipo alterado', cls: 'mod' },
  '!': { label: 'Conflito', cls: 'conf' },
};

function cwd() { return State.workspaceRoot; }

function absPath(rel) {
  const st = G.status;
  if (!st?.root) return null;
  const sep = State.platform === 'win32' ? '\\' : '/';
  const prefix = st.prefix || '';
  if (prefix && rel.startsWith(prefix) && State.workspaceRoot) {
    return State.workspaceRoot.replace(/[\\/]+$/, '') + sep + rel.slice(prefix.length).split('/').join(sep);
  }
  return st.root.replace(/[\\/]+$/, '') + '/' + rel;
}

async function withBusy(label, fn, { refresh = true, quiet = false } = {}) {
  G.busy = label;
  renderHeader();
  try {
    const res = await fn();
    return res;
  } catch (e) {
    if (!quiet) handleError(e);
    throw e;
  } finally {
    G.busy = null;
    if (refresh) await refreshGit({ log: true });
    else renderHeader();
  }
}

function handleError(e) {
  const msg = e?.message || String(e);
  if (e?.kind === 'no-account') {
    toast(msg, 'error', 6000);
    pickAccountForRepo();
    return;
  }
  if (e?.kind === 'no-remote') {
    toast(msg, 'error', 5000);
    return;
  }
  toast(msg, 'error', 7000);
}

/* --------------------------------------------------------------------------
   Setup
   -------------------------------------------------------------------------- */
export function setupGitPanel({ switchSidebarView } = {}) {
  deps.switchSidebarView = switchSidebarView || null;
  const host = document.getElementById('panel-git');
  if (!host) return;
  host.classList.add('git-panel');
  host.replaceChildren();
  els = buildSkeleton(host);

  // Barra de status
  const remote = document.getElementById('status-remote');
  if (remote) {
    remote.classList.add('git-status-branch');
    remote.setAttribute('role', 'button');
    remote.tabIndex = 0;
    remote.title = 'Controle de versão (abrir painel Git)';
    remote.hidden = true;
    remote.addEventListener('click', () => showGitPanel());
    remote.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showGitPanel(); } });
  }
  const sync = document.getElementById('status-sync');
  if (sync) {
    sync.textContent = '';
    sync.hidden = true;
    sync.setAttribute('role', 'button');
    sync.tabIndex = 0;
    sync.title = 'Sincronizar (pull + push)';
    sync.addEventListener('click', () => runGitCommand('sync'));
    sync.addEventListener('keydown', (e) => { if (e.key === 'Enter') runGitCommand('sync'); });
  }

  // Badge na activity bar
  const actBtn = document.querySelector('.activity-btn[data-view="git"]');
  if (actBtn && !actBtn.querySelector('.activity-badge')) {
    const badge = h('span', 'activity-badge');
    badge.hidden = true;
    actBtn.append(badge);
  }

  window.addEventListener('agzos:workspace-changed', () => {
    G.log = []; G.logKey = null; G.account = null; G.accountKey = null; G.status = null;
    refreshGit({ log: true });
  });
  window.addEventListener('agzos:file-saved', () => refreshGit());
  window.addEventListener('focus', () => refreshGit());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshGit(); });
  if (window.agzos?.git?.onProgress) window.agzos.git.onProgress(onProgress);

  // Ao abrir o painel, atualiza tudo
  const obs = new MutationObserver(() => { if (!host.hidden) refreshGit({ log: true }); });
  obs.observe(host, { attributes: true, attributeFilter: ['hidden'] });

  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.hidden || !State.workspaceRoot || G.busy || isGitDialogOpen()) return;
    refreshGit();
  }, POLL_MS);

  refreshGit({ log: true });
}

export function showGitPanel() {
  if (deps.switchSidebarView) deps.switchSidebarView('git');
  else document.querySelector('.activity-btn[data-view="git"]')?.click();
  document.body.classList.remove('sidebar-hidden');
}

function buildSkeleton(host) {
  const root = h('div', 'git-view');
  root.dataset.state = 'loading';

  const header = h('div', 'git-head');
  const compose = h('div', 'git-compose');
  const textarea = h('textarea', 'git-message');
  textarea.id = 'git-commit-message';
  textarea.rows = 1;
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', 'Mensagem do commit');
  textarea.addEventListener('input', () => { G.message = textarea.value; autoGrow(textarea); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      doCommit({ push: e.shiftKey });
    }
  });
  const actions = h('div', 'git-commit-actions');
  const commitBtn = h('button', 'git-btn git-btn-primary git-commit-btn');
  commitBtn.type = 'button';
  commitBtn.id = 'git-commit';
  commitBtn.append(icon('check', 15, 2.2), h('span', null, 'Commit'));
  commitBtn.addEventListener('click', () => doCommit({ push: false }));
  const pushBtn = h('button', 'git-btn git-btn-quiet git-commit-push-btn');
  pushBtn.type = 'button';
  pushBtn.id = 'git-commit-push';
  pushBtn.title = 'Commit e Push (Ctrl+Shift+Enter)';
  pushBtn.append(icon('cloud-upload', 15), h('span', null, 'Commit e Push'));
  pushBtn.addEventListener('click', () => doCommit({ push: true }));
  actions.append(commitBtn, pushBtn);
  compose.append(textarea, actions);

  const lists = h('div', 'git-lists');
  const empty = h('div', 'git-empty');

  root.append(header, compose, lists, empty);
  host.append(root);
  return { root, header, compose, textarea, commitBtn, pushBtn, lists, empty };
}

function autoGrow(t) {
  t.style.height = 'auto';
  const hgt = Math.min(160, Math.max(30, t.scrollHeight));
  t.style.height = `${hgt}px`;
  t.style.overflowY = t.scrollHeight > 160 ? 'auto' : 'hidden';
}

/* --------------------------------------------------------------------------
   Refresh
   -------------------------------------------------------------------------- */
export function getGitState() {
  return { view: G.view, status: G.status, log: G.log, account: G.account };
}

export async function refreshGit({ log = false } = {}) {
  if (refreshing) {
    refreshQueued = refreshQueued || { log };
    if (log) refreshQueued.log = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      await doRefresh({ log });
    } catch (e) {
      console.error('[git] refresh falhou', e);
    }
  })();
  await refreshing;
  refreshing = null;
  if (refreshQueued) {
    const next = refreshQueued;
    refreshQueued = false;
    await refreshGit(next);
  }
}

async function doRefresh({ log }) {
  if (!els) return;
  if (!G.available || !G.available.ok) {
    try { G.available = await git.available(); } catch (e) { G.available = { ok: false, message: e.message }; }
  }
  const root = cwd();
  if (!G.available.ok) {
    setView('nogit');
  } else if (!root) {
    G.status = null;
    setView('nofolder');
  } else {
    let st;
    try {
      st = await git.status(root);
    } catch (e) {
      G.error = e.message;
      if (e.kind === 'git-missing') { G.available = { ok: false, message: e.message }; setView('nogit'); }
      else setView('error');
      finishRefresh();
      return;
    }
    if (root !== cwd()) return; // trocou de pasta no meio
    if (st.notRepo) {
      G.status = st;
      setView('norepo');
    } else {
      G.status = st;
      const logKey = `${st.root}|${st.oid}|${st.branch}`;
      if (log || logKey !== G.logKey) {
        G.logKey = logKey;
        try { G.log = await git.log(root, 50); } catch { G.log = []; }
      }
      const accountKey = `${st.root}|${JSON.stringify(st.remotes)}`;
      if (accountKey !== G.accountKey || log) {
        G.accountKey = accountKey;
        try { G.account = await github.accountForCwd(root); } catch { G.account = null; }
      }
      setView('repo');
    }
  }
  finishRefresh();
}

function finishRefresh() {
  render();
  updateStatusBar();
  updateBadge();
  setGitDecorations(G.view === 'repo' ? G.status : null, cwd());
}

function setView(v) {
  G.view = v;
  if (els) els.root.dataset.state = v;
}

/* --------------------------------------------------------------------------
   Render
   -------------------------------------------------------------------------- */
function render() {
  if (!els) return;
  renderHeader();
  const repo = G.view === 'repo';
  els.compose.hidden = !repo;
  els.lists.hidden = !repo;
  els.empty.hidden = repo;
  if (repo) {
    renderCompose();
    renderLists();
  } else {
    renderEmpty();
  }
}

function renderHeader() {
  if (!els) return;
  const head = els.header;
  head.replaceChildren();
  head.hidden = G.view !== 'repo';
  if (G.view !== 'repo') return;
  const st = G.status;

  const branchBtn = h('button', 'git-branch-btn');
  branchBtn.type = 'button';
  branchBtn.id = 'git-branch-btn';
  branchBtn.title = 'Trocar ou criar branch';
  branchBtn.setAttribute('aria-haspopup', 'menu');
  branchBtn.append(icon('git-branch', 14, 2));
  const name = h('span', 'git-branch-name', st.branch || (st.oid ? `${st.oid.slice(0, 7)} (destacado)` : 'sem commits'));
  branchBtn.append(name, icon('chevron-down', 13, 2));
  branchBtn.addEventListener('click', () => openBranchMenu(branchBtn));

  const right = h('div', 'git-head-actions');
  const syncBtn = h('button', 'git-sync-btn');
  syncBtn.type = 'button';
  syncBtn.id = 'git-sync-btn';
  const hasRemote = st.remotes?.length > 0;
  if (!hasRemote) {
    syncBtn.title = 'Publicar no GitHub';
    syncBtn.append(githubMark(13), h('span', null, 'Publicar'));
    syncBtn.addEventListener('click', () => openPublishDialog());
  } else if (!st.upstream && st.branch) {
    syncBtn.title = 'Publicar branch no remoto';
    syncBtn.append(icon('cloud-upload', 14), h('span', null, 'Publicar'));
    syncBtn.addEventListener('click', () => runGitCommand('push'));
  } else {
    syncBtn.title = `Sincronizar: ${st.behind} para baixar, ${st.ahead} para enviar`;
    syncBtn.append(icon('refresh-cw', 13, 2));
    const counts = h('span', 'git-counts');
    const down = h('span', st.behind ? 'on' : '', `↓${st.behind}`);
    const up = h('span', st.ahead ? 'on' : '', `↑${st.ahead}`);
    counts.append(down, up);
    syncBtn.append(counts);
    syncBtn.addEventListener('click', () => runGitCommand('sync'));
  }
  if (G.busy) {
    syncBtn.disabled = true;
    syncBtn.classList.add('spinning');
  }
  right.append(syncBtn);

  if (G.account?.github) {
    const acc = G.account.account;
    const chip = h('button', 'git-account-chip');
    chip.type = 'button';
    chip.id = 'git-account-chip';
    chip.title = acc ? `Conta GitHub deste repositório: @${acc.login}` : 'Escolher conta GitHub para este repositório';
    if (acc) chip.append(avatarEl(acc, 16));
    else chip.append(githubMark(13));
    chip.addEventListener('click', () => pickAccountForRepo());
    right.append(chip);
  }
  right.append(iconBtn('ellipsis', 'Mais ações do Git', (e) => openMoreMenu(e.currentTarget), 'git-more-btn'));

  const busy = h('div', 'git-busy');
  busy.setAttribute('aria-live', 'polite');
  if (G.busy) busy.textContent = `${G.busy}…`;
  busy.hidden = !G.busy;
  head.append(branchBtn, right, busy);
}

function renderCompose() {
  const st = G.status;
  const t = els.textarea;
  if (t.value !== G.message && document.activeElement !== t) t.value = G.message;
  t.placeholder = 'Mensagem do commit';
  t.title = `Ctrl+Enter faz commit em ${st.branch || 'HEAD'} (Ctrl+Shift+Enter: commit e push)`;
  autoGrow(t);
  const hasChanges = st.count > 0;
  els.commitBtn.disabled = !!G.busy || !hasChanges;
  els.pushBtn.disabled = !!G.busy || !hasChanges;
  els.pushBtn.hidden = !st.remotes?.length;
}

function renderLists() {
  const st = G.status;
  const scroll = els.lists.scrollTop;
  els.lists.replaceChildren();

  if (st.conflicts.length) {
    els.lists.append(section('conflicts', 'Conflitos', st.conflicts, {
      actions: [['plus', 'Marcar todos como resolvidos (stage)', () => stagePaths(st.conflicts.map((f) => f.path))]],
      kind: 'conflict',
    }));
  }
  if (st.staged.length) {
    els.lists.append(section('staged', 'Preparadas', st.staged, {
      actions: [['minus', 'Remover tudo da preparação', () => unstagePaths([])]],
      kind: 'staged',
    }));
  }
  els.lists.append(section('changes', 'Alterações', st.changes, {
    actions: st.changes.length ? [
      ['undo-2', 'Descartar todas as alterações', () => discardPaths(st.changes)],
      ['plus', 'Preparar todas', () => stagePaths([])],
    ] : [],
    kind: 'changes',
    emptyText: st.staged.length ? 'Nada fora da preparação.' : 'Árvore de trabalho limpa.',
  }));
  els.lists.append(historySection());
  els.lists.scrollTop = scroll;
}

function section(id, title, files, { actions = [], kind, emptyText } = {}) {
  const sec = h('section', 'git-section');
  sec.dataset.group = id;
  const collapsed = !!G.collapsed[id];
  sec.classList.toggle('collapsed', collapsed);
  const head = h('div', 'git-section-head');
  const toggle = h('button', 'git-section-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.append(icon('chevron-right', 13, 2.2), h('span', 'git-section-title', title));
  const count = h('span', 'git-count', String(files.length));
  toggle.append(count);
  toggle.addEventListener('click', () => { G.collapsed[id] = !G.collapsed[id]; renderLists(); });
  const acts = h('div', 'git-section-actions');
  for (const [ic, label, fn] of actions) acts.append(iconBtn(ic, label, fn));
  head.append(toggle, acts);
  sec.append(head);
  if (!collapsed) {
    const list = h('ul', 'git-files');
    list.setAttribute('role', 'list');
    if (!files.length && emptyText) {
      const li = h('li', 'git-files-empty', emptyText);
      list.append(li);
    }
    for (const f of files) list.append(fileRow(f, kind));
    sec.append(list);
  }
  return sec;
}

function fileRow(f, kind) {
  const li = h('li', 'git-file');
  li.dataset.path = f.path;
  li.tabIndex = 0;
  const letter = kind === 'conflict' ? '!' : f.status;
  const info = STATUS_INFO[letter] || STATUS_INFO.M;
  li.classList.add(`st-${info.cls}`);
  const { name, dir } = splitPath(f.path);
  const theme = State.settings?.iconTheme || 'lucide-color';
  let ic;
  try { ic = renderFileIcon(name, theme); } catch { ic = icon('file', 14); }
  ic.classList?.add('git-file-icon');
  const label = h('span', 'git-file-label');
  const nm = h('span', 'git-file-name', name);
  label.append(nm);
  if (f.origPath) label.append(h('span', 'git-file-orig', `← ${splitPath(f.origPath).name}`));
  if (dir) label.append(h('span', 'git-file-dir', dir));
  li.title = `${f.origPath ? `${f.origPath} → ` : ''}${f.path} · ${info.label}`;

  const acts = h('span', 'git-file-actions');
  const abs = absPath(f.path);
  if (letter !== 'D' && abs) acts.append(iconBtn('file', 'Abrir arquivo', () => editorApi.openFile(abs)));
  if (kind === 'staged') {
    acts.append(iconBtn('minus', 'Remover da preparação', () => unstagePaths([f.path])));
  } else if (kind === 'conflict') {
    acts.append(iconBtn('plus', 'Marcar como resolvido (stage)', () => stagePaths([f.path])));
  } else {
    acts.append(iconBtn('undo-2', 'Descartar alterações', () => discardPaths([f])));
    acts.append(iconBtn('plus', 'Preparar (stage)', () => stagePaths([f.path])));
  }
  const badge = h('span', 'git-file-status', letter);
  badge.setAttribute('aria-label', info.label);
  li.append(ic, label, acts, badge);

  const open = () => openDiff(f, kind);
  li.addEventListener('click', open);
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); open(); }
    else if (e.key === ' ' && kind !== 'staged') { e.preventDefault(); stagePaths([f.path]); }
  });
  return li;
}

function historySection() {
  const sec = h('section', 'git-section git-history');
  sec.dataset.group = 'history';
  const collapsed = !!G.collapsed.history;
  sec.classList.toggle('collapsed', collapsed);
  const head = h('div', 'git-section-head');
  const toggle = h('button', 'git-section-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.append(icon('chevron-right', 13, 2.2), h('span', 'git-section-title', 'Histórico'));
  toggle.append(h('span', 'git-count', String(G.log.length)));
  toggle.addEventListener('click', () => { G.collapsed.history = !G.collapsed.history; renderLists(); });
  const acts = h('div', 'git-section-actions');
  acts.append(iconBtn('refresh-cw', 'Atualizar histórico', () => refreshGit({ log: true })));
  head.append(toggle, acts);
  sec.append(head);
  if (collapsed) return sec;

  const list = h('ol', 'git-log');
  if (!G.log.length) {
    list.append(h('li', 'git-files-empty', 'Nenhum commit ainda.'));
  }
  const now = Date.now();
  const st = G.status;
  G.log.forEach((c, i) => {
    const li = h('li', 'git-commit');
    if (i === 0) li.classList.add('head');
    if (i < st.ahead) li.classList.add('unpushed');
    if (c.parents.length > 1) li.classList.add('merge');
    li.dataset.hash = c.hash;
    li.title = `${c.hash}\n${c.author} <${c.email}>\n${new Date(c.date).toLocaleString('pt-BR')}\n\n${c.subject}`;
    const rail = h('span', 'git-rail');
    rail.append(h('span', 'git-dot'));
    const bodyEl = h('div', 'git-commit-body');
    const subj = h('div', 'git-commit-subject', c.subject || '(sem mensagem)');
    const meta = h('div', 'git-commit-meta');
    const hash = h('button', 'git-hash', c.short);
    hash.type = 'button';
    hash.title = 'Copiar hash';
    hash.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(c.hash); toast('Hash copiado.', 'success', 1200); } catch { /* sem clipboard */ }
    });
    meta.append(hash, h('span', 'git-commit-author', c.author), h('span', 'git-commit-time', relativeTime(c.date, now)));
    bodyEl.append(subj);
    const refs = c.refs.filter((r) => r !== 'HEAD');
    if (refs.length) {
      const tags = h('div', 'git-refs');
      for (const r of refs) {
        const label = r.replace(/^HEAD -> /, '').replace(/^tag: /, '');
        const t = h('span', `git-ref${r.startsWith('HEAD -> ') ? ' current' : ''}${r.includes('/') && !r.startsWith('tag:') ? ' remote' : ''}`, label);
        tags.append(t);
      }
      bodyEl.append(tags);
    }
    bodyEl.append(meta);
    li.append(rail, bodyEl);
    list.append(li);
  });
  sec.append(list);
  return sec;
}

function renderEmpty() {
  const box = els.empty;
  box.replaceChildren();
  const card = h('div', 'git-empty-card');
  const mark = h('div', 'git-empty-mark');
  const title = h('h3', 'git-empty-title');
  const text = h('p', 'git-empty-text');
  const actions = h('div', 'git-empty-actions');
  const btn = (label, cls, fn, id) => {
    const b = h('button', `git-btn ${cls}`, label);
    b.type = 'button';
    if (id) b.id = id;
    b.addEventListener('click', fn);
    actions.append(b);
    return b;
  };
  if (G.view === 'loading') {
    mark.append(icon('loader-circle', 22));
    mark.classList.add('spin');
    title.textContent = 'Lendo repositório';
  } else if (G.view === 'nogit') {
    mark.append(icon('triangle-alert', 22));
    title.textContent = 'Git não encontrado';
    text.textContent = 'Instale o Git e reinicie o Agzos Code para usar o controle de versão.';
    btn('Baixar o Git', 'git-btn-primary', () => window.agzos.app.openExternal(G.available?.installUrl || GIT_DOWNLOAD_URL), 'git-install');
    btn('Verificar de novo', 'git-btn-ghost', () => { G.available = null; refreshGit({ log: true }); });
  } else if (G.view === 'nofolder') {
    mark.append(icon('folder-open', 22));
    title.textContent = 'Nenhuma pasta aberta';
    text.textContent = 'Abra uma pasta com um repositório Git ou clone um do GitHub.';
    btn('Abrir pasta', 'git-btn-primary', async () => {
      const p = await window.agzos.dialog.openFolder();
      if (p) (await import('./file-tree.js')).openWorkspace(p);
    });
    btn('Clonar repositório', 'git-btn-ghost', () => openCloneDialog(), 'git-clone');
  } else if (G.view === 'norepo') {
    mark.append(icon('git-branch-plus', 22));
    title.textContent = 'Esta pasta não é um repositório Git';
    text.textContent = 'Inicialize um repositório para acompanhar alterações, ou publique direto no GitHub.';
    btn('Inicializar repositório', 'git-btn-primary', () => runGitCommand('init'), 'git-init');
    const pub = btn('', 'git-btn-ghost', () => openPublishDialog(), 'git-publish');
    pub.append(githubMark(14), h('span', null, 'Publicar no GitHub'));
  } else {
    mark.append(icon('circle-alert', 22));
    title.textContent = 'Não foi possível ler o repositório';
    text.textContent = G.error || '';
    btn('Tentar de novo', 'git-btn-primary', () => refreshGit({ log: true }));
  }
  card.append(mark, title);
  if (text.textContent) card.append(text);
  if (actions.childElementCount) card.append(actions);
  box.append(card);
}

/* --------------------------------------------------------------------------
   Status bar e badge
   -------------------------------------------------------------------------- */
function updateStatusBar() {
  const remote = document.getElementById('status-remote');
  const sync = document.getElementById('status-sync');
  const st = G.status;
  const repo = G.view === 'repo' && st;
  if (remote) {
    remote.hidden = !repo;
    if (repo) {
      const name = st.branch || (st.oid ? st.oid.slice(0, 7) : 'sem commits');
      const dirty = st.count > 0;
      remote.replaceChildren(icon('git-branch', 12, 1.8), h('span', 'git-status-name', name + (dirty ? '*' : '')));
      remote.title = `${name}${dirty ? ` — ${st.count} alteraç${st.count === 1 ? 'ão' : 'ões'}` : ''} (abrir painel Git)`;
      remote.dataset.dirty = String(dirty);
    }
  }
  if (sync) {
    const show = repo && st.upstream;
    sync.hidden = !show;
    if (show) {
      sync.replaceChildren(icon('refresh-cw', 11, 2), h('span', null, `${st.behind}↓ ${st.ahead}↑`));
      sync.title = `Sincronizar: ${st.behind} para baixar, ${st.ahead} para enviar`;
    }
  }
}

function updateBadge() {
  const badge = document.querySelector('.activity-btn[data-view="git"] .activity-badge');
  if (!badge) return;
  const n = G.view === 'repo' ? G.status.count : 0;
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n);
}

/* --------------------------------------------------------------------------
   Ações de arquivo
   -------------------------------------------------------------------------- */
async function stagePaths(paths) {
  await withBusy('Preparando', () => git.stage(cwd(), paths)).catch(() => {});
}

async function unstagePaths(paths) {
  await withBusy('Removendo da preparação', () => git.unstage(cwd(), paths)).catch(() => {});
}

async function discardPaths(files) {
  const untracked = files.filter((f) => f.untracked).length;
  const one = files.length === 1;
  const message = one
    ? (files[0].untracked
      ? `O arquivo "${files[0].path}" não é rastreado e será APAGADO. Isso não pode ser desfeito.`
      : `As alterações em "${files[0].path}" serão perdidas. Isso não pode ser desfeito.`)
    : `As alterações em ${files.length} arquivos serão perdidas${untracked ? ` e ${untracked} arquivo(s) não rastreado(s) serão APAGADOS` : ''}. Isso não pode ser desfeito.`;
  const okay = await confirmGit({ title: one ? 'Descartar alterações?' : 'Descartar todas as alterações?', message, confirmLabel: 'Descartar', danger: true });
  if (!okay) return;
  const paths = files.map((f) => f.path);
  await withBusy('Descartando', () => git.discard(cwd(), paths)).catch(() => {});
  // Arquivos abertos no editor: recarrega do disco
  for (const f of files) {
    const abs = absPath(f.path);
    if (abs && State.files?.has(abs) && editorApi.handleExternalChange) {
      try { await editorApi.handleExternalChange(abs, { force: true }); } catch { /* fechado */ }
    }
  }
}

async function openDiff(f, kind) {
  try {
    const staged = kind === 'staged';
    const d = await git.diffFile(cwd(), f.path, { staged, origPath: f.origPath });
    if (d.binary) { toast('Arquivo binário: sem diff de texto.', 'info'); return; }
    if (d.tooLarge) { toast('Arquivo grande demais para o diff.', 'info'); return; }
    const language = editorApi.languageForPath ? editorApi.languageForPath(f.path) : undefined;
    await showDiff({
      title: `${f.path} — ${staged ? 'HEAD ↔ Preparado' : 'HEAD ↔ Working Tree'}`,
      original: d.original,
      modified: d.modified,
      language,
      readOnly: true,
    });
  } catch (e) {
    handleError(e);
  }
}

/* --------------------------------------------------------------------------
   Commit
   -------------------------------------------------------------------------- */
async function doCommit({ push = false } = {}) {
  const st = G.status;
  if (G.view !== 'repo' || G.busy) return;
  const message = els.textarea.value.trim();
  if (!message) {
    toast('Escreva uma mensagem de commit.', 'error');
    els.textarea.focus();
    return;
  }
  if (!st.staged.length) {
    if (!st.changes.length && !st.conflicts.length) { toast('Nada para commitar.', 'info'); return; }
    const okay = await confirmGit({
      title: 'Preparar todas as alterações?',
      message: 'Não há alterações preparadas. Preparar todas e fazer o commit?',
      confirmLabel: 'Preparar e commitar',
    });
    if (!okay) return;
  }
  try {
    await withBusy(push ? 'Commit e push' : 'Commit', async () => {
      if (!st.staged.length) await git.stage(cwd(), []);
      let res;
      try {
        res = await commitRaw(message);
      } catch (e) {
        if (e?.kind !== 'secrets_detected') throw e;
        const choice = await showSecretsBlockedDialog(e.findings || []);
        if (choice === 'unstage') {
          const files = [...new Set((e.findings || []).map((f) => f.file))];
          await git.unstage(cwd(), files);
          toast(`${files.length === 1 ? '1 arquivo removido' : `${files.length} arquivos removidos`} do stage.`, 'info', 3000);
          return;
        }
        if (choice !== 'ignore') return;
        res = await commitRaw(message, { ignoreSecretsOnce: true });
      }
      G.message = '';
      els.textarea.value = '';
      autoGrow(els.textarea);
      if (push) {
        await git.push(cwd());
        toast(`Commit ${res.hash} enviado.`, 'success');
      } else {
        toast(`Commit ${res.hash} criado.`, 'success', 2000);
      }
    });
  } catch { /* já notificado */ }
}

/** git:commit sem o unwrap genérico: preserva `findings` do bloqueio do Cofre .env. */
async function commitRaw(message, options) {
  const res = await window.agzos.git.commit(cwd(), message, options);
  if (res && res.ok === true) return res.data;
  const err = new GitUiError(res?.error?.message || 'Falha', res?.error?.kind);
  if (Array.isArray(res?.error?.findings)) err.findings = res.error.findings;
  throw err;
}

const RULE_LABELS = {
  'env-file': 'arquivo .env no stage',
  'aws-access-key': 'chave de acesso AWS',
  'aws-secret-key': 'segredo AWS',
  stripe: 'chave Stripe',
  openai: 'chave OpenAI',
  anthropic: 'chave Anthropic',
  github: 'token GitHub',
  'google-api-key': 'chave de API Google',
  slack: 'token Slack',
  jwt: 'JWT/chave Supabase',
  'private-key': 'chave privada',
  'url-credentials': 'URL com senha',
  'generic-secret': 'possível segredo',
};

async function openFindingAt(f) {
  const abs = absPath(f.file);
  if (!abs) return;
  await editorApi.openFile(abs);
  const ed = editorApi.getActiveEditor();
  if (ed && f.line > 0) {
    ed.revealLineInCenter(f.line);
    ed.setPosition({ lineNumber: f.line, column: 1 });
    ed.focus();
  }
}

/**
 * Diálogo "Commit bloqueado: possíveis segredos".
 * → Promise<'cancel' | 'unstage' | 'ignore'>. Cancelar tem o foco padrão; Esc cancela.
 * Só mostra arquivo:linha:regra e o preview mascarado (o valor nunca chega ao renderer).
 */
export function showSecretsBlockedDialog(findings) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = h('div', 'git-dialog-overlay');
    overlay.setAttribute('role', 'presentation');
    const dialog = h('div', 'git-dialog envvault-blocked');
    dialog.id = 'envvault-blocked-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const head = h('div', 'git-dialog-head');
    const ic = h('span', 'git-dialog-icon');
    ic.append(icon('shield-alert', 18));
    const title = h('h2', 'git-dialog-title', 'Commit bloqueado: possíveis segredos');
    title.id = 'envvault-blocked-title';
    dialog.setAttribute('aria-labelledby', title.id);
    head.append(ic, title);
    const desc = h('p', 'git-dialog-desc',
      'O Cofre .env encontrou o que parecem ser segredos nas alterações preparadas. Revise antes de commitar.');
    const list = h('ul', 'envvault-findings');
    for (const f of findings) {
      const li = h('li', 'envvault-finding');
      const btn = h('button', 'envvault-finding-link');
      btn.type = 'button';
      btn.title = 'Abrir no editor';
      btn.append(h('span', 'envvault-finding-file', f.line > 0 ? `${f.file}:${f.line}` : f.file));
      btn.append(h('span', 'envvault-finding-rule', RULE_LABELS[f.rule] || f.rule));
      if (f.preview) btn.append(h('code', 'envvault-finding-preview', f.preview));
      btn.addEventListener('click', () => { close('cancel'); openFindingAt(f); });
      li.append(btn);
      list.append(li);
    }
    const actions = h('div', 'git-dialog-actions');
    const cancel = h('button', 'git-btn git-btn-primary', 'Cancelar');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel';
    const unstage = h('button', 'git-btn git-btn-ghost', 'Remover do stage');
    unstage.type = 'button';
    unstage.dataset.action = 'unstage';
    const ignore = h('button', 'git-btn git-btn-danger', 'Ignorar uma vez');
    ignore.type = 'button';
    ignore.dataset.action = 'ignore';
    actions.append(ignore, unstage, cancel);
    dialog.append(head, desc, list, actions);
    overlay.append(dialog);
    document.body.append(overlay);

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('cancel'); }
    }
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close('cancel'));
    unstage.addEventListener('click', () => close('unstage'));
    ignore.addEventListener('click', () => close('ignore'));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close('cancel'); });
    setTimeout(() => cancel.focus(), 30);
  });
}

/* --------------------------------------------------------------------------
   Menus (branch / mais ações)
   -------------------------------------------------------------------------- */
let activePopover = null;
function closePopover() {
  if (activePopover) { activePopover.cleanup(); activePopover = null; }
}

function openPopover(anchor, build, { id, width = 280 } = {}) {
  closePopover();
  const pop = h('div', 'git-popover');
  if (id) pop.id = id;
  pop.setAttribute('role', 'menu');
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.minWidth = `${Math.max(width, r.width)}px`;
  pop.style.top = `${Math.round(r.bottom + 4)}px`;
  const left = Math.min(r.left, window.innerWidth - Math.max(width, r.width) - 8);
  pop.style.left = `${Math.max(8, Math.round(left))}px`;
  const onDown = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePopover(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); anchor.focus(); }
  };
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  document.addEventListener('keydown', onKey, true);
  activePopover = {
    el: pop,
    cleanup: () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      pop.remove();
    },
  };
  build(pop);
  return pop;
}

function menuItem(label, { iconName, iconNode, hint, onClick, cls = '', danger = false } = {}) {
  const b = h('button', `git-menu-item ${cls} ${danger ? 'danger' : ''}`.trim());
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  const ic = h('span', 'git-menu-icon');
  if (iconNode) ic.append(iconNode);
  else if (iconName) ic.append(icon(iconName, 14));
  b.append(ic, h('span', 'git-menu-label', label));
  if (hint) b.append(h('span', 'git-menu-hint', hint));
  b.addEventListener('click', () => { closePopover(); onClick?.(); });
  return b;
}

async function openBranchMenu(anchor) {
  if (G.view !== 'repo') return;
  let data;
  try { data = await git.branches(cwd()); } catch (e) { handleError(e); return; }
  openPopover(anchor, (pop) => {
    const search = h('input', 'git-menu-search');
    search.id = 'git-branch-search';
    search.placeholder = 'Trocar ou criar branch…';
    search.spellcheck = false;
    search.setAttribute('aria-label', 'Filtrar branches');
    const list = h('div', 'git-menu-list');
    pop.append(search, list);

    const draw = () => {
      const q = search.value.trim();
      const ql = q.toLowerCase();
      list.replaceChildren();
      const exists = data.local.some((b) => b.name === q);
      if (q && !exists) {
        list.append(menuItem(`Criar branch "${q}"`, { iconName: 'git-branch-plus', cls: 'create', onClick: () => createBranch(q) }));
      } else if (!q) {
        list.append(menuItem('Criar nova branch…', { iconName: 'git-branch-plus', cls: 'create', onClick: () => createBranchDialog() }));
      }
      const locals = data.local.filter((b) => b.name.toLowerCase().includes(ql));
      if (locals.length) {
        list.append(h('div', 'git-menu-group', 'Locais'));
        for (const b of locals) {
          const hint = [b.ahead ? `↑${b.ahead}` : '', b.behind ? `↓${b.behind}` : '', b.gone ? 'remota apagada' : ''].filter(Boolean).join(' ');
          list.append(menuItem(b.name, {
            iconName: b.current ? 'check' : 'git-branch',
            hint: hint || (b.current ? 'atual' : ''),
            cls: b.current ? 'current' : '',
            onClick: () => { if (!b.current) checkoutBranch(b.name); },
          }));
        }
      }
      const localNames = new Set(data.local.map((b) => b.name));
      const remotes = data.remote.filter((b) => b.name.toLowerCase().includes(ql) && !localNames.has(b.name.split('/').slice(1).join('/')));
      if (remotes.length) {
        list.append(h('div', 'git-menu-group', 'Remotas'));
        for (const b of remotes) list.append(menuItem(b.name, { iconName: 'cloud', onClick: () => checkoutBranch(b.name) }));
      }
      if (!list.childElementCount) list.append(h('div', 'git-menu-empty', 'Nenhuma branch encontrada.'));
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', (e) => {
      const items = [...list.querySelectorAll('.git-menu-item')];
      if (e.key === 'Enter') {
        e.preventDefault();
        (list.querySelector('.git-menu-item.kbd') || items[0])?.click();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = items.findIndex((x) => x.classList.contains('kbd'));
        const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, cur + 1) : Math.max(0, cur - 1);
        items.forEach((x, i) => x.classList.toggle('kbd', i === next));
        items[next]?.scrollIntoView({ block: 'nearest' });
      }
    });
    draw();
    setTimeout(() => search.focus(), 10);
  }, { id: 'git-branch-menu', width: 300 });
}

function openMoreMenu(anchor) {
  const st = G.status;
  openPopover(anchor, (pop) => {
    const hasRemote = st?.remotes?.length > 0;
    pop.append(
      menuItem('Pull', { iconName: 'arrow-down', hint: '--ff-only', onClick: () => runGitCommand('pull') }),
      menuItem('Push', { iconName: 'arrow-up', onClick: () => runGitCommand('push') }),
      menuItem('Fetch', { iconName: 'download', onClick: () => runGitCommand('fetch') }),
      menuItem('Sincronizar', { iconName: 'refresh-cw', hint: 'pull + push', onClick: () => runGitCommand('sync') }),
      h('div', 'git-menu-sep'),
      menuItem('Criar branch…', { iconName: 'git-branch-plus', onClick: () => createBranchDialog() }),
      menuItem('Trocar branch…', { iconName: 'git-branch', onClick: () => runGitCommand('checkout') }),
      h('div', 'git-menu-sep'),
    );
    if (G.account?.github) {
      pop.append(menuItem('Criar Pull Request…', { iconName: 'git-pull-request', onClick: () => openPrDialog() }));
      pop.append(menuItem('Conta GitHub do repositório…', { iconNode: githubMark(13), onClick: () => pickAccountForRepo() }));
    } else if (!hasRemote) {
      pop.append(menuItem('Publicar no GitHub…', { iconNode: githubMark(13), onClick: () => openPublishDialog() }));
    }
    pop.append(
      menuItem('Clonar repositório…', { iconName: 'git-fork', onClick: () => openCloneDialog() }),
      menuItem('Atualizar', { iconName: 'refresh-cw', onClick: () => refreshGit({ log: true }) }),
    );
  }, { id: 'git-more-menu', width: 230 });
}

async function checkoutBranch(name) {
  await withBusy(`Trocando para ${name}`, async () => {
    const r = await git.checkout(cwd(), name);
    toast(`Branch: ${r.branch}`, 'success', 1500);
  }).catch(() => {});
  (await import('./file-tree.js')).refreshTree(true);
}

async function createBranch(name, { checkout = true } = {}) {
  await withBusy(`Criando ${name}`, async () => {
    await git.createBranch(cwd(), name, { checkout });
    toast(`Branch ${name} criada.`, 'success', 1800);
  }).catch(() => {});
}

async function createBranchDialog() {
  if (!(await ensureRepo())) return;
  await openGitDialog({
    id: 'git-create-branch-dialog',
    title: 'Criar branch',
    icon: 'git-branch-plus',
    description: `A partir de ${G.status.branch || 'HEAD'}.`,
    submitLabel: 'Criar e trocar',
    fields: [{ name: 'name', label: 'Nome da branch', placeholder: 'feat/minha-mudanca', required: true }],
    onSubmit: async ({ name }) => {
      await git.createBranch(cwd(), name.trim(), { checkout: true });
      toast(`Branch ${name.trim()} criada.`, 'success', 1800);
      await refreshGit({ log: true });
    },
  });
}

async function ensureRepo() {
  if (G.view !== 'repo') {
    await refreshGit();
    if (G.view !== 'repo') {
      toast(G.view === 'nofolder' ? 'Abra uma pasta primeiro.' : G.view === 'nogit' ? 'Git não encontrado.' : 'Esta pasta não é um repositório Git.', 'error');
      return false;
    }
  }
  return true;
}

/* --------------------------------------------------------------------------
   Contas GitHub
   -------------------------------------------------------------------------- */
async function loadAccounts() {
  const list = await github.accounts();
  State.settings.github = { ...(State.settings.github || {}), ...list };
  return list;
}

function accountOptions(list, { allowNone = false, noneLabel = 'Nenhuma' } = {}) {
  const opts = list.accounts.map((a) => ({ value: a.id, label: `@${a.login}${a.name && a.name !== a.login ? ` (${a.name})` : ''}` }));
  return allowNone ? [{ value: '', label: noneLabel }, ...opts] : opts;
}

async function pickAccountForRepo() {
  if (!(await ensureRepo())) return;
  if (!G.account?.remoteKey) { toast('O remote deste repositório não é do GitHub.', 'info'); return; }
  const list = await loadAccounts();
  if (!list.accounts.length) {
    toast('Adicione uma conta GitHub primeiro.', 'info');
    (await import('./settings-modal.js')).openSettingsModal('git');
    return;
  }
  const mapped = list.repoAccounts?.[G.account.remoteKey] || '';
  await openGitDialog({
    id: 'git-account-dialog',
    title: 'Conta GitHub deste repositório',
    description: `${G.account.github.owner}/${G.account.github.repo} — usada para push, pull e Pull Requests.`,
    submitLabel: 'Usar esta conta',
    fields: [{ name: 'account', label: 'Conta', type: 'select', value: mapped, options: accountOptions(list, { allowNone: true, noneLabel: 'Automática (dono do repositório ou padrão)' }) }],
    onSubmit: async ({ account }) => {
      await github.assign(cwd(), account || null);
      G.accountKey = null;
      await refreshGit({ log: true });
      toast('Conta associada ao repositório.', 'success', 1800);
    },
  });
}

/* --------------------------------------------------------------------------
   Clonar
   -------------------------------------------------------------------------- */
let progressListener = null;
function onProgress(p) { if (progressListener) progressListener(p); }

let lastCloneParent = null;
export async function openCloneDialog({ url = '' } = {}) {
  if (!G.available) { try { G.available = await git.available(); } catch { /* segue */ } }
  if (G.available && !G.available.ok) {
    toast(G.available.message || 'Git não encontrado.', 'error', 6000);
    return null;
  }
  let list = { accounts: [] };
  try { list = await loadAccounts(); } catch { /* sem contas */ }
  const requestId = `clone-${Date.now()}`;
  const result = await openGitDialog({
    id: 'git-clone-dialog',
    title: 'Clonar repositório',
    icon: 'git-fork',
    submitLabel: 'Clonar',
    fields: [
      { name: 'url', label: 'URL do repositório', value: url, placeholder: 'https://github.com/org/repo.git', required: true, autofocus: true },
      { name: 'parent', label: 'Pasta de destino', type: 'folder', value: lastCloneParent || '', placeholder: 'Escolha onde salvar…', required: true, pickLabel: 'Escolher…' },
      ...(list.accounts.length ? [{ name: 'account', label: 'Conta GitHub (repositórios privados)', type: 'select', value: '', options: accountOptions(list, { allowNone: true, noneLabel: 'Automática' }) }] : []),
    ],
    onFieldChange: (name, value, ctl) => {
      if (name === 'url' || name === 'parent') {
        const u = ctl.field('url').value.trim();
        const p = ctl.field('parent').value;
        const repo = u ? u.replace(/[\\/]+$/, '').replace(/\.git$/i, '').split(/[\\/:]/).pop() : '';
        ctl.setProgress(null, '');
        ctl.field('parent').closest('.git-field').querySelector('.git-field-hint')?.remove();
        if (p && repo) {
          const hint = h('small', 'git-field-hint', `Será criado ${p.replace(/[\\/]+$/, '')}${State.platform === 'win32' ? '\\' : '/'}${repo}`);
          ctl.field('parent').closest('.git-field').append(hint);
        }
        ctl.field('parent').closest('.git-dialog').querySelector('.git-progress').hidden = true;
      }
    },
    onSubmit: async ({ url: u, parent, account }, ctl) => {
      lastCloneParent = parent;
      ctl.setProgress(0, 'Conectando…');
      progressListener = (p) => {
        if (p.requestId !== requestId) return;
        ctl.setProgress(p.percent ?? null, p.text || '');
      };
      try {
        return await git.clone(u.trim(), parent, { accountId: account || undefined, requestId });
      } finally {
        progressListener = null;
      }
    },
  });
  if (!result?.path) return null;
  const { openWorkspace } = await import('./file-tree.js');
  await openWorkspace(result.path);
  toast('Repositório clonado.', 'success', 2500);
  return result;
}

/* --------------------------------------------------------------------------
   Publicar no GitHub
   -------------------------------------------------------------------------- */
export async function openPublishDialog() {
  const root = cwd();
  if (!root) { toast('Abra uma pasta primeiro.', 'error'); return null; }
  let list = { accounts: [], defaultAccountId: null };
  try { list = await loadAccounts(); } catch { /* sem contas */ }
  const folderName = root.split(/[\\/]/).filter(Boolean).pop() || 'repo';
  const noAccount = !list.accounts.length;
  const tokenHint = h('span');
  const link = h('a', null, 'Criar token no GitHub');
  link.href = '#';
  link.addEventListener('click', (e) => { e.preventDefault(); window.agzos.app.openExternal(TOKEN_URL); });
  tokenHint.append('Escopos: repo e read:user. ', link);
  const ownerOptions = (accId) => {
    const a = list.accounts.find((x) => x.id === accId);
    return a ? [{ value: '', label: `@${a.login} (pessoal)` }] : [{ value: '', label: 'Conta pessoal' }];
  };
  const firstAccount = list.defaultAccountId || list.accounts[0]?.id || '';
  const loadOrgs = async (accId, ctl) => {
    ctl.setOptions('owner', ownerOptions(accId), '');
    try {
      const orgs = await github.orgs(accId);
      ctl.setOptions('owner', [...ownerOptions(accId), ...orgs.map((o) => ({ value: o.login, label: `${o.login} (organização)` }))], '');
    } catch { /* sem orgs */ }
  };
  const result = await openGitDialog({
    id: 'git-publish-dialog',
    title: 'Publicar no GitHub',
    icon: githubMark(18),
    description: 'Cria o repositório no GitHub, liga esta pasta a ele e envia o código.',
    submitLabel: 'Publicar',
    fields: [
      ...(noAccount ? [{ name: 'token', label: 'Token do GitHub (PAT)', type: 'password', placeholder: 'ghp_…', required: true, hint: tokenHint }] : [
        { name: 'account', label: 'Conta', type: 'select', value: firstAccount, options: accountOptions(list) },
        { name: 'owner', label: 'Dono', type: 'select', value: '', options: ownerOptions(firstAccount) },
      ]),
      { name: 'name', label: 'Nome do repositório', value: folderName.replace(/[^\w.-]/g, '-'), required: true },
      { name: 'description', label: 'Descrição (opcional)', value: '' },
      { name: 'visibility', label: 'Visibilidade', type: 'radio', value: 'private', options: [{ value: 'private', label: 'Privado' }, { value: 'public', label: 'Público' }] },
    ],
    onOpen: (ctl) => { if (!noAccount && firstAccount) loadOrgs(firstAccount, ctl); },
    onFieldChange: async (name, value, ctl) => {
      if (name !== 'account') return;
      loadOrgs(value, ctl);
    },
    onSubmit: async (v, ctl) => {
      let accountId = v.account;
      if (noAccount) {
        ctl.setProgress(null, 'Validando token…');
        const added = await github.addPat(v.token.trim());
        accountId = added.account.id;
        await loadAccounts();
      }
      ctl.setProgress(null, 'Criando repositório e enviando…');
      return github.publish(root, {
        name: v.name.trim(),
        description: v.description,
        private: v.visibility !== 'public',
        accountId,
        org: v.owner || undefined,
      });
    },
  });
  if (result?.htmlUrl) {
    toast(`Publicado: ${result.fullName || result.htmlUrl}`, 'success', 4000);
    G.accountKey = null;
    await refreshGit({ log: true });
  }
  return result;
}

/* --------------------------------------------------------------------------
   Pull Request
   -------------------------------------------------------------------------- */
export async function openPrDialog() {
  if (!(await ensureRepo())) return null;
  let d;
  try { d = await github.prDefaults(cwd()); } catch (e) { handleError(e); return null; }
  const bases = d.bases.filter((b) => b !== d.head);
  if (!bases.includes(d.base) && d.base !== d.head) bases.unshift(d.base);
  const result = await openGitDialog({
    id: 'git-pr-dialog',
    title: 'Criar Pull Request',
    icon: 'git-pull-request',
    description: `Em ${d.owner}/${d.repo}, a partir da branch ${d.head}${d.account ? `, como @${d.account.login}` : ''}.`,
    submitLabel: 'Criar Pull Request',
    fields: [
      { name: 'base', label: 'Branch base', type: 'select', value: d.base, options: (bases.length ? bases : [d.base]).map((b) => ({ value: b, label: b })) },
      { name: 'title', label: 'Título', value: d.title, required: true, autofocus: true },
      { name: 'body', label: 'Descrição', type: 'textarea', value: '', rows: 5, placeholder: 'O que muda e por quê.' },
      { name: 'draft', label: 'Criar como rascunho', type: 'checkbox', value: false },
    ],
    onSubmit: async (v, ctl) => {
      ctl.setProgress(null, 'Enviando branch e criando o PR…');
      return github.createPr(cwd(), { base: v.base, title: v.title, body: v.body, draft: v.draft });
    },
  });
  if (result?.htmlUrl) {
    toast(`Pull Request #${result.number} criado.`, 'success', 4000);
    window.agzos.app.openExternal(result.htmlUrl);
    await refreshGit({ log: true });
  }
  return result;
}

/* --------------------------------------------------------------------------
   Comandos (paleta)
   -------------------------------------------------------------------------- */
export async function runGitCommand(id) {
  switch (id) {
    case 'clone': return openCloneDialog();
    case 'publish': return openPublishDialog();
    case 'init': {
      if (!cwd()) { toast('Abra uma pasta primeiro.', 'error'); return null; }
      return withBusy('Inicializando', async () => {
        await git.init(cwd());
        toast('Repositório inicializado.', 'success', 2000);
      }).catch(() => {});
    }
    default: break;
  }
  if (!(await ensureRepo())) return null;
  switch (id) {
    case 'commit':
      showGitPanel();
      if (els.textarea.value.trim()) return doCommit({ push: false });
      setTimeout(() => els.textarea.focus(), 30);
      return null;
    case 'commitPush':
      showGitPanel();
      return doCommit({ push: true });
    case 'push':
      return withBusy('Push', async () => { await git.push(cwd()); toast('Push concluído.', 'success', 1800); }).catch(() => {});
    case 'pull':
      return withBusy('Pull', async () => { await git.pull(cwd()); toast('Pull concluído.', 'success', 1800); }).catch(() => {});
    case 'fetch':
      return withBusy('Fetch', async () => { await git.fetch(cwd()); toast('Fetch concluído.', 'success', 1500); }).catch(() => {});
    case 'sync':
      return withBusy('Sincronizando', async () => { await git.sync(cwd()); toast('Sincronizado.', 'success', 1800); }).catch(() => {});
    case 'createBranch':
      return createBranchDialog();
    case 'checkout': {
      showGitPanel();
      await new Promise((r) => setTimeout(r, 30));
      const btn = document.getElementById('git-branch-btn');
      if (btn) return openBranchMenu(btn);
      return null;
    }
    case 'pr':
      return openPrDialog();
    case 'account':
      return pickAccountForRepo();
    default:
      return null;
  }
}
