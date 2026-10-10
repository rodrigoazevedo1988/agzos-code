/**
 * Toast / notificação efêmera.
 */

const container = () => document.getElementById('toast-container');

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
