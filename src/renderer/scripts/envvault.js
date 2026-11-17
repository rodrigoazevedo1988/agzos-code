/**
 * Cofre .env — interface (renderer).
 *
 * View no hub "Módulos Agzos": um cartão por arquivo `.env*`, valores sempre mascarados.
 * O valor real só entra no DOM depois de um pedido explícito de revelar (clique longo de
 * 500 ms ou Alt com o mouse sobre a linha) e sai após `revealTimeoutSec`.
 * Copiar usa o clipboard do main (o valor não passa por aqui). Editar não pré-preenche o valor.
 */

import { registerModule, openModule } from './modules-hub.js';
import { registerCommands } from './command-palette.js';
import { lucideIcon } from './lucide.js';
import { toast } from './toast.js';
import { confirmGit } from './git-dialog.js';
import * as editorApi from './editor.js';

const State = window.AgzosState;
const api = () => window.agzos.envVault;

const LONG_PRESS_MS = 500;
const MASK = '••••••••';
const RULE_LABELS = {
  'aws-access-key': 'chave AWS',
  'aws-secret-key': 'segredo AWS',
  stripe: 'Stripe',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  github: 'GitHub',
  'google-api-key': 'Google',
  slack: 'Slack',
  jwt: 'JWT',
  'private-key': 'chave privada',
  'url-credentials': 'URL com senha',
  'generic-secret': 'segredo',
  'env-file': 'arquivo .env no stage',
};

let view = null; // container da view aberta (null se fechada)
let hoveredRow = null;
const revealTimers = new Set();

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

function iconBtn(name, title, onClick, cls = '') {
  const b = el('button', `ev-icon-btn ${cls}`.trim());
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(icon(name));
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

function textBtn(label, onClick, { iconName, cls = '', id } = {}) {
  const b = el('button', `ev-btn ${cls}`.trim());
  b.type = 'button';
  if (id) b.id = id;
  if (iconName) b.append(icon(iconName, 13));
  b.append(el('span', null, label));
  b.addEventListener('click', onClick);
  return b;
}

/** "Error invoking remote method 'envvault:x': Error: msg" → "msg". */
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
  return State.settings?.modules?.envVault || {};
}

function revealMs() {
  const s = Number(settings().revealTimeoutSec);
  return (Number.isFinite(s) && s >= 1 ? s : 10) * 1000;
}

function root() {
  return State.workspaceRoot || null;
}

async function reloadInEditor(abs) {
  if (abs && State.files?.has?.(abs) && editorApi.handleExternalChange) {
    try { await editorApi.handleExternalChange(abs); } catch { /* arquivo fechado */ }
  }
}

/* -------------------------------------------------------------------------- */
/*  Revelar / esconder                                                         */
/* -------------------------------------------------------------------------- */

function hideValue(row) {
  const cell = row.querySelector('.ev-value');
  if (!cell || !row.classList.contains('revealed')) return;
  cell.textContent = row.dataset.masked || MASK;
  row.classList.remove('revealed');
  if (row._hideTimer) { clearTimeout(row._hideTimer); revealTimers.delete(row._hideTimer); row._hideTimer = null; }
}

async function revealRow(row) {
  if (!row || row.classList.contains('revealed') || row.dataset.missing === '1' || row._revealing) return;
  row._revealing = true;
  try {
    const res = await guarded(() => api().reveal(row.dataset.path, row.dataset.key));
    if (!res || !row.isConnected) return;
    const cell = row.querySelector('.ev-value');
    cell.textContent = res.value === '' ? '(vazia)' : res.value;
    row.classList.add('revealed');
    const t = setTimeout(() => { revealTimers.delete(t); hideValue(row); }, revealMs());
    revealTimers.add(t);
    row._hideTimer = t;
  } finally {
    row._revealing = false;
  }
}

function attachReveal(row) {
  let pressTimer = null;
  const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
  const valueCell = row.querySelector('.ev-value');
  valueCell.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cancel();
    pressTimer = setTimeout(() => { pressTimer = null; revealRow(row); }, LONG_PRESS_MS);
  });
  valueCell.addEventListener('pointerup', cancel);
  valueCell.addEventListener('pointerleave', cancel);
  valueCell.addEventListener('pointercancel', cancel);
  row.addEventListener('mouseenter', (e) => {
    hoveredRow = row;
    if (e.altKey) revealRow(row);
  });
  row.addEventListener('mouseleave', () => { if (hoveredRow === row) hoveredRow = null; });
}

