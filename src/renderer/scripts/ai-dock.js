/**
 * Agzos IA — dock acoplável (esquerda, direita ou embaixo).
 *
 * Existe um único <section id="ai-panel"> com todo o chat (renderizado por
 * ai-chat.js). Este módulo só MOVE esse nó entre os hosts (appendChild), sem
 * recriá-lo: conversa, foco e streaming em andamento sobrevivem à troca.
 *
 * Hosts:
 *  - left:   #panel-ai dentro da sidebar (view "ai" da activity bar)
 *  - right:  #right-dock-host dentro de #right-dock (coluna à direita, com divisor)
 *  - bottom: #pane-ai, aba AGZOS IA do painel inferior
 *
 * API (export e window.AgzosAiDock): getPosition, setPosition, show, hide,
 * toggle, isVisible, focusInput.
 * A cada mudança dispara window 'agzos:ai-dock' com { position, visible }.
 * Persistência: State.settings.aiPanel.{position,width,visible}.
 *
 * As funções puras (normalização/limites) não tocam DOM: testáveis em Node.
 */

export const AI_DOCK_POSITIONS = ['left', 'right', 'bottom'];
export const AI_DOCK_DEFAULT_POSITION = 'right';
export const AI_DOCK_DEFAULT_WIDTH = 380;
export const AI_DOCK_MIN_WIDTH = 280;
export const AI_DOCK_MAX_WIDTH_RATIO = 0.6;
export const AI_DOCK_EVENT = 'agzos:ai-dock';

export function normalizeDockPosition(pos) {
  return AI_DOCK_POSITIONS.includes(pos) ? pos : AI_DOCK_DEFAULT_POSITION;
}

/** Limita a largura a [280, 60% da janela]; inválido cai no padrão. */
export function clampDockWidth(width, viewportWidth = Infinity) {
  const n = Number(width);
  const base = Number.isFinite(n) && n > 0 ? n : AI_DOCK_DEFAULT_WIDTH;
  const max = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? Math.max(AI_DOCK_MIN_WIDTH, Math.floor(viewportWidth * AI_DOCK_MAX_WIDTH_RATIO))
    : Infinity;
  return Math.round(Math.min(max, Math.max(AI_DOCK_MIN_WIDTH, base)));
}

/** Só as chaves do dock; as demais de aiPanel (fontSize, density…) são de ai-chat/settings. */
export function normalizeDockSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    position: normalizeDockPosition(src.position),
    width: clampDockWidth(src.width),
    visible: typeof src.visible === 'boolean' ? src.visible : true,
  };
}

/* -------------------------------------------------------------------------- */

let deps = {
  switchSidebarView: () => {},
  selectBottomTab: () => {},
  setBottomPanelVisible: () => {},
  getActiveBottomTab: () => 'terminal',
};
let position = AI_DOCK_DEFAULT_POSITION;
let width = AI_DOCK_DEFAULT_WIDTH;
let ready = false;

const $ = (id) => document.getElementById(id);
const state = () => window.AgzosState;

function hostFor(pos) {
  if (pos === 'left') return $('panel-ai');
  if (pos === 'bottom') return $('pane-ai');
  return $('right-dock-host');
}

function panelEl() {
  return $('ai-panel');
}

