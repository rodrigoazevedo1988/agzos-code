/**
 * Diálogo modal leve para os fluxos de Git/GitHub (clonar, criar branch,
 * publicar, Pull Request, confirmações). Sem innerHTML com dados do usuário.
 *
 * openGitDialog({ title, description, fields, submitLabel, danger, onSubmit })
 *  fields: [{ name, label, type: text|password|textarea|select|checkbox|radio|folder,
 *             value, placeholder, options: [{ value, label }], hint, required, autofocus }]
 *  onSubmit(values, ctl) → pode lançar (mostra o erro) ou retornar valor (fecha e resolve).
 *  ctl: { setProgress(pct, text), setBusy(bool), setError(msg), field(name) }
 * → Promise<valor retornado | null (cancelado)>
 */

import { lucideIcon } from './lucide.js';

let openCount = 0;

export function isGitDialogOpen() {
  return openCount > 0;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function openGitDialog({
  title, description, icon = null, fields = [], submitLabel = 'OK', cancelLabel = 'Cancelar',
  danger = false, onSubmit, onFieldChange, onOpen, id,
}) {
  return new Promise((resolve) => {
    openCount += 1;
    const previousFocus = document.activeElement;
    const overlay = el('div', 'git-dialog-overlay');
    overlay.setAttribute('role', 'presentation');
    const dialog = el('form', 'git-dialog');
    if (id) dialog.id = id;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.noValidate = true;

    const head = el('div', 'git-dialog-head');
    if (icon) {
      const ic = el('span', 'git-dialog-icon');
      ic.append(icon instanceof Node ? icon : lucideIcon(icon, { size: 18, strokeWidth: 1.8 }));
      head.append(ic);
    }
    const h = el('h2', 'git-dialog-title', title);
    h.id = `git-dialog-title-${Date.now()}`;
    dialog.setAttribute('aria-labelledby', h.id);
    head.append(h);
    dialog.append(head);
    if (description) dialog.append(el('p', 'git-dialog-desc', description));

    const body = el('div', 'git-dialog-body');
    const inputs = new Map();
    for (const f of fields) {
      const row = el('div', `git-field git-field-${f.type || 'text'}`);
      row.dataset.name = f.name;
      const inputId = `gitf-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
      let input;
      if (f.type === 'checkbox') {
        const label = el('label', 'git-check');
        input = el('input');
        input.type = 'checkbox';
        input.checked = !!f.value;
        label.append(input, el('span', null, f.label));
        row.append(label);
      } else if (f.type === 'radio') {
        row.append(el('span', 'git-field-label', f.label));
        const group = el('div', 'git-segmented');
        group.setAttribute('role', 'radiogroup');
        const radios = [];
        for (const opt of f.options || []) {
          const lab = el('label', 'git-seg');
          const r = el('input');
          r.type = 'radio';
          r.name = inputId;
          r.value = opt.value;
          r.checked = String(f.value) === String(opt.value);
          lab.append(r, el('span', null, opt.label));
          group.append(lab);
          radios.push(r);
        }
        row.append(group);
        input = {
          get value() { return radios.find((r) => r.checked)?.value ?? null; },
          addEventListener: (ev, cb) => radios.forEach((r) => r.addEventListener(ev, cb)),
          focus: () => radios[0]?.focus(),
        };
      } else {
        const label = el('label', 'git-field-label', f.label);
        label.htmlFor = inputId;
        row.append(label);
        if (f.type === 'textarea') {
          input = el('textarea', 'git-input');
          input.rows = f.rows || 4;
        } else if (f.type === 'select') {
          input = el('select', 'git-input');
          setSelectOptions(input, f.options || [], f.value);
        } else {
          input = el('input', 'git-input');
          input.type = f.type === 'password' ? 'password' : 'text';
          input.autocomplete = 'off';
          input.spellcheck = false;
        }
        input.id = inputId;
        if (f.type !== 'select') input.value = f.value ?? '';
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.type === 'folder') {
          const wrap = el('div', 'git-folder');
          input.readOnly = true;
          const pick = el('button', 'git-btn git-btn-ghost', f.pickLabel || 'Escolher…');
          pick.type = 'button';
          pick.addEventListener('click', async () => {
            const p = await window.agzos.dialog.openFolder();
            if (p) { input.value = p; input.dispatchEvent(new Event('input')); }
          });
          wrap.append(input, pick);
          row.append(wrap);
        } else {
          row.append(input);
        }
      }
      if (f.hint) {
        const hint = el('small', 'git-field-hint');
        if (f.hint instanceof Node) hint.append(f.hint); else hint.textContent = f.hint;
        row.append(hint);
      }
      if (onFieldChange) input.addEventListener(f.type === 'text' || f.type === 'textarea' || f.type === 'password' ? 'input' : 'change', () => onFieldChange(f.name, valueOf(f.name), ctl));
      inputs.set(f.name, { def: f, input, row });
      body.append(row);
    }
    dialog.append(body);

    const progress = el('div', 'git-progress');
    progress.hidden = true;
    const bar = el('div', 'git-progress-bar');
    const barFill = el('span');
    bar.append(barFill);
    const progressText = el('span', 'git-progress-text');
    progress.append(bar, progressText);
    dialog.append(progress);

    const error = el('p', 'git-dialog-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    dialog.append(error);

    const actions = el('div', 'git-dialog-actions');
    const cancel = el('button', 'git-btn git-btn-ghost', cancelLabel);
    cancel.type = 'button';
    const submit = el('button', `git-btn ${danger ? 'git-btn-danger' : 'git-btn-primary'}`, submitLabel);
    submit.type = 'submit';
    actions.append(cancel, submit);
    dialog.append(actions);
    overlay.append(dialog);
    document.body.append(overlay);

    function valueOf(name) {
      const x = inputs.get(name);
      if (!x) return undefined;
      if (x.def.type === 'checkbox') return x.input.checked;
      return x.input.value;
    }
    function values() {
      const out = {};
      for (const name of inputs.keys()) out[name] = valueOf(name);
      return out;
    }

    let busy = false;
    const ctl = {
      setProgress(pct, text) {
        progress.hidden = false;
        progress.classList.toggle('indeterminate', pct == null);
        barFill.style.width = pct == null ? '' : `${Math.max(0, Math.min(100, pct))}%`;
        progressText.textContent = text || '';
      },
      setBusy(b) {
        busy = b;
        submit.disabled = b;
        dialog.classList.toggle('busy', b);
        for (const { input } of inputs.values()) if ('disabled' in input) input.disabled = b;
      },
      setError(msg) {
        error.hidden = !msg;
        error.textContent = msg || '';
      },
      field(name) { return inputs.get(name)?.input || null; },
      setOptions(name, options, value) {
        const x = inputs.get(name);
        if (x && x.def.type === 'select') setSelectOptions(x.input, options, value);
      },
      values,
    };

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      openCount -= 1;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); dialog.requestSubmit(); }
    }
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => { if (!busy) close(null); });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !busy) close(null); });
    dialog.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      for (const [name, { def, input }] of inputs) {
        if (def.required && !String(valueOf(name) || '').trim()) {
          ctl.setError(`Preencha: ${def.label}`);
          input.focus?.();
          return;
        }
      }
      ctl.setError('');
      if (!onSubmit) { close(values()); return; }
      ctl.setBusy(true);
      try {
        const result = await onSubmit(values(), ctl);
        close(result === undefined ? true : result);
      } catch (err) {
        ctl.setBusy(false);
        progress.hidden = true;
        ctl.setError(err?.message || String(err));
      }
    });

    if (onOpen) { try { onOpen(ctl); } catch { /* opcional */ } }
    const first = fields.find((f) => f.autofocus) || fields.find((f) => f.type !== 'folder' && f.type !== 'radio' && f.type !== 'checkbox');
    setTimeout(() => {
      if (first) inputs.get(first.name)?.input.focus?.();
      else submit.focus();
    }, 30);
  });
}

function setSelectOptions(select, options, value) {
  select.replaceChildren();
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (String(opt.value) === String(value)) o.selected = true;
    select.append(o);
  }
}

/** Confirmação estilizada. → Promise<boolean> */
export async function confirmGit({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  const res = await openGitDialog({ title, description: message, submitLabel: confirmLabel, danger, fields: [] });
  return !!res;
}