function onKeyDown(e) {
  if (e.key === 'Alt' && hoveredRow && hoveredRow.isConnected) revealRow(hoveredRow);
}

/* -------------------------------------------------------------------------- */
/*  Ações                                                                      */
/* -------------------------------------------------------------------------- */

async function afterEdit(file, message) {
  toast(message, 'success', 2500);
  await reloadInEditor(file);
  await refresh();
}

function startEdit(row, file, key) {
  const cell = row.querySelector('.ev-value');
  hideValue(row);
  const input = el('input', 'ev-input');
  input.type = 'text';
  input.placeholder = 'novo valor';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', `Novo valor de ${key}`);
  cell.replaceChildren(input);
  row.classList.add('editing');
  input.focus();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save) {
      const r = await guarded(() => api().setValue(file, key, input.value));
      input.value = '';
      if (r) { await afterEdit(file, `${key} atualizada.`); return; }
    }
    row.classList.remove('editing');
    cell.textContent = row.dataset.masked || MASK;
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(false));
}

async function removeKey(file, key) {
  const ok = await confirmGit({
    title: `Remover ${key}?`,
    message: 'A linha será apagada do arquivo.',
    confirmLabel: 'Remover',
    danger: true,
  });
  if (!ok) return;
  const r = await guarded(() => api().removeKey(file, key));
  if (r) await afterEdit(file, `${key} removida.`);
}

function addKeyForm(card, file, presetKey = '') {
  card.querySelector('.ev-add-form')?.remove();
  const form = el('form', 'ev-add-form');
  const keyIn = el('input', 'ev-input ev-input-key');
  keyIn.placeholder = 'CHAVE';
  keyIn.value = presetKey;
  keyIn.spellcheck = false;
  keyIn.setAttribute('aria-label', 'Nome da chave');
  const valIn = el('input', 'ev-input');
  valIn.placeholder = 'valor';
  valIn.autocomplete = 'off';
  valIn.spellcheck = false;
  valIn.setAttribute('aria-label', 'Valor');
  const save = el('button', 'ev-btn ev-btn-primary', 'Adicionar');
  save.type = 'submit';
  const cancel = el('button', 'ev-btn', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', () => form.remove());
  form.append(keyIn, valIn, save, cancel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = keyIn.value.trim();
    if (!key) { keyIn.focus(); return; }
    const r = await guarded(() => api().addKey(file, key, valIn.value));
    valIn.value = '';
    if (r) await afterEdit(file, `${key} adicionada.`);
  });
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); form.remove(); } });
  card.querySelector('.ev-rows').before(form);
  (presetKey ? valIn : keyIn).focus();
}

async function generateExample(file) {
  const r = await guarded(() => api().generateExample(file));
  if (!r) return;
  if (r.created) toast('.env.example criado.', 'success', 2500);
  else if (r.added.length) toast(`.env.example: ${r.added.length} chave(s) acrescentada(s).`, 'success', 2500);
  else toast('.env.example já tem todas as chaves.', 'info', 2500);
  await reloadInEditor(r.path);
  await refresh();
}

async function scanStagedNow() {
  const out = view?.querySelector('.ev-staged');
  const r = await guarded(() => api().scanStaged(root()));
  if (!r) return;
  const all = [
    ...r.envFiles.map((file) => ({ file, line: 0, rule: 'env-file', preview: '' })),
    ...r.findings,
  ];
  if (!out) {
    toast(all.length ? `${all.length} possível(is) segredo(s) no stage.` : 'Nada suspeito no stage.', all.length ? 'error' : 'success', 4000);
    return;
  }
  out.replaceChildren();
  out.hidden = false;
  if (!all.length) {
    out.append(el('p', 'ev-ok', 'Nada suspeito nas alterações preparadas.'));
    return;
  }
  out.append(el('p', 'ev-staged-title', `Stage: ${all.length} possível(is) segredo(s)`));
  const list = el('ul', 'ev-staged-list');
  for (const f of all) {
    const li = el('li');
    li.append(el('span', 'ev-mono', f.line > 0 ? `${f.file}:${f.line}` : f.file));
    li.append(el('span', 'ev-badge secret', RULE_LABELS[f.rule] || f.rule));
    if (f.preview) li.append(el('code', 'ev-preview', f.preview));
    list.append(li);
  }
  out.append(list);
}

