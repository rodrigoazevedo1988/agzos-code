/**
 * Pasta remota via SSH (1.2.0) — lado do renderer.
 *
 * - Diálogos pedidos pelo main (window.agzos.remote.onPrompt): senha/passphrase com
 *   "Lembrar no cofre do sistema" e confirmação de host key desconhecida.
 * - Host key divergente: aviso de possível ataque, só com "Fechar" (sem continuar).
 * - Faixa no topo quando a conexão cai: reconexão automática e botão "Reconectar".
 * - "Abrir pasta remota via SSH": host → navegador de pastas (SFTP) → abrir aqui ou
 *   em nova janela. Título e status bar mostram `SSH: <host>`.
 * - Arquivos remotos abertos: mudança externa conferida por stat a cada 5 s.
 */

import { toast } from './toast.js';
import { openGitDialog } from './git-dialog.js';
import { showPicker } from './command-palette.js';
import { isRemotePath, remoteAuthority, remoteFolderLabel } from './remote-paths.js';

const api = () => window.agzos?.remote;
const State = window.AgzosState;

/* --------------------------------------------------------------------------
   Diálogos pedidos pelo main
   -------------------------------------------------------------------------- */
async function askSecret(p) {
  const isPass = p.secret === 'passphrase';
  // keyboard-interactive (OTP/2FA): título = texto do prompt; eco só se o servidor pedir.
  const isKi = p.secret === 'keyboard-interactive';
  const fields = [
    {
      name: 'value', type: isKi && p.echo ? 'text' : 'password', label: isKi ? 'Resposta' : (isPass ? 'Passphrase' : 'Senha'),
      required: true, autofocus: true,
    },
  ];
  if (p.canRemember !== false) fields.push({ name: 'remember', type: 'checkbox', label: 'Lembrar no cofre do sistema' });
  const res = await openGitDialog({
    id: 'remote-secret-dialog',
    title: p.title || (isPass ? 'Passphrase da chave SSH' : `Senha de ${p.target || 'host'}`),
    icon: 'key-round',
    description: p.message || (isPass ? `Chave ${p.keyPath || ''}` : `Autenticação SSH em ${p.target || 'host'}.`),
    submitLabel: 'Continuar',
    fields,
  });
  if (!res || typeof res.value !== 'string') return null;
  return { value: res.value, remember: !!res.remember };
}

async function askHostKey(p) {
  const where = p.port && p.port !== 22 ? `${p.host}:${p.port}` : p.host;
  const res = await openGitDialog({
    id: 'remote-hostkey-dialog',
    title: 'Host SSH desconhecido',
    icon: 'shield',
    description: `A autenticidade de ${p.label || where} (${where}) não pode ser confirmada. `
      + `Fingerprint da chave ${p.keyType || ''}: ${p.fingerprint}. `
      + 'Confira com o administrador do servidor antes de confiar. Ao confiar, a chave é gravada no ~/.ssh/known_hosts.',
    submitLabel: 'Confiar e conectar',
    fields: [],
  });
  return !!res;
}

/** Host key divergente: só informa e fecha. Não há como seguir por aqui. */
export async function showHostKeyBlocked(message) {
  const p = openGitDialog({
    id: 'remote-hostkey-blocked',
    title: 'Conexão bloqueada: chave do host mudou',
    icon: 'shield-alert',
    description: message,
    submitLabel: 'Fechar',
    danger: true,
    fields: [],
  });
  // Só "Fechar": esconde o segundo botão para não sugerir uma escolha.
  setTimeout(() => {
    const dlg = document.getElementById('remote-hostkey-blocked');
    dlg?.querySelector('.git-btn-ghost')?.remove();
  }, 0);
  await p;
}

async function handlePrompt(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.kind === 'secret') return askSecret(payload);
  if (payload.kind === 'hostkey') return askHostKey(payload);
  return null;
}

/* --------------------------------------------------------------------------
   Conectar (com mensagens de erro claras)
   -------------------------------------------------------------------------- */
export async function connectRemote(target) {
  const res = await api()?.connect(target);
  if (res?.ok) return res;
  if (res?.code === 'HOSTKEY_MISMATCH') await showHostKeyBlocked(res.error);
  else if (res?.code !== 'CANCELLED' && res?.code !== 'HOSTKEY_REJECTED') toast(res?.error || 'Falha ao conectar.', 'error', 8000);
  return null;
}

