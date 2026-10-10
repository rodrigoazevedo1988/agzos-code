/**
 * Onboarding — wizard multi-step na primeira execução.
 *
 * Steps:
 *  1. Boas-vindas + escolha de tema (dark/light)
 *  2. Migrar de outro editor (VS Code, Cursor, Sublime, Atom)
 *  3. Conectar GitHub (multi-conta)
 *  4. Escolher layout (sidebar position, terminal position, density)
 *  5. Done — atalhos + dica
 *
 * Persiste em settings.onboardingCompleted.
 */

import { lucideIcon } from './lucide.js';
import { toast } from './toast.js';

const State = window.AgzosState;

const STEPS = [
  { id: 'welcome', title: 'Bem-vindo ao Agzos Code', subtitle: 'Vamos configurar seu editor em 5 passos.' },
  { id: 'theme', title: 'Escolha um tema', subtitle: 'Você pode mudar depois em Settings → Tema.' },
  { id: 'migrate', title: 'Migrar de outro editor?', subtitle: 'Importa configurações, extensões e keybindings.' },
  { id: 'github', title: 'Conectar GitHub', subtitle: 'Suporte multi-conta com switcher na status bar.' },
  { id: 'layout', title: 'Layout e densidade', subtitle: 'Posição da sidebar, terminal e tamanho dos elementos.' },
  { id: 'done', title: 'Tudo pronto!', subtitle: 'Aqui estão seus atalhos principais.' },
];

let currentStep = 0;
let answers = {
  theme: null,
  migrateFrom: null,
  github: null,
  layout: null,
  density: 'comfortable',
};

export function startOnboarding() {
  if (State.settings.onboardingCompleted && !State.onboardingForced) {
    // Já completou antes — não mostra a menos que forçado
    return;
  }
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  State.onboardingActive = true;
  currentStep = 0;
  renderStep(overlay);
  overlay.classList.add('active');
  setTimeout(() => {
    const btn = overlay.querySelector('.onb-primary');
    if (btn) btn.focus();
  }, 60);
}

export function exitOnboarding(opts = {}) {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  State.onboardingActive = false;
  if (opts.completed) {
    State.settings.onboardingCompleted = true;
    State.settings.onboardingAnswers = answers;
    window.agzos.settings.save(State.settings);
    toast('Onboarding concluído! 🚀', 'success', 3000);
  } else {
    State.settings.onboardingSkipped = true;
    window.agzos.settings.save(State.settings);
  }
}

function renderStep(overlay) {
  const step = STEPS[currentStep];
  overlay.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'onb-card';

  // Header (logo + progress)
  const header = document.createElement('div');
  header.className = 'onb-header';
  header.innerHTML = `
    <div class="onb-logo"></div>
    <div class="onb-progress">
      ${STEPS.map((_, i) => `<div class="onb-dot ${i <= currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}"></div>`).join('')}
    </div>
  `;
  const logoHost = header.querySelector('.onb-logo');
  logoHost.appendChild(lucideIcon('sparkles', { size: 22, strokeWidth: 2 }));
  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'onb-body';
  body.innerHTML = `<h2>${step.title}</h2><p class="onb-subtitle">${step.subtitle}</p>`;

  const content = document.createElement('div');
  content.className = 'onb-step-content';
  body.appendChild(content);
  card.appendChild(body);

  // Render content por step
  switch (step.id) {
    case 'welcome':
      renderWelcomeStep(content);
      break;
    case 'theme':
      renderThemeStep(content);
      break;
    case 'migrate':
      renderMigrateStep(content);
      break;
    case 'github':
      renderGithubStep(content);
      break;
    case 'layout':
      renderLayoutStep(content);
      break;
    case 'done':
      renderDoneStep(content);
      break;
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'onb-footer';
  const isFirst = currentStep === 0;
  const isLast = currentStep === STEPS.length - 1;

  const skip = document.createElement('button');
  skip.className = 'onb-skip';
  skip.textContent = 'Pular onboarding';
  skip.addEventListener('click', () => exitOnboarding({ completed: false }));
  if (isLast) skip.style.display = 'none';

  const navLeft = document.createElement('div');
  navLeft.className = 'onb-nav-left';
  const back = document.createElement('button');
  back.className = 'onb-secondary';
  const backIcon = document.createElement('span');
  backIcon.appendChild(lucideIcon('arrow-left', { size: 14, strokeWidth: 2.5 }));
  back.appendChild(backIcon);
  back.appendChild(document.createTextNode(' Voltar'));
  back.disabled = isFirst;
  back.addEventListener('click', () => { currentStep--; renderStep(overlay); });
  navLeft.appendChild(back);
  navLeft.appendChild(skip);

  const next = document.createElement('button');
  next.className = 'onb-primary';
  if (isLast) {
    next.textContent = 'Começar a usar';
    const arr = document.createElement('span');
    arr.appendChild(lucideIcon('check', { size: 16, strokeWidth: 2.5 }));
    next.appendChild(arr);
  } else {
    next.textContent = 'Próximo';
    const arr = document.createElement('span');
    arr.appendChild(lucideIcon('arrow-right', { size: 16, strokeWidth: 2.5 }));
    next.appendChild(arr);
  }
  next.addEventListener('click', () => {
    if (isLast) {
      exitOnboarding({ completed: true });
    } else {
      currentStep++;
      renderStep(overlay);
    }
  });

  footer.appendChild(navLeft);
  footer.appendChild(next);
  card.appendChild(footer);

  overlay.appendChild(card);

  // Click fora do card → ignora
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) e.stopPropagation();
  });
}

