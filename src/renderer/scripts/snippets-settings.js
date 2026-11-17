/**
 * Configurações → Módulos Agzos → Snippets: lista editável de variáveis da marca
 * (settings.modules.snippets.variables = [{ name, value }]). Salva a cada mudança válida;
 * o main normaliza de novo (lib/settings.js normalizeModules).
 */

import { lucideIcon } from './lucide.js';
import { toast } from './toast.js';

const State = window.AgzosState;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_VARIABLES = [
  { name: 'cor_primaria', value: '#D10A11' },
  { name: 'cor_fundo', value: '#0E0E0E' },
  { name: 'cor_texto', value: '#E8E8E8' },
  { name: 'cor_secundaria', value: '#1A1A1A' },
  { name: 'fonte', value: 'Inter, sans-serif' },
  { name: 'nome_marca', value: 'Agzos' },
  { name: 'url_site', value: 'https://seudominio.com.br' },
  { name: 'email_contato', value: 'contato@seudominio.com.br' },
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function currentVariables() {
  const v = State.settings?.modules?.snippets?.variables;
  return Array.isArray(v) ? v.map((x) => ({ ...x })) : DEFAULT_VARIABLES.map((x) => ({ ...x }));
}

export function mountSnippetVariables(host, { notify = () => {} } = {}) {
  host.replaceChildren();
  const list = el('div', 'sn-vars');
  list.id = 'snippets-vars';

  async function persist() {
    const rows = [...list.querySelectorAll('.sn-var-row')];
    const seen = new Set();
    const out = [];
    let invalid = false;
    for (const row of rows) {
      const nameInput = row.querySelector('.sn-var-name');
      const name = nameInput.value.trim();
      nameInput.classList.remove('invalid');
      if (!name) continue; // linha nova ainda sem nome
      if (!NAME_RE.test(name) || seen.has(name)) {
        nameInput.classList.add('invalid');
        invalid = true;
        continue;
      }
      seen.add(name);
      out.push({ name, value: row.querySelector('.sn-var-value').value });
    }
    if (invalid) {
      toast('Nome de variável inválido ou repetido (use letras, números e _).', 'error', 3500);
      return;
    }
    State.settings.modules = State.settings.modules || {};
    State.settings.modules.snippets = { ...(State.settings.modules.snippets || { enabled: true }), variables: out };
    await window.agzos.settings.save(State.settings);
    notify();
  }

  function addRow({ name = '', value = '' } = {}) {
    const row = el('div', 'sn-var-row');
    row.dataset.name = name;
    const nameInput = el('input', 'sn-var-name');
    nameInput.type = 'text';
    nameInput.value = name;
    nameInput.placeholder = 'nome_da_variavel';
    nameInput.setAttribute('aria-label', 'Nome da variável');
    nameInput.spellcheck = false;
    const color = el('input', 'sn-var-color');
    color.type = 'color';
    color.setAttribute('aria-label', 'Escolher cor');
    const valueInput = el('input', 'sn-var-value');
    valueInput.type = 'text';
    valueInput.value = value;
    valueInput.setAttribute('aria-label', `Valor de ${name || 'nova variável'}`);
    valueInput.spellcheck = false;
    const syncColor = () => {
      const hex = HEX6_RE.test(valueInput.value.trim());
      color.disabled = !hex;
      if (hex) color.value = valueInput.value.trim().toLowerCase();
    };
    syncColor();
    const remove = el('button', 'sn-icon-btn');
    remove.type = 'button';
    remove.title = 'Remover variável';
    remove.setAttribute('aria-label', 'Remover variável');
    remove.append(lucideIcon('x', { size: 14 }));

    nameInput.addEventListener('input', () => { row.dataset.name = nameInput.value.trim(); });
    nameInput.addEventListener('change', persist);
    valueInput.addEventListener('input', syncColor);
    valueInput.addEventListener('change', persist);
    color.addEventListener('input', () => { valueInput.value = color.value.toUpperCase(); });
    color.addEventListener('change', persist);
    remove.addEventListener('click', () => { row.remove(); persist(); });
    row.append(nameInput, color, valueInput, remove);
    list.append(row);
    return row;
  }

  for (const v of currentVariables()) addRow(v);

  const actions = el('div', 'sn-vars-actions');
  const add = el('button', 'secondary-btn', '+ Adicionar variável');
  add.type = 'button';
  add.id = 'snippets-var-add';
  add.addEventListener('click', () => addRow().querySelector('.sn-var-name').focus());
  const reset = el('button', 'secondary-btn', 'Restaurar variáveis padrão');
  reset.type = 'button';
  reset.id = 'snippets-var-reset';
  reset.addEventListener('click', async () => {
    list.replaceChildren();
    for (const v of DEFAULT_VARIABLES) addRow(v);
    await persist();
  });
  actions.append(add, reset);
  host.append(list, actions);
}
