/**
 * Atalho SSH — funções puras (sem DOM/IPC), testadas em test/unit/ssh-picker.test.js.
 */

/** "user@HostName:Port" para a descrição de um host do config ('' se nada além do alias). */
export function hostDescription(h) {
  if (!h) return '';
  if (!h.hostName && !h.user && !h.port) return '';
  const host = h.hostName || h.host;
  return `${h.user ? `${h.user}@` : ''}${host}${h.port ? `:${h.port}` : ''}`;
}

/**
 * Itens do seletor "Selecione uma opção para abrir uma conexão remota".
 * Cada item: { id, label, description?, icon, disabled?, badge? } — o chamador põe o `run`.
 */
export function remotePickerItems({ hosts = [], hasWsl = false } = {}) {
  const items = hosts.map((h) => ({
    id: `host:${h.host}`,
    label: h.host,
    description: hostDescription(h),
    icon: 'server',
    host: h,
  }));
  items.push(
    { id: 'connect', label: 'Conectar a um host…', description: 'usuario@host[:porta]', icon: 'plug' },
    { id: 'add', label: 'Adicionar novo host SSH…', description: 'Grava no ~/.ssh/config e conecta', icon: 'plus' },
    { id: 'config', label: 'Abrir arquivo de configuração SSH', description: '~/.ssh/config', icon: 'file-cog' },
    { id: 'folder', label: 'Abrir pasta remota via SSH', description: 'Explorer, editor, terminal e Git no host', icon: 'folder-closed' },
  );
  if (hasWsl) items.push({ id: 'wsl', label: 'Abrir terminal WSL', description: 'Windows Subsystem for Linux', icon: 'server' });
  return items;
}

/** Apelido sugerido a partir do alvo (primeiro rótulo do hostname; IP fica inteiro). */
export function suggestAlias(target) {
  const host = String(target?.host || '');
  if (!host) return '';
  if (host.includes(':')) return 'ipv6-host';
  if (/^[0-9.]+$/.test(host)) return host;
  return host.split('.')[0] || host;
}

/**
 * Estado do botão remoto da status bar: pasta remota aberta (workspaceHost) tem
 * prioridade; senão, a sessão de terminal SSH ativa.
 */
export function remoteStatus(session, workspaceHost = null) {
  if (workspaceHost) return { connected: true, label: `SSH: ${workspaceHost}`, title: `Pasta remota em ${workspaceHost} via SSH` };
  const ssh = session?.ssh;
  if (!ssh || session.exited) return { connected: false, label: '', title: 'Abrir uma conexão remota' };
  const name = ssh.alias || ssh.host;
  return { connected: true, label: `SSH: ${name}`, title: `Conectado a ${name} via SSH (terminal ativo)` };
}