/* -------------------- step renderers -------------------- */

function renderWelcomeStep(host) {
  const theme = State.settings.theme || 'agzos-dark';
  const isLight = theme.includes('light');
  const logoFile = isLight ? 'assets/logo-full-light.svg' : 'assets/logo-full-dark.svg';
  const hero = document.createElement('div');
  hero.className = 'onb-hero';
  hero.innerHTML = `
    <img src="${logoFile}" alt="Agzos Code" class="onb-hero-logo" />
    <p class="onb-hero-text">
      O editor do time Agzos. Familiar como o que você já usa, com IA nativa,
      terminal integrado e a paleta da casa.
    </p>
    <div class="onb-feature-list">
      <div class="onb-feature">
        <span class="onb-feature-icon"></span>
        <div>
          <strong>Monaco Editor</strong>
          <small>O mesmo engine do VS Code</small>
        </div>
      </div>
      <div class="onb-feature">
        <span class="onb-feature-icon"></span>
        <div>
          <strong>IA multi-provider</strong>
          <small>OpenAI, Anthropic, Groq, OpenRouter, Ollama</small>
        </div>
      </div>
      <div class="onb-feature">
        <span class="onb-feature-icon"></span>
        <div>
          <strong>Privacidade primeiro</strong>
          <small>Telemetria off por padrão</small>
        </div>
      </div>
    </div>
  `;
  // icones das features
  const icons = hero.querySelectorAll('.onb-feature-icon');
  const names = ['code-2', 'sparkles', 'shield-check'];
  icons.forEach((el, i) => el.appendChild(lucideIcon(names[i], { size: 20, strokeWidth: 1.8 })));
  host.appendChild(hero);
}

