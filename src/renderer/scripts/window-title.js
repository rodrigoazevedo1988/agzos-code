/**
 * Título da janela (aparece na barra de tarefas e no Alt+Tab):
 * "<projeto> › <arquivo ativo> — Agzos Code", para achar a janela certa
 * quando há várias abertas com arquivos de mesmo nome.
 */

const APP = 'Agzos Code';

function baseName(p) {
  const clean = String(p || '').replace(/[\\/]+$/, '');
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

/** Função pura (testável): monta o título a partir da pasta e do arquivo ativo. */
export function formatWindowTitle({ folder, file, remoteHost } = {}) {
  const project = folder ? baseName(folder) + (remoteHost ? ` [SSH: ${remoteHost}]` : '') : '';
  const name = file ? baseName(file) : '';
  if (project && name) return `${project} › ${name} — ${APP}`;
  if (project) return `${project} — ${APP}`;
  if (name) return `${name} — ${APP}`;
  return APP;
}

export function updateWindowTitle() {
  const State = window.AgzosState || {};
  document.title = formatWindowTitle({
    folder: State.workspaceRoot,
    file: State.activePath,
    remoteHost: State.remoteHost || null,
  });
}
