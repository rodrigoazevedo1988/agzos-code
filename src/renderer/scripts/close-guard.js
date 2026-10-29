/**
 * Guard de fechamento com alterações não salvas.
 *
 * O main intercepta o close da janela e manda `window:request-close` quando
 * há arquivos dirty. Aqui mostramos Salvar tudo / Descartar / Cancelar e
 * respondemos ao main.
 */

let overlay = null;
let busy = false;

function buildOverlay() {
  const existing = document.getElementById('close-guard-overlay');
  if (existing) return existing;
  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'close-guard-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="dialog-card">
      <h3>Você tem alterações não salvas</h3>
      <p>Feche o Agzos Code depois de decidir o que fazer com estes arquivos:</p>
      <ul class="close-guard-list"></ul>
      <div class="dialog-actions">
        <button type="button" class="cg-cancel">Cancelar</button>
        <button type="button" class="cg-discard">Descartar e fechar</button>
        <button type="button" class="cg-save primary">Salvar tudo e fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * @param {{ getDirtyFiles: () => Array<{path: string}>, saveAll: () => Promise<boolean> }} deps
 */
export function setupCloseGuard({ getDirtyFiles, saveAll }) {
  const host = buildOverlay();
  const list = host.querySelector('.close-guard-list');
  const save = host.querySelector('.cg-save');
  const discard = host.querySelector('.cg-discard');
  const cancel = host.querySelector('.cg-cancel');

  const respond = (action) => {
    host.hidden = true;
    busy = false;
    window.agzos.windowState.respondClose(action);
  };

  const show = () => {
    const dirty = getDirtyFiles();
    if (dirty.length === 0) {
      respond('close');
      return;
    }
    list.replaceChildren();
    for (const f of dirty) {
      const li = document.createElement('li');
      li.textContent = f.path.split(/[\\/]/).pop();
      li.title = f.path;
      list.appendChild(li);
    }
    busy = false;
    save.disabled = false;
    discard.disabled = false;
    cancel.disabled = false;
    host.hidden = false;
    setTimeout(() => save.focus(), 30);
  };

  save.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    save.disabled = true;
    discard.disabled = true;
    cancel.disabled = true;
    const ok = await saveAll();
    if (ok) {
      respond('close');
      return;
    }
    busy = false;
    save.disabled = false;
    discard.disabled = false;
    cancel.disabled = false;
  });

  discard.addEventListener('click', () => {
    if (busy) return;
    respond('close');
  });

  cancel.addEventListener('click', () => {
    if (busy) return;
    respond('cancel');
  });

  document.addEventListener('keydown', (e) => {
    if (host.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) respond('cancel');
    }
  }, true);

  window.agzos.windowState.onRequestClose(show);
}