function renderThemeStep(host) {
  const themes = [
    { id: 'agzos-dark', name: 'Agzos Dark', desc: 'Preto + vermelho, a cara Agzos', icon: 'moon' },
    { id: 'agzos-light', name: 'Agzos Light', desc: 'Fundo branco, mesmo DNA', icon: 'sun' },
    { id: 'monokai', name: 'Monokai', desc: 'Clássico, alto contraste', icon: 'palette' },
    { id: 'auto', name: 'Seguir sistema', desc: 'Muda junto com seu OS', icon: 'monitor' },
  ];
  const current = answers.theme || State.settings.theme || 'agzos-dark';
  const grid = document.createElement('div');
  grid.className = 'onb-theme-grid';
  themes.forEach((t) => {
    const card = document.createElement('button');
    card.className = `onb-theme-card ${current === t.id ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="onb-theme-icon"></div>
      <div class="onb-theme-name">${t.name}</div>
      <div class="onb-theme-desc">${t.desc}</div>
    `;
    card.querySelector('.onb-theme-icon').appendChild(lucideIcon(t.icon, { size: 22, strokeWidth: 1.8 }));
    card.addEventListener('click', async () => {
      answers.theme = t.id === 'auto' ? null : t.id;
      if (t.id === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        answers.theme = prefersDark ? 'agzos-dark' : 'agzos-light';
      }
      document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${answers.theme}`;
      const mod = await import('./editor.js');
      mod.applyTheme(answers.theme);
      grid.querySelectorAll('.onb-theme-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
    grid.appendChild(card);
  });
  host.appendChild(grid);
}

function renderMigrateStep(host) {
  const editors = [
    { id: 'vscode', name: 'VS Code', desc: 'settings.json, keybindings, snippets, extensões', icon: 'code' },
    { id: 'cursor', name: 'Cursor', desc: 'Configurações + histórico IA', icon: 'mouse-pointer-2' },
    { id: 'sublime', name: 'Sublime Text', desc: 'Packages, settings, keybindings', icon: 'text-cursor-input' },
    { id: 'atom', name: 'Atom (descontinuado)', desc: 'Configurações, packages, keybindings', icon: 'atom' },
    { id: 'none', name: 'Não migrar', desc: 'Vou começar do zero', icon: 'skip-forward' },
  ];
  const grid = document.createElement('div');
  grid.className = 'onb-migrate-grid';
  editors.forEach((e) => {
    const card = document.createElement('button');
    card.className = `onb-migrate-card ${answers.migrateFrom === e.id ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="onb-migrate-icon"></div>
      <div class="onb-migrate-name">${e.name}</div>
      <div class="onb-migrate-desc">${e.desc}</div>
    `;
    card.querySelector('.onb-migrate-icon').appendChild(lucideIcon(e.icon, { size: 22, strokeWidth: 1.8 }));
    card.addEventListener('click', async () => {
      answers.migrateFrom = e.id;
      grid.querySelectorAll('.onb-migrate-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      if (e.id !== 'none') {
        // Stub: a integração real é Fase 1 do roadmap
        const mod = await import('./migrate.js');
        const ok = await mod.migrateFrom(e.id);
        if (ok) toast(`Configurações de ${e.name} importadas (stub).`, 'success');
        else toast(`Importação de ${e.name} será implementada em breve.`, 'info');
      }
    });
    grid.appendChild(card);
  });
  host.appendChild(grid);
  const note = document.createElement('p');
  note.className = 'onb-note';
  note.innerHTML = `<strong>${iconsInline('info')} Nota:</strong> a importação completa das <em>extensões</em> será integrada na próxima release com Open VSX como fonte.`;
  note.querySelector('strong').prepend(lucideIcon('info', { size: 14, strokeWidth: 2 }));
  host.appendChild(note);
}

function renderGithubStep(host) {
  const gh = document.createElement('div');
  gh.className = 'onb-github';
  gh.innerHTML = `
    <div class="onb-github-hero"></div>
    <h3>Conecte sua conta GitHub</h3>
    <p>O Agzos Code suporta múltiplas contas. Você pode adicionar mais depois em Settings → Git.</p>
    <div class="onb-github-actions">
      <button class="onb-github-primary">
        <span class="onb-github-icon"></span>
        Entrar com GitHub
      </button>
      <button class="onb-github-secondary">
        <span class="onb-key-icon"></span>
        Usar Personal Access Token
      </button>
      <button class="onb-github-tertiary">Pular este passo</button>
    </div>
    <div class="onb-github-form" hidden>
      <label>Personal Access Token</label>
      <input type="password" placeholder="ghp_…" />
      <small>Crie um em github.com/settings/tokens (escopo: repo, read:user)</small>
    </div>
  `;
  gh.querySelector('.onb-github-hero').appendChild(lucideIcon('github', { size: 48, strokeWidth: 1.5 }));
  gh.querySelector('.onb-github-icon').appendChild(lucideIcon('github', { size: 18, strokeWidth: 2 }));
  gh.querySelector('.onb-key-icon').appendChild(lucideIcon('key-round', { size: 18, strokeWidth: 2 }));

  const form = gh.querySelector('.onb-github-form');
  gh.querySelector('.onb-github-secondary').addEventListener('click', () => {
    form.hidden = !form.hidden;
  });
  gh.querySelector('.onb-github-primary').addEventListener('click', () => {
    // OAuth flow stub — implementação real é Fase 1
    toast('OAuth GitHub será implementado na próxima release. Use PAT por enquanto.', 'info', 4000);
  });
  gh.querySelector('.onb-github-tertiary').addEventListener('click', () => {
    answers.github = null;
    goNext();
  });
  form.querySelector('input').addEventListener('change', async (e) => {
    const token = e.target.value.trim();
    if (!token) return;
    e.target.value = '';
    try {
      await window.agzos.secrets.set('github.onboarding', token);
      answers.github = { type: 'pat' };
      toast('Token salvo no cofre do sistema. Você pode adicionar mais contas depois.', 'success');
    } catch (err) {
      toast(`Erro ao salvar o token: ${err.message}`, 'error', 5000);
    }
  });
  host.appendChild(gh);
}

function renderLayoutStep(host) {
  const layouts = [
    { id: 'standard', name: 'Padrão', desc: 'Sidebar à esquerda, terminal embaixo', icon: 'layout' },
    { id: 'sidebar-right', name: 'Sidebar à direita', desc: 'Mais espaço pro editor', icon: 'panel-right' },
    { id: 'terminal-right', name: 'Terminal à direita', desc: 'Linha vertical, estilo Vim', icon: 'panel-right-open' },
    { id: 'zen', name: 'Zen', desc: 'Mínimo: só o editor', icon: 'focus' },
  ];
  const densities = [
    { id: 'compact', name: 'Compacto', desc: 'Mais conteúdo na tela' },
    { id: 'comfortable', name: 'Confortável', desc: 'Equilíbrio (recomendado)' },
    { id: 'spacious', name: 'Espaçoso', desc: 'Mais respiro' },
  ];

  const grid = document.createElement('div');
  grid.className = 'onb-layout-grid';
  layouts.forEach((l) => {
    const card = document.createElement('button');
    card.className = `onb-layout-card ${answers.layout === l.id ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="onb-layout-icon"></div>
      <div class="onb-layout-name">${l.name}</div>
      <div class="onb-layout-desc">${l.desc}</div>
    `;
    card.querySelector('.onb-layout-icon').appendChild(lucideIcon(l.icon, { size: 22, strokeWidth: 1.8 }));
    card.addEventListener('click', () => {
      answers.layout = l.id;
      grid.querySelectorAll('.onb-layout-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
    grid.appendChild(card);
  });
  host.appendChild(grid);

  // Density
  const densityHost = document.createElement('div');
  densityHost.className = 'onb-density';
  densityHost.innerHTML = `<label>Densidade da interface</label><div class="onb-density-row"></div>`;
  const row = densityHost.querySelector('.onb-density-row');
  densities.forEach((d) => {
    const btn = document.createElement('button');
    btn.className = `onb-density-btn ${answers.density === d.id ? 'selected' : ''}`;
    btn.innerHTML = `<strong>${d.name}</strong><small>${d.desc}</small>`;
    btn.addEventListener('click', () => {
      answers.density = d.id;
      row.querySelectorAll('.onb-density-btn').forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
    });
    row.appendChild(btn);
  });
  host.appendChild(densityHost);
}

function renderDoneStep(host) {
  const wrap = document.createElement('div');
  wrap.className = 'onb-done';
  const shortcuts = [
    { key: 'Ctrl+P', desc: 'Buscar arquivo' },
    { key: 'Ctrl+Shift+P', desc: 'Command Palette' },
    { key: 'Ctrl+`', desc: 'Alternar Terminal' },
    { key: 'Ctrl+B', desc: 'Alternar Sidebar' },
    { key: 'Ctrl+S', desc: 'Salvar' },
    { key: 'Ctrl+Shift+F', desc: 'Buscar em arquivos' },
  ];
  wrap.innerHTML = `
    <div class="onb-done-hero"></div>
    <h3>Atalhos essenciais</h3>
    <div class="onb-shortcut-list"></div>
    <p class="onb-done-msg">A qualquer momento, reinicie o onboarding pelo menu <strong>Help → Onboarding</strong>.</p>
  `;
  wrap.querySelector('.onb-done-hero').appendChild(lucideIcon('party-popper', { size: 56, strokeWidth: 1.5 }));
  const list = wrap.querySelector('.onb-shortcut-list');
  shortcuts.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'onb-shortcut';
    const kbd = document.createElement('kbd'); kbd.textContent = s.key;
    const desc = document.createElement('span'); desc.textContent = s.desc;
    row.appendChild(kbd);
    row.appendChild(desc);
    list.appendChild(row);
  });
  host.appendChild(wrap);
}

/* helpers */
function goNext() {
  currentStep++;
  const overlay = document.getElementById('onboarding-overlay');
  renderStep(overlay);
}
function iconsInline(name) {
  return ''; // usa prepend em vez disso
}
