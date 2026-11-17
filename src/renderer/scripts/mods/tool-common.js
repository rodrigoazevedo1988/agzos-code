/**
 * Utilidades comuns dos Módulos Agzos de ferramentas (Árvore, Snap, Ao Vivo).
 *
 * - moduleEnabled(key) / setModuleEnabled(key, on): liga/desliga em `settings.modules.<key>`
 *   (salva e avisa hub e módulos pelo evento 'agzos:modules-settings').
 * - buildModuleToggle(key): checkbox "Módulo habilitado" para a view do módulo no hub.
 * - openToolDialog({ title, className }) → { dialog, body, actions, close, onClose }: modal com Esc.
 * - copyText(text): área de transferência pelo main (mesmo caminho do terminal).
 * - joinPath(dir, name) / baseName(p): caminhos com o separador da pasta.
 */

const State = window.AgzosState;

export function moduleEnabled(key) {
  const cfg = State.settings?.modules?.[key];
  return !cfg || cfg.enabled !== false;
}

export async function setModuleEnabled(key, on) {
  const modules = { ...(State.settings.modules || {}) };
  modules[key] = { ...(modules[key] || {}), enabled: Boolean(on) };
  State.settings.modules = modules;
  window.dispatchEvent(new CustomEvent('agzos:modules-settings', { detail: { modules } }));
  try { await window.agzos.settings.save(State.settings); } catch (e) { console.warn('[módulos] salvar', e); }
}

export function buildModuleToggle(key) {
  const label = document.createElement('label');
  label.className = 'tool-mod-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = moduleEnabled(key);
  input.addEventListener('change', () => setModuleEnabled(key, input.checked));
  label.append(input, document.createTextNode(' Módulo habilitado'));
  return label;
}

export function openToolDialog({ title, className = '' }) {
  const overlay = document.createElement('div');
  overlay.className = 'tool-dialog-overlay';
  const dialog = document.createElement('div');
  dialog.className = `tool-dialog ${className}`.trim();
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', title);
  const heading = document.createElement('h2');
  heading.textContent = title;
  const body = document.createElement('div');
  body.className = 'tool-dialog-body';
  const actions = document.createElement('div');
  actions.className = 'tool-dialog-actions';
  dialog.append(heading, body, actions);
  overlay.append(dialog);
  document.body.append(overlay);

  const closers = [];
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  function close() {
    if (!overlay.isConnected) return;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    for (const fn of closers) { try { fn(); } catch { /* ignora */ } }
  }
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  return { overlay, dialog, body, actions, close, onClose: (fn) => closers.push(fn) };
}

export function button(text, { primary = false, onClick } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'primary-btn' : 'secondary-btn';
  b.textContent = text;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** Linha "rótulo + controle" dos formulários dos módulos (o rótulo envolve o controle). */
export function field(labelText, control) {
  const label = document.createElement('label');
  label.className = 'tool-field';
  const span = document.createElement('span');
  span.textContent = labelText;
  if (control.type === 'checkbox') label.append(control, span);
  else label.append(span, control);
  return label;
}

export async function copyText(text) {
  if (window.agzos?.term?.clipboardWrite) return window.agzos.term.clipboardWrite(text);
  return navigator.clipboard.writeText(text);
}

export function joinPath(dir, name) {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export function baseName(p) {
  return String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}
