/**
 * Atalho SSH (1.1.0): botão remoto na status bar, seletor de conexão e
 * comandos da paleta. Conectar = sessão de terminal com o `ssh` do sistema
 * (ver createTerminal({ ssh }) em terminal.js e term:create no main).
 *
 * Pasta remota via SSH/SFTP fica para a 1.2.0 (item desabilitado no seletor).
 */

import { toast } from './toast.js';
import { lucideIcon } from './lucide.js';
import { showPicker, registerCommands } from './command-palette.js';
import { openGitDialog } from './git-dialog.js';
import { remotePickerItems, remoteStatus, suggestAlias } from './ssh-utils.js';

const PICKER_TITLE = 'Selecione uma opção para abrir uma conexão remota';
const TARGET_HINT = 'usuario@host ou usuario@host:porta';

const api = () => window.agzos?.ssh;
const terminal = () => import('./terminal.js');

async function loadHosts() {
  try {
    const res = await api()?.hosts();
    return { hosts: Array.isArray(res?.hosts) ? res.hosts : [], sshAvailable: res?.sshAvailable !== false };
  } catch (err) {
    console.warn('[ssh] hosts indisponíveis:', err);
    return { hosts: [], sshAvailable: true };
  }
}

function sshMissingToast() {
  const win = navigator.platform.toLowerCase().includes('win');
  toast(win
    ? 'Cliente SSH não encontrado. Instale o recurso opcional "Cliente OpenSSH" (Configurações > Sistema > Recursos opcionais).'
    : 'Cliente SSH não encontrado. Instale o OpenSSH (ex.: sudo apt install openssh-client).', 'error', 8000);
}

/** Abre um terminal SSH. target: { alias } | { user, host, port }. */
export async function connect(target, { sshAvailable } = {}) {
  if (sshAvailable === undefined) sshAvailable = (await loadHosts()).sshAvailable;
  if (!sshAvailable) { sshMissingToast(); return null; }
  const name = target.alias || target.host;
  const m = await terminal();
  return m.createTerminal({ ssh: target, title: `SSH: ${name}` });
}

async function hasWslProfile() {
  if (!navigator.platform.toLowerCase().includes('win')) return false;
  try {
    const m = await terminal();
    const { profiles } = await m.getTerminalProfiles();
    return profiles.some((p) => p.id === 'wsl');
  } catch {
    return false;
  }
}

/** Seletor "Selecione uma opção para abrir uma conexão remota". */
export async function openRemotePicker() {
  const [{ hosts, sshAvailable }, hasWsl] = await Promise.all([loadHosts(), hasWslProfile()]);
  const actions = {
    connect: () => promptConnect({ sshAvailable }),
    add: () => promptAddHost({ sshAvailable }),
    config: () => openSshConfig(),
    folder: () => {},
    wsl: () => terminal().then((m) => m.createTerminal({ profileId: 'wsl' })),
  };
  const items = remotePickerItems({ hosts, hasWsl }).map((it) => ({
    ...it,
    run: it.host ? () => connect({ alias: it.host.host }, { sshAvailable }) : actions[it.id],
  }));
  showPicker({ title: PICKER_TITLE, items });
}

async function validateTarget(text) {
  const t = await api()?.parseTarget(String(text || ''));
  if (!t) throw new Error(`Formato inválido. Use ${TARGET_HINT} (sem espaços nem caracteres especiais).`);
  return t;
}

export async function promptConnect({ sshAvailable } = {}) {
  const target = await openGitDialog({
    id: 'ssh-connect-dialog',
    title: 'Conectar a um host SSH',
    icon: 'chevrons-left-right',
    description: 'Abre um terminal com o cliente ssh do sistema.',
    submitLabel: 'Conectar',
    fields: [{ name: 'target', type: 'text', label: 'Destino', placeholder: 'usuario@host:22', required: true, autofocus: true, hint: TARGET_HINT }],
    onSubmit: ({ target: text }) => validateTarget(text),
  });
  if (!target) return null;
  return connect(target, { sshAvailable });
}

export async function promptAddHost({ sshAvailable } = {}) {
  const res = await openGitDialog({
    id: 'ssh-add-host-dialog',
    title: 'Adicionar novo host SSH',
    icon: 'chevrons-left-right',
    description: 'Acrescenta um bloco Host ao fim do ~/.ssh/config (o resto do arquivo não é alterado) e conecta.',
    submitLabel: 'Adicionar e conectar',
    fields: [
      { name: 'target', type: 'text', label: 'Destino', placeholder: 'usuario@host:22', required: true, autofocus: true, hint: TARGET_HINT },
      { name: 'alias', type: 'text', label: 'Apelido', placeholder: 'meu-servidor', required: true, hint: 'Letras, números, ".", "_" ou "-".' },
    ],
    onFieldChange: async (name, values, ctl) => {
      if (name !== 'target') return;
      const aliasInput = ctl.field('alias');
      if (!aliasInput || aliasInput.dataset.touched) return;
      const t = await api()?.parseTarget(values.target || '').catch(() => null);
      aliasInput.value = t ? suggestAlias(t) : '';
    },
    onOpen: (ctl) => {
      const aliasInput = ctl.field('alias');
      aliasInput?.addEventListener('input', () => { aliasInput.dataset.touched = '1'; });
    },
    onSubmit: async ({ target: text, alias }) => {
      await validateTarget(text);
      const r = await api()?.addHost({ target: text, alias: String(alias || '').trim() });
      if (!r?.ok) throw new Error(r?.error || 'Não foi possível gravar o ~/.ssh/config.');
      return r;
    },
  });
  if (!res) return null;
  toast(`Host ${res.alias} adicionado ao ~/.ssh/config.`, 'success', 2500);
  return connect({ alias: res.alias }, { sshAvailable });
}

export async function openSshConfig() {
  try {
    const p = await api()?.configPath();
    if (!p) throw new Error('caminho indisponível');
    const m = await import('./editor.js');
    await m.openFile(p);
  } catch (err) {
    toast(`Não foi possível abrir o ~/.ssh/config: ${err.message}`, 'error');
  }
}

function renderStatus(btn, detail) {
  const st = remoteStatus(detail);
  btn.classList.toggle('connected', st.connected);
  btn.title = st.title;
  btn.setAttribute('aria-label', st.connected ? st.title : 'Abrir uma conexão remota');
  const label = btn.querySelector('.status-remote-label');
  if (label) label.textContent = st.label;
}

export function setupSsh() {
  const btn = document.getElementById('status-remote-host');
  if (btn) {
    if (!btn.querySelector('svg')) btn.prepend(lucideIcon('chevrons-left-right', { size: 13, strokeWidth: 2 }));
    btn.addEventListener('click', () => openRemotePicker());
    renderStatus(btn, null);
    window.addEventListener('agzos:terminal-active', (e) => renderStatus(btn, e.detail));
  }
  registerCommands([
    { id: 'ssh.connect', label: 'SSH: Conectar ao Host…', run: () => openRemotePicker() },
    { id: 'ssh.addHost', label: 'SSH: Adicionar Novo Host…', run: () => promptAddHost() },
    { id: 'ssh.openConfig', label: 'SSH: Abrir Configuração SSH', run: () => openSshConfig() },
  ]);
}