async function toggleHook(status) {
  if (status === 'installed') {
    const r = await guarded(() => api().removeHook(root()));
    if (r?.removed) toast('Proteção pre-commit removida.', 'success', 2500);
  } else {
    const r = await guarded(() => api().installHook(root()));
    if (r?.installed) toast('Proteção pre-commit instalada.', 'success', 2500);
    else if (r?.reason === 'exists') {
      toast('Já existe um .git/hooks/pre-commit seu. Acrescente a chamada manualmente (veja o Cofre na documentação).', 'info', 7000);
    }
  }
  await refresh();
}

/* -------------------------------------------------------------------------- */
/*  Render                                                                     */
/* -------------------------------------------------------------------------- */

function badge(text, cls) {
  return el('span', `ev-badge ${cls}`, text);
}

function renderRow(file, entry, card) {
  const row = el('div', 'ev-row');
  row.dataset.path = file.path;
  row.dataset.key = entry.key;
  // Vazia com selo "vazia" não repete o texto; no example, vazio é o normal.
  row.dataset.masked = entry.flags.missing || entry.flags.empty ? '' : (entry.masked || '(vazia)');
  if (entry.flags.missing) row.dataset.missing = '1';
  if (entry.flags.secret) row.classList.add('is-secret');

  const keyEl = el('span', 'ev-key', entry.key);
  keyEl.title = entry.line ? `${entry.key} (linha ${entry.line})` : entry.key;
  const value = el('span', 'ev-value', row.dataset.masked);
  if (!entry.flags.missing) value.title = 'Segure o clique (ou Alt) para revelar';

  const badges = el('span', 'ev-badges');
  if (entry.flags.secret) {
    const kind = entry.rule && entry.rule !== 'generic-secret' ? ` · ${RULE_LABELS[entry.rule] || entry.rule}` : '';
    badges.append(badge(`segredo${kind}`, 'secret'));
  }
  if (entry.flags.empty) badges.append(badge('vazia', 'empty'));
  if (entry.flags.missing) badges.append(badge('faltando (está no example)', 'missing'));
  if (entry.flags.extra) badges.append(badge('não está no example', 'extra'));

  const actions = el('span', 'ev-actions');
  if (entry.flags.missing) {
    actions.append(iconBtn('plus', `Adicionar ${entry.key}`, () => addKeyForm(card, file.path, entry.key)));
  } else {
    actions.append(
      iconBtn('copy', 'Copiar valor', async () => {
        const r = await guarded(() => api().copy(file.path, entry.key));
        if (r) toast(`Valor de ${entry.key} copiado.`, 'success', 1800);
      }),
      iconBtn('pencil', 'Editar valor', () => startEdit(row, file.path, entry.key)),
      iconBtn('trash', 'Remover chave', () => removeKey(file.path, entry.key), 'danger'),
    );
  }

  const main = el('div', 'ev-row-main');
  main.append(keyEl, actions);
  const sub = el('div', 'ev-row-sub');
  sub.append(value, badges);
  row.append(main, sub);
  if (!entry.flags.missing) attachReveal(row);
  return row;
}

function renderCard(file) {
  const card = el('section', 'ev-card');
  card.dataset.path = file.path;
  card.dataset.rel = file.rel;
  const head = el('div', 'ev-card-head');
  const name = el('button', 'ev-card-name', file.rel);
  name.type = 'button';
  name.title = 'Abrir no editor';
  name.addEventListener('click', () => editorApi.openFile(file.path));
  const acts = el('span', 'ev-actions');
  acts.append(iconBtn('plus', 'Adicionar chave', () => addKeyForm(card, file.path)));
  if (!file.isExample) {
    acts.append(iconBtn('file-plus', 'Gerar .env.example', () => generateExample(file.path), 'ev-gen-example'));
  }
  head.append(name, acts);
  card.append(head);
  if (file.error) card.append(el('p', 'ev-error', file.error));
  if (file.otherSecrets) card.append(el('p', 'ev-warn', `${file.otherSecrets} possível(is) segredo(s) fora de uma chave (comentário?).`));
  const rows = el('div', 'ev-rows');
  if (!file.entries.length && !file.error) rows.append(el('p', 'ev-empty', 'Nenhuma chave.'));
  for (const entry of file.entries) rows.append(renderRow(file, entry, card));
  card.append(rows);
  return card;
}