/* --------------------------------------------------------------------------
   Faixa "Conexão perdida"
   -------------------------------------------------------------------------- */
const MAX_TRIES = 3;

function bannerFor(st) {
  const area = document.getElementById('editor-area');
  if (!area) return null;
  let bar = document.getElementById('remote-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'remote-banner';
    bar.className = 'remote-banner';
    bar.setAttribute('role', 'alert');
    area.prepend(bar);
  }
  bar.dataset.authority = st.authority;
  return bar;
}

function renderState(st) {
  if (!st || !st.authority) return;
  window.dispatchEvent(new CustomEvent('agzos:remote-state', { detail: st }));
  const current = document.getElementById('remote-banner');
  if (st.state === 'connected' || st.state === 'closed' || st.state === 'connecting') {
    if (current && current.dataset.authority === st.authority) current.remove();
    return;
  }
  const bar = bannerFor(st);
  if (!bar) return;
  const text = document.createElement('span');
  text.className = 'remote-banner-text';
  if (st.state === 'failed') {
    text.textContent = `Conexão com ${st.label} perdida`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remote-banner-reconnect';
    btn.textContent = 'Reconectar';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const r = await api()?.reconnect(st.authority);
      if (!r?.ok) {
        btn.disabled = false;
        if (r?.code === 'HOSTKEY_MISMATCH') await showHostKeyBlocked(r.error);
        else toast(r?.error || 'Falha ao reconectar.', 'error', 6000);
      }
    });
    const hint = document.createElement('span');
    hint.className = 'remote-banner-hint';
    hint.textContent = st.error && st.code === 'HOSTKEY_MISMATCH' ? st.error : 'As alterações não salvas continuam no editor.';
    bar.replaceChildren(text, document.createTextNode(' — '), btn, hint);
    if (st.code === 'HOSTKEY_MISMATCH') btn.remove();
  } else {
    const attempt = st.attempt ? ` (tentativa ${st.attempt}/${MAX_TRIES})` : '';
    text.textContent = `Conexão com ${st.label} perdida — reconectando${attempt}…`;
    bar.replaceChildren(text);
  }
}

/* --------------------------------------------------------------------------
   Abrir pasta remota
   -------------------------------------------------------------------------- */
const TARGET_HINT = 'usuario@host ou usuario@host:porta';
const connected = new Map(); // authority → { label, home, homeUri }

async function loadHosts() {
  try {
    const res = await window.agzos?.ssh?.hosts();
    return Array.isArray(res?.hosts) ? res.hosts : [];
  } catch {
    return [];
  }
}

async function promptTarget() {
  return openGitDialog({
    id: 'remote-target-dialog',
    title: 'Abrir pasta remota via SSH',
    icon: 'server',
    description: 'Conecta por SSH/SFTP (chaves do ~/.ssh e agente SSH primeiro; senha se o host pedir).',
    submitLabel: 'Conectar',
    fields: [{ name: 'target', type: 'text', label: 'Destino', placeholder: 'usuario@host:22', required: true, autofocus: true, hint: TARGET_HINT }],
    onSubmit: async ({ target }) => {
      const t = await window.agzos?.ssh?.parseTarget(String(target || ''));
      if (!t) throw new Error(`Formato inválido. Use ${TARGET_HINT}.`);
      return String(target).trim();
    },
  });
}

/** Seletor de host → conecta → navegador de pastas. */
export async function openRemoteFolderFlow() {
  const hosts = await loadHosts();
  const items = hosts.map((h) => ({
    id: `remote-host:${h.host}`,
    label: h.host,
    description: h.hostName ? `${h.user ? `${h.user}@` : ''}${h.hostName}${h.port ? `:${h.port}` : ''}` : '',
    icon: 'server',
    run: () => connectAndBrowse(h.host),
  }));
  items.push({
    id: 'remote-host:typed', label: 'Digitar destino…', description: TARGET_HINT, icon: 'plug',
    run: async () => { const t = await promptTarget(); if (t) await connectAndBrowse(t); },
  });
  showPicker({ title: 'Escolha o host da pasta remota', items });
}

async function connectAndBrowse(target) {
  toast(`Conectando a ${target}…`, 'info', 2000);
  const res = await connectRemote(target);
  if (!res) return;
  connected.set(res.authority, res);
  await browse(res.authority, res.home);
}