function persist(patch) {
  const S = state();
  if (!S?.settings) return;
  S.settings.aiPanel = { ...(S.settings.aiPanel || {}), ...patch };
  try {
    const p = window.agzos?.settings?.save(S.settings);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {}
}

function emit() {
  const panel = panelEl();
  if (panel) {
    panel.dataset.position = position;
    panel.dataset.visible = String(isVisible());
  }
  window.dispatchEvent(new CustomEvent(AI_DOCK_EVENT, { detail: { position, visible: isVisible() } }));
}

function applyWidth() {
  const dock = $('right-dock');
  if (dock) dock.style.width = `${clampDockWidth(width, window.innerWidth)}px`;
}

function setRightDockVisible(visible) {
  const dock = $('right-dock');
  if (dock) dock.hidden = !visible;
}

function setBottomTabVisible(visible) {
  const tab = document.querySelector('.bottom-tab[data-tab="ai"]');
  if (tab) tab.hidden = !visible;
}

function sidebarShowingAi() {
  const host = $('panel-ai');
  return !!host && !host.hidden && !document.body.classList.contains('sidebar-hidden');
}

export function getPosition() {
  return position;
}

export function isVisible() {
  if (position === 'right') {
    const dock = $('right-dock');
    return !!dock && !dock.hidden;
  }
  if (position === 'bottom') {
    const panel = $('bottom-panel');
    return !!panel && !panel.hidden && deps.getActiveBottomTab() === 'ai';
  }
  return sidebarShowingAi();
}

// Mostra sem persistir/emitir (usado por show() e pela troca de posição).
function reveal() {
  if (position === 'right') {
    applyWidth();
    setRightDockVisible(true);
  } else if (position === 'bottom') {
    deps.selectBottomTab('ai', { focus: false });
    deps.setBottomPanelVisible(true);
  } else {
    if (document.body.classList.contains('sidebar-hidden')) {
      document.body.classList.remove('sidebar-hidden');
      if (state()) state().sidebarHidden = false;
    }
    deps.switchSidebarView('ai');
  }
}

// Esconde o host da posição `pos` (sem persistir/emitir).
function conceal(pos) {
  if (pos === 'right') {
    setRightDockVisible(false);
  } else if (pos === 'bottom') {
    if (deps.getActiveBottomTab() === 'ai') {
      const panel = $('bottom-panel');
      // Painel aberto na aba IA: fecha o painel; o terminal segue vivo.
      if (panel && !panel.hidden) deps.setBottomPanelVisible(false);
    }
  } else if (sidebarShowingAi()) {
    deps.switchSidebarView('explorer');
  }
}

export function show({ focus = false } = {}) {
  reveal();
  persist({ visible: true });
  emit();
  if (focus) focusInput();
}

export function hide() {
  conceal(position);
  persist({ visible: false });
  emit();
}

export function toggle(opts = {}) {
  if (isVisible()) hide();
  else show(opts);
}

/** Foca a caixa de mensagem do chat (se já renderizada). */
export function focusInput() {
  const panel = panelEl();
  if (!panel) return false;
  // Caixa de mensagem se visível; sem perfil configurado o chat mostra só o
  // estado vazio, então cai para o primeiro botão visível (ex.: "Configurar IA").
  const usable = (el) => !!el && !el.disabled && el.getClientRects().length > 0;
  const candidates = [
    panel.querySelector('#ai-input'),
    ...panel.querySelectorAll('textarea'),
    ...panel.querySelectorAll('button, [tabindex]:not([tabindex="-1"])'),
  ];
  const input = candidates.find(usable);
  if (!input) return false;
  // Ao abrir no painel inferior/sidebar o layout muda; foca no próximo frame.
  requestAnimationFrame(() => input.focus());
  input.focus();
  return true;
}

// Move o #ai-panel para o host de `next` e ajusta abas/colunas (sem persistir).
function place(next) {
  const prev = position;
  if (ready && prev !== next) conceal(prev);
  // Se a aba AGZOS IA estava ativa e a IA sai de baixo, devolve o painel ao terminal.
  if (prev === 'bottom' && next !== 'bottom' && deps.getActiveBottomTab() === 'ai') {
    deps.selectBottomTab('terminal', { focus: false });
  }
  position = next;
  const panel = panelEl();
  const host = hostFor(next);
  if (panel && host && panel.parentElement !== host) host.appendChild(panel);
  setBottomTabVisible(next === 'bottom');
  if (next !== 'right') setRightDockVisible(false);
}

/**
 * Troca a posição. Por padrão mantém a visibilidade atual; `{ show: true }`
 * força exibir (comandos "Mover para…" usam isso).
 */
export function setPosition(pos, { show: showAfter } = {}) {
  const next = normalizeDockPosition(pos);
  const wasVisible = isVisible();
  place(next);
  const visible = showAfter ?? wasVisible;
  if (visible) reveal();
  persist({ position: next, visible: isVisible() });
  emit();
  return next;
}

function setupResizer() {
  const resizer = $('right-dock-resizer');
  const dock = $('right-dock');
  if (!resizer || !dock) return;
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = dock.offsetWidth;
    document.body.classList.add('resizing-ai-dock');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    // Divisor fica à esquerda do dock: arrastar para a esquerda alarga.
    width = clampDockWidth(startWidth + (startX - e.clientX), window.innerWidth);
    applyWidth();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing-ai-dock');
    persist({ width });
    emit();
  });
  resizer.addEventListener('dblclick', () => {
    width = AI_DOCK_DEFAULT_WIDTH;
    applyWidth();
    persist({ width });
  });
  window.addEventListener('resize', () => {
    if (position === 'right') applyWidth();
  });
}

/**
 * Liga o dock. Dependências de layout são injetadas por app.js (evita import
 * circular com app.js e mantém este módulo carregável em testes Node).
 */
export function setupAiDock(options = {}) {
  deps = { ...deps, ...options };
  const cfg = normalizeDockSettings(state()?.settings?.aiPanel);
  width = cfg.width;
  position = cfg.position;
  applyWidth();
  setupResizer();

  // Estado inicial sem gravar settings no boot. Na sidebar não abrimos a view
  // da IA sozinhos: o boot continua no Explorer (a view lateral não é persistida).
  ready = false;
  place(cfg.position);
  ready = true;
  if (cfg.visible && cfg.position !== 'left') reveal();
  emit();

  const api = { getPosition, setPosition, show, hide, toggle, isVisible, focusInput };
  window.AgzosAiDock = api;
  return api;
}
