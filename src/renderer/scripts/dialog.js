/**
 * Diálogos internos do renderer — substituem window.prompt(), que o Electron
 * não implementa. Usados para novo arquivo/pasta e renomear.
 */

let active = null;

function makeOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'input-dialog-overlay';
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * @param {{ title: string, label?: string, value?: string, placeholder?: string, confirmLabel?: string, validate?: (v: string) => string|null }} opts
 * @returns {Promise<string|null>}
 */
export function showInputDialog(opts) {
  if (active) return Promise.resolve(null);
  const {
    title,
    label = '',
    value = '',
    placeholder = '',
    confirmLabel = 'Confirmar',
    validate = () => null,
  } = opts;

  return new Promise((resolve) => {
    const overlay = makeOverlay();
    const card = document.createElement('div');
    card.className = 'dialog-card';
    card.innerHTML = `
      <h3></h3>
      <p></p>
      <input type="text" spellcheck="false" autocomplete="off" />
      <div class="dialog-error"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-cancel">Cancelar</button>
        <button type="button" class="dialog-ok primary"></button>
      </div>
    `;
    card.querySelector('h3').textContent = title;
    const desc = card.querySelector('p');
    desc.textContent = label;
    desc.hidden = !label;
    const input = card.querySelector('input');
    input.value = value;
    input.placeholder = placeholder;
    const error = card.querySelector('.dialog-error');
    const ok = card.querySelector('.dialog-ok');
    ok.textContent = confirmLabel;
    const cancel = card.querySelector('.dialog-cancel');

    const cleanup = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onDocKeydown, true);
      active = null;
      resolve(result);
    };

    const tryConfirm = () => {
      const v = input.value.trim();
      const err = validate(v);
      if (err) {
        error.textContent = err;
        input.focus();
        return;
      }
      cleanup(v);
    };

    const onDocKeydown = (e) => {
      if (!document.body.contains(overlay)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup(null);
      }
    };

    ok.addEventListener('click', tryConfirm);
    cancel.addEventListener('click', () => cleanup(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        tryConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup(null);
      }
    });
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) cleanup(null);
    });

    active = { overlay, cleanup };
    overlay.appendChild(card);
    document.addEventListener('keydown', onDocKeydown, true);
    input.focus();
    input.select();
  });
}

export function closeInputDialog() {
  if (active) active.cleanup(null);
}