async function browse(authority, dir) {
  const res = await api()?.browse(authority, dir);
  if (!res?.ok) { toast(res?.error || 'Não foi possível listar a pasta remota.', 'error', 6000); return; }
  const items = [
    { id: 'remote-open-here', label: `Abrir esta pasta: ${res.path}`, description: 'Nesta janela', icon: 'folder-open', run: () => openRemoteFolder(res.uri) },
    { id: 'remote-open-new', label: 'Abrir em nova janela', description: res.path, icon: 'app-window', run: () => api()?.openInNewWindow(res.uri) },
  ];
  if (res.parent) items.push({ id: 'remote-up', label: '..', description: 'Pasta acima', icon: 'arrow-up', run: () => browse(authority, res.parent) });
  for (const d of res.dirs) {
    items.push({ id: `remote-dir:${d.name}`, label: d.name, description: '', icon: 'folder-closed', run: () => browse(authority, d.path) });
  }
  showPicker({ title: `SSH: ${connected.get(authority)?.label || authority} — ${res.path}`, items });
}

/** Garante a conexão desta janela com o host de uma URI ssh:// (recentes, nova janela). */
export async function ensureConnectedFor(uri) {
  const authority = remoteAuthority(uri);
  if (!authority) return false;
  const list = (await api()?.list()) || [];
  if (list.some((c) => c.authority === authority && c.state === 'connected')) return true;
  const res = await connectRemote(authority);
  if (res) connected.set(res.authority, res);
  return !!res;
}

export async function openRemoteFolder(uri) {
  const m = await import('./file-tree.js');
  await m.openWorkspace(uri);
  const cp = await import('./command-palette.js');
  cp.invalidateQuickOpenCache?.();
}

/* --------------------------------------------------------------------------
   Título, status bar e mudança externa (stat a cada 5 s)
   -------------------------------------------------------------------------- */
function syncChrome() {
  const root = State.workspaceRoot;
  const remote = isRemotePath(root);
  document.body.classList.toggle('remote-workspace', remote);
  if (remote) {
    const label = remoteFolderLabel(root, connected);
    const base = document.title.replace(/ — SSH: .*? — Agzos Code$/, ' — Agzos Code');
    document.title = base.endsWith(' — Agzos Code') ? base.replace(/ — Agzos Code$/, ` — SSH: ${label.host} — Agzos Code`) : `${label.folder} — SSH: ${label.host} — Agzos Code`;
  }
  window.dispatchEvent(new CustomEvent('agzos:remote-workspace', { detail: { root, remote } }));
}

const POLL_MS = 5000;
const baselines = new Map(); // caminho → mtime visto no host

async function statOf(p) {
  try { return await window.agzos.fs.stat(p); } catch { return null; }
}

async function pollExternalChanges() {
  const paths = [...State.files.keys()].filter(isRemotePath);
  for (const key of [...baselines.keys()]) if (!State.files.has(key)) baselines.delete(key);
  for (const p of paths) {
    const st = await statOf(p);
    if (!st) continue;
    const prev = baselines.get(p);
    baselines.set(p, st.mtime);
    if (prev === undefined || prev === st.mtime) continue;
    const ed = await import('./editor.js');
    await ed.handleExternalChange(p);
  }
}

export function setupRemote() {
  const r = api();
  if (!r) return;
  r.onPrompt(handlePrompt);
  r.onState(renderState);
  window.addEventListener('agzos:workspace-changed', syncChrome);
  window.addEventListener('agzos:active-file-changed', () => { if (isRemotePath(State.workspaceRoot)) syncChrome(); });
  // Depois de salvar, o mtime novo do host vira a base (não é mudança externa).
  window.addEventListener('agzos:file-saved', async (e) => {
    const p = e.detail?.path;
    if (!isRemotePath(p)) return;
    const st = await statOf(p);
    if (st) baselines.set(p, st.mtime);
  });
  setInterval(() => { pollExternalChanges().catch(() => {}); }, POLL_MS);
  window.AgzosRemote = {
    connect: connectRemote,
    openFolder: openRemoteFolder,
    openFlow: openRemoteFolderFlow,
    pollNow: pollExternalChanges,
  };
  // Janela aberta por "Abrir em nova janela": conecta aqui e abre a pasta.
  r.takePending?.().then(async (uri) => {
    if (uri && await ensureConnectedFor(uri)) await openRemoteFolder(uri);
  }).catch(() => {});
}
