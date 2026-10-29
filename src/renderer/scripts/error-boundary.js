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

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; } finally { area.remove(); }
  return ok;
}

async function copy(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // O permission handler do app nega clipboard por padrão; cai no fallback.
  }
  return legacyCopy(text);
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
        <textarea class="fatal-diagnostic" readonly hidden></textarea>
        <div class="dialog-actions">
          <button type="button" class="fatal-logs">Abrir logs</button>
          <button type="button" class="fatal-copy">Copiar diagnóstico</button>
          <button type="button" class="fatal-reload primary">Recarregar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.fatal-reload').addEventListener('click', () => location.reload());
    overlay.querySelector('.fatal-copy').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const text = diagnosticText();
      const ok = await copy(text);
      button.textContent = ok ? 'Copiado' : 'Selecione o texto';
      if (!ok) {
        const area = overlay.querySelector('.fatal-diagnostic');
        area.hidden = false;
        area.value = text;
        area.focus();
        area.select();
      }
    });
    overlay.querySelector('.fatal-logs').addEventListener('click', () => {
      const result = window.agzos?.logs?.open?.();
      if (result?.catch) result.catch(() => {});
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
