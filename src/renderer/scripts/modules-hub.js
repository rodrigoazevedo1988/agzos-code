/**
 * Hub "Módulos Agzos" (activity bar, Ctrl+Shift+X): lista de cards dos módulos
 * nativos. Cada módulo se registra com registerModule(); clicar no card chama
 * open(container), que monta a view do módulo dentro do painel, com "← Módulos" no topo.
 *
 * API:
 *   registerModule({ id, label, icon, description, comingSoon = false, open(container) })
 *   openModule(id) → boolean · showModulesHub()
 */

import { lucideIcon } from './lucide.js';

const State = window.AgzosState;

// Ordem fixa dos cards; módulos desconhecidos vêm depois, na ordem de registro.
const ORDER = ['broom', 'envVault', 'snippets', 'sandbox', 'gitSlider'];

const modules = new Map(); // id → def
let currentId = null; // módulo aberto (null = lista de cards)
let showView = () => {}; // troca a sidebar para a view "modules" (injetado pelo app.js)

const host = () => document.getElementById('panel-modules');

export function registerModule(def) {
  if (!def || typeof def.id !== 'string' || !def.id) throw new Error('registerModule: id obrigatório');
  modules.set(def.id, {
    label: def.id,
    icon: 'blocks',
    description: '',
    comingSoon: false,
    open: null,
    ...def,
  });
  if (currentId === null) renderHub();
}

/** Abre a view de um módulo no painel. Card "Em breve" ou id desconhecido → false. */
export function openModule(id) {
  const def = modules.get(id);
  if (!def || def.comingSoon || typeof def.open !== 'function') return false;
  showView();
  const el = host();
  if (!el) return false;
  currentId = id;
  el.replaceChildren();

  const header = document.createElement('div');
  header.className = 'modules-header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'modules-back';
  back.textContent = '← Módulos';
  back.title = 'Voltar para a lista de módulos';
  back.addEventListener('click', () => showModulesHub());
  const title = document.createElement('span');
  title.className = 'modules-header-title';
  title.textContent = def.label;
  header.append(back, title);

  const view = document.createElement('div');
  view.className = 'module-view';
  view.dataset.module = id;
  el.append(header, view);
  try {
    def.open(view);
  } catch (err) {
    console.error(`[módulos] falha ao abrir ${id}:`, err);
    view.textContent = `Não foi possível abrir ${def.label}: ${err.message}`;
  }
  return true;
}

/** Volta para a lista de cards (e mostra o painel do hub). */
export function showModulesHub() {
  showView();
  currentId = null;
  renderHub();
}

function isEnabled(id) {
  const cfg = State.settings?.modules?.[id];
  return !cfg || cfg.enabled !== false;
}

function sortedModules() {
  const rank = (id) => {
    const i = ORDER.indexOf(id);
    return i === -1 ? ORDER.length : i;
  };
  return [...modules.values()]
    .map((def, i) => ({ def, i }))
    .sort((a, b) => (rank(a.def.id) - rank(b.def.id)) || (a.i - b.i))
    .map(({ def }) => def);
}

function renderHub() {
  const el = host();
  if (!el || currentId !== null) return;
  el.replaceChildren();

  const intro = document.createElement('p');
  intro.className = 'modules-intro';
  intro.textContent = 'Utilidades nativas do Agzos Code, sem extensões.';
  el.appendChild(intro);

  const list = document.createElement('div');
  list.className = 'modules-list';
  for (const def of sortedModules()) list.appendChild(buildCard(def));
  el.appendChild(list);
}

function buildCard(def) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'module-card';
  card.dataset.module = def.id;
  if (def.comingSoon) {
    card.classList.add('coming-soon');
    card.setAttribute('aria-disabled', 'true');
  }

  const icon = document.createElement('span');
  icon.className = 'module-card-icon';
  icon.appendChild(lucideIcon(def.icon || 'blocks', { size: 20, strokeWidth: 1.8 }));

  const body = document.createElement('span');
  body.className = 'module-card-body';
  const name = document.createElement('span');
  name.className = 'module-card-name';
  name.textContent = def.label;
  const desc = document.createElement('span');
  desc.className = 'module-card-desc';
  desc.textContent = def.description || '';
  body.append(name, desc);

  const status = document.createElement('span');
  status.className = 'module-card-status';
  if (def.comingSoon) {
    status.textContent = 'Em breve';
  } else if (isEnabled(def.id)) {
    status.textContent = 'Habilitado';
    status.classList.add('on');
  } else {
    status.textContent = 'Desabilitado';
    status.classList.add('off');
  }

  card.append(icon, body, status);
  card.addEventListener('click', () => {
    if (def.comingSoon) return;
    openModule(def.id);
  });
  return card;
}

/** Chamado pelo app.js no boot. */
export function setupModulesHub({ switchSidebarView } = {}) {
  if (typeof switchSidebarView === 'function') showView = () => switchSidebarView('modules');
  // Snippets: card ativo registrado por snippets.js (setupSnippets).
  registerModule({
    id: 'sandbox',
    label: 'Sandbox de Componentes',
    icon: 'layout-template',
    description: 'Pré-visualize componentes React/Next isolados.',
    comingSoon: true,
  });
  registerModule({
    id: 'gitSlider',
    label: 'Git Slider',
    icon: 'git-commit-horizontal',
    description: 'Navegue pelo histórico de um arquivo com um controle deslizante.',
    comingSoon: true,
  });
  // Estado habilitado/desabilitado muda nas Configurações (settings-modal.js).
  window.addEventListener('agzos:modules-settings', () => renderHub());
  renderHub();
}
