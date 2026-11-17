/**
 * Toast / notificação efêmera.
 */

const container = () => document.getElementById('toast-container');

/** Toast com um botão de ação (ex.: "Desfazer"). */
export function toastAction(message, { label, onClick, type = 'success', duration = 10000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type} toast-action`;
  const text = document.createElement('span');
  text.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toast-action-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => { el.remove(); onClick?.(); });
  el.append(text, btn);
  container().appendChild(el);
  setTimeout(() => el.remove(), duration);
  return el;
}

export function toast(message, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container().appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.2s, transform 0.2s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 220);
  }, duration);
}
