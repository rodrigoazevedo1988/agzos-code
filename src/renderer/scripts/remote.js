/**
 * Pasta remota via SSH (1.2.0) — lado do renderer.
 *
 * - Diálogos pedidos pelo main (window.agzos.remote.onPrompt): senha/passphrase com
 *   "Lembrar no cofre do sistema" e confirmação de host key desconhecida.
 * - Host key divergente: aviso de possível ataque, só com "Fechar" (sem continuar).
 * - Faixa no topo quando a conexão cai: reconexão automática e botão "Reconectar".
 */

import { toast } from './toast.js';
import { openGitDialog } from './git-dialog.js';

const api = () => window.agzos?.remote;
const State = window.AgzosState;

/* --------------------------------------------------------------------------
   Diálogos pedidos pelo main
   -------------------------------------------------------------------------- */
async function askSecret(p) {
  const isPass = p.secret === 'passphrase';
  const fields = [
    { name: 'value', type: 'password', label: isPass ? 'Passphrase' : 'Senha', required: true, autofocus: true },
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

export function setupRemote() {
  const r = api();
  if (!r) return;
  r.onPrompt(handlePrompt);
  r.onState(renderState);
  window.AgzosRemote = { connect: connectRemote, state: () => State.remote || null };
}
