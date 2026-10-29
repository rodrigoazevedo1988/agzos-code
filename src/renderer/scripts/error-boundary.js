/**
 * Error boundary do renderer: evita a "tela preta" quando um módulo quebra.
 * Mostra um fallback com recarregar, copiar diagnóstico e abrir logs.
 */

let installed = false;
let overlay = null;
let lastError = '';

function diagnosticText() {
  const info = window.AgzosState || {};
  return [
    `Erro: ${lastError}`,
    `Versão: ${info.appVersion || '?'}`,
    `Plataforma: ${info.platform || '?'}`,
    `URL: ${location.href}`,
    `User agent: ${navigator.userAgent}`,
    `Data: ${new Date().toISOString()}`,
  ].join('\n');
}

function copy(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); } finally { area.remove(); }
  return Promise.resolve();
}

function showFatal(message) {
  lastError = String(message || 'Erro desconhecido');
  try { window.agzos?.app?.log?.('error', lastError); } catch {}

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.id = 'fatal-overlay';
    overlay.innerHTML = `
      <div class="dialog-card">
        <h3>O Agzos Code encontrou um erro</h3>
        <p class="fatal-message"></p>
        <div class="dialog-actions">
          <button type="button" class="fatal-logs">Abrir logs</button>
          <button type="button" class="fatal-copy">Copiar diagnóstico</button>
          <button type="button" class="fatal-reload primary">Recarregar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.fatal-reload').addEventListener('click', () => location.reload());
    overlay.querySelector('.fatal-copy').addEventListener('click', () => copy(diagnosticText()));
    overlay.querySelector('.fatal-logs').addEventListener('click', () => {
      window.agzos?.logs?.open?.().catch(() => {});
    });
  }
  overlay.hidden = false;
  overlay.querySelector('.fatal-message').textContent = lastError;
}

export function setupErrorBoundary() {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    showFatal(event.error?.message || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    showFatal(reason?.message || String(reason));
  });
}

export { showFatal };
