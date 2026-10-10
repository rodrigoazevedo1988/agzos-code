/**
 * Welcome — pop-up central com o logo completo Agzos.
 *
 * Aparece:
 *  - Na primeira inicialização (settings.welcomeSeen = false)
 *  - Quando o usuário clica em "Sobre" no menu
 *  - Quando o workspace está vazio (welcome screen do editor)
 *
 * Esse pop-up é a porta de entrada pro Onboarding (multi-step).
 */

import { lucideIcon } from './lucide.js';
import { startOnboarding } from './onboarding.js';
import { toast } from './toast.js';

const State = window.AgzosState;

let currentSlide = 0;
let slides = [];

const WELCOME_SLIDES = [
  {
    id: 'main',
    title: 'Bem-vindo ao Agzos Code',
    body: 'O editor de código do time Agzos — IA nativa, terminal integrado e pronto pra multi-plataforma.',
    primary: 'Iniciar Onboarding',
    primaryAction: 'onboarding',
    secondary: 'Pular por enquanto',
    secondaryAction: 'close',
    logo: 'full-light', // ou 'full-dark' pra tema claro
  },
];

export function showWelcome(opts = {}) {
  const overlay = document.getElementById('welcome-popup');
  if (!overlay) return;
  buildWelcomeContent(overlay, opts);
  overlay.classList.add('active');
  State.welcomeOpen = true;
  // Trap focus
  setTimeout(() => {
    const btn = overlay.querySelector('.welcome-primary');
    if (btn) btn.focus();
  }, 60);
}

export function hideWelcome() {
  const overlay = document.getElementById('welcome-popup');
  if (!overlay) return;
  overlay.classList.remove('active');
  State.welcomeOpen = false;
}

function buildWelcomeContent(overlay, opts) {
  overlay.innerHTML = '';

  // Logo SVG oficial (seleciona por tema)
  const theme = State.settings.theme || 'agzos-dark';
  const isLight = theme.includes('light');
  const logoFile = isLight ? 'assets/logo-full-light.svg' : 'assets/logo-full-dark.svg';

  const card = document.createElement('div');
  card.className = 'welcome-card';
  card.innerHTML = `
    <div class="welcome-header">
      <img src="${logoFile}" alt="Agzos Code" class="welcome-logo-img" />
    </div>
    <div class="welcome-body">
      <h2 class="welcome-title">Bem-vindo ao Agzos Code</h2>
      <p class="welcome-msg">
        ${opts.customMsg || 'O editor de código do time Agzos. Vamos configurar seu ambiente em 4 passos rápidos.'}
      </p>
    </div>
    <div class="welcome-footer">
      <button class="welcome-secondary">Pular por enquanto</button>
      <button class="welcome-primary">
        Iniciar Onboarding
        <span class="welcome-primary-icon"></span>
      </button>
    </div>
    <div class="welcome-version">v${State.appVersion || '0.1.0'} • ${State.platform || 'electron'}</div>
  `;

  // Adiciona ícone arrow-right no botão primário
  const primaryIcon = card.querySelector('.welcome-primary-icon');
  primaryIcon.appendChild(lucideIcon('arrow-right', { size: 16, strokeWidth: 2.5 }));

  // Handlers
  card.querySelector('.welcome-primary').addEventListener('click', () => {
    hideWelcome();
    State.settings.welcomeSeen = true;
    window.agzos.settings.save(State.settings);
    setTimeout(() => startOnboarding(), 200);
  });
  card.querySelector('.welcome-secondary').addEventListener('click', () => {
    hideWelcome();
    State.settings.welcomeSeen = true;
    window.agzos.settings.save(State.settings);
    toast('Você pode iniciar o onboarding depois em Help → Onboarding.', 'info', 4000);
  });

  // Click no overlay (fora do card) → ignora (modal, não-dismissable)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      // Não fecha — força o usuário a escolher
    }
  });

  overlay.appendChild(card);
}

/**
 * Welcome screen do editor (estado vazio, dentro do editor area).
 * Diferente do pop-up: é um conteúdo estático quando não há pasta aberta.
 */
export function showEditorWelcome() {
  const welcome = document.getElementById('welcome');
  if (!welcome) return;

  const theme = State.settings.theme || 'agzos-dark';
  const isLight = theme.includes('light');
  const logoFile = isLight ? 'assets/logo-full-light.svg' : 'assets/logo-full-dark.svg';

  welcome.innerHTML = `
    <img src="${logoFile}" alt="Agzos Code" class="welcome-editor-logo" />
    <h1>Agzos Code</h1>
    <p class="welcome-sub">Editor de código do time Agzos</p>
    <div class="welcome-actions">
      <button class="primary-btn welcome-action" data-action="open-folder">
        <span class="welcome-action-icon"></span>
        Abrir Pasta
      </button>
      <button class="primary-btn welcome-action" data-action="open-file">
        <span class="welcome-action-icon"></span>
        Abrir Arquivo
      </button>
      <button class="primary-btn welcome-action" data-action="clone">
        <span class="welcome-action-icon"></span>
        Clonar Repo
      </button>
    </div>
    <div class="welcome-shortcuts">
      <div><kbd>Ctrl+P</kbd> Buscar arquivo</div>
      <div><kbd>Ctrl+Shift+P</kbd> Command Palette</div>
      <div><kbd>Ctrl+\`</kbd> Terminal</div>
      <div><kbd>Ctrl+B</kbd> Sidebar</div>
    </div>
  `;

  // Ícones
  const actions = welcome.querySelectorAll('.welcome-action');
  actions.forEach((btn) => {
    const iconHost = btn.querySelector('.welcome-action-icon');
    const action = btn.dataset.action;
    const iconName = action === 'open-folder' ? 'folder-open'
                   : action === 'open-file' ? 'file-plus'
                   : 'git-branch';
    iconHost.appendChild(lucideIcon(iconName, { size: 16, strokeWidth: 2 }));
  });

  // Handlers
  welcome.querySelector('[data-action="open-folder"]').addEventListener('click', () => {
    document.getElementById('welcome-open-folder')?.click() ||
    document.querySelector('#btn-open-folder')?.click();
  });
  welcome.querySelector('[data-action="open-file"]').addEventListener('click', () => {
    document.querySelector('#welcome-open-file')?.click();
  });
  welcome.querySelector('[data-action="clone"]').addEventListener('click', () => {
    document.querySelector('#welcome-clone')?.click();
  });
}