function clearReveals() {
  for (const t of revealTimers) clearTimeout(t);
  revealTimers.clear();
}

async function refresh() {
  if (!view || !view.isConnected) { view = null; return; }
  const host = view;
  clearReveals();
  if (settings().enabled === false) {
    host.replaceChildren(el('p', 'hint', 'O Cofre .env está desabilitado em Configurações → Módulos Agzos.'));
    return;
  }
  const r = root();
  if (!r) {
    host.replaceChildren(el('p', 'hint', 'Abra uma pasta de projeto para ver os arquivos .env.'));
    return;
  }
  const [data, ignore, hook] = await Promise.all([
    guarded(() => api().list(r)),
    api().gitignoreStatus(r).catch(() => null),
    api().hookStatus(r).catch(() => null),
  ]);
  if (view !== host) return;
  host.replaceChildren();
  if (!data) return;

  const top = el('div', 'ev-top');
  const sum = el('p', 'ev-summary');
  sum.id = 'envvault-summary';
  sum.textContent = `${data.summary.secrets} segredo(s) · ${data.summary.missing} faltando`;
  if (data.summary.secrets) sum.classList.add('has-secrets');
  const tools = el('div', 'ev-toolbar');
  tools.append(
    textBtn('Atualizar', () => refresh(), { iconName: 'refresh-cw' }),
    textBtn('Verificar staged', () => scanStagedNow(), { iconName: 'shield-check', id: 'envvault-scan-staged' }),
  );
  if (hook) {
    tools.append(textBtn(hook === 'installed' ? 'Remover proteção' : 'Instalar proteção pre-commit',
      () => toggleHook(hook), { iconName: 'shield', id: 'envvault-hook-btn' }));
  }
  top.append(sum, tools);
  host.append(top);

  if (ignore && ignore.repo && ignore.hasEnv && !ignore.ignored) {
    const warn = el('div', 'ev-gitignore-warn');
    warn.id = 'envvault-gitignore-warn';
    warn.append(icon('triangle-alert', 14), el('span', null, 'O .env não está no .gitignore.'));
    warn.append(textBtn('Adicionar ao .gitignore', async () => {
      const res = await guarded(() => api().addToGitignore(r));
      if (res) { toast('.gitignore atualizado.', 'success', 2000); await refresh(); }
    }, { cls: 'ev-btn-primary', id: 'envvault-add-gitignore' }));
    host.append(warn);
  }

  const staged = el('div', 'ev-staged');
  staged.hidden = true;
  host.append(staged);

  if (!data.files.length) {
    const empty = el('div', 'ev-empty-state');
    empty.append(el('p', null, 'Nenhum arquivo .env encontrado nesta pasta.'));
    host.append(empty);
    return;
  }
  const list = el('div', 'ev-cards');
  for (const f of data.files) list.append(renderCard(f));
  host.append(list);
}

/* -------------------------------------------------------------------------- */

export function setupEnvVault() {
  registerModule({
    id: 'envVault',
    label: 'Cofre .env',
    icon: 'key-round',
    description: 'Veja e edite .env com valores mascarados e bloqueie commits com segredos.',
    open(container) {
      view = container;
      view.classList.add('envvault-view');
      refresh();
    },
  });

  registerCommands([
    { id: 'envvault.open', label: 'Agzos: Abrir Cofre .env', run: () => openModule('envVault') },
    {
      id: 'envvault.scanStaged',
      label: 'Agzos: Verificar segredos no stage',
      run: async () => { openModule('envVault'); await scanStagedNow(); },
    },
  ]);

  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('agzos:modules-settings', () => { if (view?.isConnected) refresh(); });
  window.addEventListener('agzos:workspace-changed', () => { if (view?.isConnected) refresh(); });
  window.addEventListener('agzos:file-saved', (e) => {
    const p = e?.detail?.path || '';
    if (view?.isConnected && /(^|[\\/])\.env(\.[^\\/]*)?$/.test(p)) refresh();
  });
}
