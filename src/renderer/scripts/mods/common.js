/**
 * Utilidades comuns dos módulos de editor (Erros na Linha, Erros Claros, Marca-texto, Formatador).
 *
 *   modSettings(id) → settings.modules[id] (objeto, nunca null)
 *   isModEnabled(id) → enabled !== false
 *   setModSetting(id, key, value) → grava em settings.modules[id][key] e avisa os módulos
 *   onModSettings(fn) → chamada quando settings.modules muda (Configurações, hub, outra janela)
 *   mountModView(container, { id, description, details? }) → view do card no hub com liga/desliga
 */

import { lucideIcon } from '../lucide.js';

const State = window.AgzosState;

export function modSettings(id) {
  const cfg = State.settings?.modules?.[id];
  return cfg && typeof cfg === 'object' ? cfg : {};
}

export function isModEnabled(id) {
  return modSettings(id).enabled !== false;
}

export function notifyModules() {
  window.dispatchEvent(new CustomEvent('agzos:modules-settings', { detail: { modules: State.settings.modules } }));
}

export async function setModSetting(id, key, value) {
  State.settings.modules = State.settings.modules || {};
  State.settings.modules[id] = { ...modSettings(id), [key]: value };
  notifyModules();
  await window.agzos.settings.save(State.settings);
}

export function onModSettings(fn) {
  window.addEventListener('agzos:modules-settings', () => fn());
}

/** View simples do card: descrição, interruptor "Habilitado" e atalho para as Configurações. */
export function mountModView(container, { id, description, details = [] }) {
  const render = () => {
    container.replaceChildren();
    const desc = document.createElement('p');
    desc.className = 'mod-view-desc';
    desc.textContent = description;

    const label = document.createElement('label');
    label.className = 'mod-view-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'mod-enabled-toggle';
    input.checked = isModEnabled(id);
    input.addEventListener('change', () => setModSetting(id, 'enabled', input.checked));
    const text = document.createElement('span');
    text.textContent = 'Habilitado';
    label.append(input, text);

    container.append(desc, label);
    if (details.length) {
      const list = document.createElement('ul');
      list.className = 'mod-view-details';
      for (const item of details) {
        const li = document.createElement('li');
        li.textContent = item;
        list.append(li);
      }
      container.append(list);
    }

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'mod-view-settings';
    settingsBtn.append(lucideIcon('settings', { size: 14, strokeWidth: 1.8 }), document.createTextNode(' Opções nas Configurações'));
    settingsBtn.addEventListener('click', () => {
      import('../settings-modal.js').then((m) => m.openSettingsModal('modules')).catch(() => {});
    });
    container.append(settingsBtn);
  };
  render();
  // Re-render quando outra parte do app muda a configuração (só enquanto a view estiver montada).
  const onChange = () => {
    if (!container.isConnected) {
      window.removeEventListener('agzos:modules-settings', onChange);
      return;
    }
    const input = container.querySelector('input.mod-enabled-toggle');
    if (input) input.checked = isModEnabled(id);
  };
  window.addEventListener('agzos:modules-settings', onChange);
}
