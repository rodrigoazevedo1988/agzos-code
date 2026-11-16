/**
 * Settings Modal — Redesenho no padrão Modal Separado estilo VS Code.
 *
 * Características:
 *  - Modal dedicado com backdrop (Ctrl+, / Cmd+,)
 *  - Busca instantânea de configurações (suporta @modified para ver apenas alterações)
 *  - Menu lateral por categorias:
 *      * Comumente Usados
 *      * Editor de Texto
 *      * Aparência & Temas
 *      * Terminal
 *      * Agzos IA
 *      * Git & GitHub
 *      * Atualizações (OTA)
 *      * Privacidade & Dados
 *  - Indicador visual em configurações alteradas do padrão + botão individual de reset
 *  - Alternância para editor JSON direto ({ } settings.json)
 */

import { toast } from './toast.js';
import { lucideIcon } from './lucide.js';
import { perfLabel } from './labels.js';
import { applyTheme, applyFontSize, applyEditorSettings } from './editor.js';

const State = window.AgzosState;

const DEFAULTS = {
  theme: 'agzos-dark',
  iconTheme: 'lucide-color',
  performanceMode: 'balanced',
  telemetry: false,
  fontSize: 14,
  editor: {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    wordWrapColumn: 80,
    lineNumbers: 'on',
    minimap: true,
    renderWhitespace: 'selection',
    bracketPairColorization: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    formatOnSave: false,
    autoSave: 'off',
    autoSaveDelay: 1000,
  },
  workbench: {
    sidebarPosition: 'left',
    statusBarVisible: true,
  },
  terminal: {
    fontSize: 13,
    scrollback: 1000,
  },
  update: {
    autoDownload: true,
    channel: 'stable',
  },
};

const CATEGORIES = [
  { id: 'commonlyUsed', label: 'Comumente Usados', icon: 'sliders' },
  { id: 'editor',       label: 'Editor de Texto',   icon: 'code' },
  { id: 'appearance',   label: 'Aparência & Temas', icon: 'palette' },
  { id: 'terminal',     label: 'Terminal',          icon: 'square-terminal' },
  { id: 'ai',           label: 'Agzos IA',          icon: 'sparkles' },
  { id: 'git',          label: 'Git & GitHub',      icon: 'git-branch' },
  { id: 'update',       label: 'Atualizações (OTA)',icon: 'refresh-cw' },
  { id: 'privacy',      label: 'Privacidade & Dados',icon: 'shield' },
];

let activeCategory = 'commonlyUsed';
let searchQuery = '';
let isJsonMode = false;
let otaProgressData = null;

function getNestedValue(obj, path) {
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr == null) return undefined;
    curr = curr[part];
  }
  return curr;
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (curr[p] == null || typeof curr[p] !== 'object') curr[p] = {};
    curr = curr[p];
  }
  curr[parts[parts.length - 1]] = value;
}

function isModified(key) {
  const currentVal = getNestedValue(State.settings, key);
  const defaultVal = getNestedValue(DEFAULTS, key);
  if (defaultVal === undefined) return false;
  return JSON.stringify(currentVal) !== JSON.stringify(defaultVal);
}

// Definição dos itens de configuração para exibição
const SETTINGS_DEF = [
  // Comumente Usados
  {
    key: 'theme',
    title: 'Workbench: Color Theme',
    desc: 'Define o tema visual geral da interface e do editor de código.',
    categories: ['commonlyUsed', 'appearance'],
    type: 'select',
    options: [
      { value: 'agzos-dark', label: 'Agzos Dark (Padrão Oficial)' },
      { value: 'agzos-light', label: 'Agzos Light' },
      { value: 'monokai', label: 'Monokai' },
    ],
    apply: (val) => {
      applyTheme(val);
      document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${val}`;
    },
  },
  {
    key: 'fontSize',
    title: 'Editor: Font Size',
    desc: 'Controls the font size in pixels for code editors.',
    categories: ['commonlyUsed', 'editor'],
    type: 'number',
    min: 10,
    max: 32,
    apply: (val) => applyFontSize(Number(val)),
  },
  {
    key: 'iconTheme',
    title: 'Workbench: Icon Theme',
    desc: 'Estilo dos ícones exibidos na árvore de arquivos e nas abas.',
    categories: ['commonlyUsed', 'appearance'],
    type: 'select',
    options: [
      { value: 'lucide-color', label: 'Lucide Moderno (Colorido)' },
      { value: 'lucide-minimal', label: 'Lucide Minimalista' },
      { value: 'badges', label: 'Badges Técnicos (Seti)' },
      { value: 'emoji', label: 'Emoji Clássico' },
    ],
    apply: async (val) => {
      State.settings.iconTheme = val;
      const fileTreeMod = await import('./file-tree.js');
      fileTreeMod.refreshTree(true);
      const tabsMod = await import('./tabs.js');
      tabsMod.renderTabs();
    },
  },
  {
    key: 'performanceMode',
    title: 'Workbench: Performance Mode',
    desc: 'Controla animações, consumo de CPU e suavizações de rolagem.',
    categories: ['commonlyUsed', 'appearance'],
    type: 'select',
    options: [
      { value: 'economy', label: 'Economia (desativa animações e transições)' },
      { value: 'balanced', label: 'Balanceado (recomendado)' },
      { value: 'high', label: 'Alta Performance' },
    ],
    apply: (val) => {
      document.body.classList.remove('perf-economy', 'perf-high');
      if (val === 'economy') document.body.classList.add('perf-economy');
      if (val === 'high') document.body.classList.add('perf-high');
      const statusEl = document.getElementById('status-perf');
      if (statusEl) statusEl.textContent = perfLabel(val);
    },
  },
  {
    key: 'editor.tabSize',
    title: 'Editor: Tab Size',
    desc: 'O número de espaços equivalentes a uma tabulação.',
    categories: ['commonlyUsed', 'editor'],
    type: 'number',
    min: 1,
    max: 8,
    apply: (val) => applyEditorSettings({ tabSize: Number(val) }),
  },
  {
    key: 'editor.wordWrap',
    title: 'Editor: Quebra de Linha (Word Wrap)',
    desc: 'Controla como as linhas longas devem quebrar na tela.',
    categories: ['commonlyUsed', 'editor'],
    type: 'select',
    options: [
      { value: 'off', label: 'Desativado (rolagem horizontal)' },
      { value: 'on', label: 'Ativado (quebra na largura da janela)' },
      { value: 'wordWrapColumn', label: 'Quebrar na coluna configurada' },
    ],
    apply: (val) => applyEditorSettings({ wordWrap: val }),
  },
  {
    key: 'editor.minimap',
    title: 'Editor: Minimapa',
    desc: 'Exibe a visualização em miniatura do código no lado direito.',
    categories: ['commonlyUsed', 'editor'],
    type: 'boolean',
    apply: (val) => applyEditorSettings({ minimap: val }),
  },

  // Editor de Texto
  {
    key: 'editor.fontFamily',
    title: 'Editor: Família da Fonte',
    desc: 'Fonte usada no editor (monospace).',
    categories: ['editor'],
    type: 'text',
    apply: (val) => applyEditorSettings({ fontFamily: val }),
  },
  {
    key: 'editor.insertSpaces',
    title: 'Editor: Inserir Espaços',
    desc: 'Insere espaços ao pressionar a tecla Tab.',
    categories: ['editor'],
    type: 'boolean',
    apply: (val) => applyEditorSettings({ insertSpaces: val }),
  },
  {
    key: 'editor.lineNumbers',
    title: 'Editor: Números de Linha',
    desc: 'Controla a exibição dos números de linha na margem esquerda.',
    categories: ['editor'],
    type: 'select',
    options: [
      { value: 'on', label: 'Ligado' },
      { value: 'off', label: 'Desligado' },
      { value: 'relative', label: 'Relativo' },
    ],
    apply: (val) => applyEditorSettings({ lineNumbers: val }),
  },
  {
    key: 'editor.renderWhitespace',
    title: 'Editor: Exibir Caracteres em Branco',
    desc: 'Define como espaços e tabulações são renderizados.',
    categories: ['editor'],
    type: 'select',
    options: [
      { value: 'none', label: 'Nenhum' },
      { value: 'boundary', label: 'Apenas entre palavras' },
      { value: 'selection', label: 'Apenas no texto selecionado' },
      { value: 'all', label: 'Sempre' },
    ],
    apply: (val) => applyEditorSettings({ renderWhitespace: val }),
  },
  {
    key: 'editor.bracketPairColorization',
    title: 'Editor: Colorização de Pares de Colchetes',
    desc: 'Coloriza pares correspondentes de colchetes e chaves com cores distintas.',
    categories: ['editor'],
    type: 'boolean',
    apply: (val) => applyEditorSettings({ bracketPairColorization: val }),
  },
  {
    key: 'editor.formatOnSave',
    title: 'Editor: Formatar ao Salvar',
    desc: 'Formata o arquivo automaticamente antes de salvar no disco.',
    categories: ['editor'],
    type: 'boolean',
    apply: () => {},
  },
  {
    key: 'editor.autoSave',
    title: 'Editor: Salvamento Automático (Auto Save)',
    desc: 'Salva arquivos modificados automaticamente sem precisar de Ctrl+S.',
    categories: ['editor'],
    type: 'select',
    options: [
      { value: 'off', label: 'Desativado (salvar com Ctrl+S)' },
      { value: 'afterDelay', label: 'Após atraso configurado' },
      { value: 'onFocusChange', label: 'Quando o editor perder o foco' },
    ],
    apply: () => {},
  },
  {
    key: 'editor.autoSaveDelay',
    title: 'Editor: Atraso do Auto Save (ms)',
    desc: 'Tempo em milissegundos para salvar o arquivo após parar de digitar.',
    categories: ['editor'],
    type: 'number',
    min: 200,
    max: 10000,
    apply: () => {},
  },

  // Terminal
  {
    key: 'terminal.fontSize',
    title: 'Terminal: Tamanho da Fonte',
    desc: 'Tamanho da fonte em pixels para o terminal integrado.',
    categories: ['terminal'],
    type: 'number',
    min: 10,
    max: 24,
    apply: () => {},
  },
  {
    key: 'terminal.scrollback',
    title: 'Terminal: Linhas de Histórico (Scrollback)',
    desc: 'Quantidade máxima de linhas mantidas no buffer do terminal.',
    categories: ['terminal'],
    type: 'number',
    min: 100,
    max: 10000,
    apply: () => {},
  },

  // Atualizações (OTA)
  {
    key: 'update.autoDownload',
    title: 'Atualizações: Download Automático',
    desc: 'Baixar atualizações automaticamente em segundo plano quando disponíveis.',
    categories: ['update'],
    type: 'boolean',
    apply: () => {},
  },
  {
    key: 'update.channel',
    title: 'Atualizações: Canal de Atualização',
    desc: 'Escolha se deseja receber versões estáveis ou prévias antecipadas.',
    categories: ['update'],
    type: 'select',
    options: [
      { value: 'stable', label: 'Estável (Recomendado)' },
      { value: 'beta', label: 'Beta (Novidades antecipadas)' },
    ],
    apply: () => {},
  },
];

export function setupSettingsModal() {
  let overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'settings-modal-overlay';
    overlay.className = 'overlay settings-overlay';
    overlay.hidden = true;
    document.body.appendChild(overlay);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettingsModal();
  });

  window.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    if (ctrl && e.key === ',') {
      e.preventDefault();
      e.stopPropagation();
      if (!overlay.hidden) closeSettingsModal();
      else openSettingsModal();
    } else if (e.key === 'Escape' && !overlay.hidden) {
      e.preventDefault();
      closeSettingsModal();
    }
  }, true);
}

export function openSettingsModal(category = 'commonlyUsed') {
  const overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) return;
  activeCategory = category;
  searchQuery = '';
  isJsonMode = false;
  renderModal();
  overlay.hidden = false;
  overlay.classList.add('active');
  setTimeout(() => {
    const searchInput = document.getElementById('settings-search-input');
    if (searchInput) searchInput.focus();
  }, 40);
}

export function closeSettingsModal() {
  const overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  overlay.hidden = true;
}

export function isSettingsModalOpen() {
  const overlay = document.getElementById('settings-modal-overlay');
  return overlay && !overlay.hidden;
}

export function updateOTAProgress(progress) {
  otaProgressData = progress;
  if (isSettingsModalOpen() && activeCategory === 'update') {
    renderContent();
  }
}

function renderModal() {
  const overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) return;

  overlay.innerHTML = `
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div class="settings-header">
        <div class="settings-header-top">
          <div class="settings-header-left">
            <span class="settings-header-icon">${lucideIcon('settings', { size: 18 }).outerHTML}</span>
            <h2 id="settings-modal-title">Configurações</h2>
          </div>
          <div class="settings-search-box">
            <span class="settings-search-icon">${lucideIcon('search', { size: 14 }).outerHTML}</span>
            <input type="text" id="settings-search-input" placeholder="Search settings (ex: font, tabSize, @modified)…" value="${escapeHtml(searchQuery)}" autocomplete="off" spellcheck="false" />
            ${searchQuery ? `<button id="settings-clear-search" class="icon-btn" title="Limpar busca">✕</button>` : ''}
          </div>
          <div class="settings-header-actions">
            <button id="btn-toggle-settings-json" class="settings-tool-btn" title="${isJsonMode ? 'Visualizar Interface (UI)' : 'Abrir settings.json'}">
              ${isJsonMode ? lucideIcon('sliders', { size: 15 }).outerHTML + ' <span>Interface</span>' : '<span>{ } JSON</span>'}
            </button>
            <button id="btn-close-settings-modal" class="settings-close-btn" title="Fechar (Esc)">✕</button>
          </div>
        </div>
        <div class="settings-header-subtabs">
          <button class="settings-subtab active" data-tab="user">Usuário (User)</button>
          <button class="settings-subtab" data-tab="workspace">Espaço de Trabalho (Workspace)</button>
        </div>
      </div>
      <div class="settings-body">
        <aside class="settings-sidebar" id="settings-sidebar">
          <ul class="settings-categories" role="tablist">
            ${CATEGORIES.map((cat) => `
              <li class="settings-category-item ${activeCategory === cat.id && !searchQuery ? 'active' : ''}" data-cat="${cat.id}">
                <span class="settings-cat-chevron">›</span>
                <span>${cat.label}</span>
              </li>
            `).join('')}
          </ul>
        </aside>
        <section class="settings-main" id="settings-main">
          ${renderContentHtml()}
        </section>
      </div>
    </div>
  `;

  bindModalEvents();
}

function renderContent() {
  const main = document.getElementById('settings-main');
  if (main) main.innerHTML = renderContentHtml();
  bindContentEvents();
}

function renderContentHtml() {
  if (isJsonMode) {
    return `
      <div class="settings-json-view">
        <div class="settings-json-banner">
          <span>Edite as preferências diretamente em formato JSON. Elas serão salvas em <code>settings.json</code>.</span>
          <button class="primary-btn" id="btn-save-settings-json">Salvar Alterações</button>
        </div>
        <textarea id="settings-json-textarea" spellcheck="false">${escapeHtml(JSON.stringify(State.settings, null, 2))}</textarea>
      </div>
    `;
  }

  // Filtragem
  let items = SETTINGS_DEF;
  const isSearchModified = searchQuery.trim().toLowerCase() === '@modified';
  const query = searchQuery.trim().toLowerCase();

  if (isSearchModified) {
    items = items.filter((item) => isModified(item.key));
  } else if (query) {
    items = items.filter((item) =>
      item.title.toLowerCase().includes(query) ||
      item.desc.toLowerCase().includes(query) ||
      item.key.toLowerCase().includes(query)
    );
  } else {
    items = items.filter((item) => item.categories.includes(activeCategory));
  }

  // Seções especiais extras para IA, Git, OTA e Privacidade quando na aba específica ou sem busca restrita
  let extraHtml = '';
  if (!query && activeCategory === 'ai') {
    extraHtml = renderAIExtraHtml();
  } else if (!query && activeCategory === 'git') {
    extraHtml = renderGitExtraHtml();
  } else if (!query && activeCategory === 'update') {
    extraHtml = renderUpdateExtraHtml();
  } else if (!query && activeCategory === 'privacy') {
    extraHtml = renderPrivacyExtraHtml();
  }

  if (items.length === 0 && !extraHtml) {
    return `
      <div class="settings-empty">
        <p>Nenhuma configuração encontrada para "<strong>${escapeHtml(searchQuery)}</strong>".</p>
        ${query ? `<button class="secondary-btn" id="btn-reset-search">Limpar busca</button>` : ''}
      </div>
    `;
  }

  const activeCatObj = CATEGORIES.find((c) => c.id === activeCategory);
  const categoryHeading = query
    ? (isSearchModified ? 'Configurações Modificadas (@modified)' : `Resultados da busca por "${escapeHtml(searchQuery)}"`)
    : (activeCatObj?.label || 'Configurações');

  return `
    <div class="settings-category-header">
      <h2 class="settings-category-title">${categoryHeading}</h2>
    </div>
    <div class="settings-items-list">
      ${items.map(renderSettingItemHtml).join('')}
      ${extraHtml}
    </div>
  `;
}

function renderSettingItemHtml(item) {
  const currentVal = getNestedValue(State.settings, item.key);
  const modified = isModified(item.key);

  let controlHtml = '';
  if (item.type === 'select') {
    controlHtml = `
      <select class="settings-control-select" data-key="${item.key}">
        ${item.options.map((opt) => `
          <option value="${opt.value}" ${String(currentVal) === String(opt.value) ? 'selected' : ''}>${opt.label}</option>
        `).join('')}
      </select>
    `;
  } else if (item.type === 'number') {
    controlHtml = `
      <input type="number" class="settings-control-input" data-key="${item.key}" min="${item.min || 0}" max="${item.max || 9999}" value="${currentVal ?? ''}" />
    `;
  } else if (item.type === 'text') {
    controlHtml = `
      <input type="text" class="settings-control-input" data-key="${item.key}" value="${escapeHtml(String(currentVal || ''))}" />
    `;
  } else if (item.type === 'boolean') {
    controlHtml = `
      <label class="settings-checkbox-wrap">
        <input type="checkbox" class="settings-control-checkbox" data-key="${item.key}" ${currentVal ? 'checked' : ''} />
        <span class="settings-checkbox-label-text">${item.desc}</span>
      </label>
    `;
  }

  return `
    <div class="setting-item-row ${modified ? 'modified' : ''}" data-key="${item.key}">
      <div class="setting-item-info">
        <div class="setting-item-title-row">
          <strong class="setting-item-title">${item.title}</strong>
          <span class="setting-item-key">(${item.key})</span>
          ${modified ? `<button class="setting-reset-btn" data-reset-key="${item.key}" title="Restaurar valor padrão">↺ Restaurar padrão</button>` : ''}
        </div>
        ${item.type !== 'boolean' ? `<p class="setting-item-desc">${item.desc}</p>` : ''}
      </div>
      <div class="setting-item-control">
        ${controlHtml}
      </div>
    </div>
  `;
}

function renderAIExtraHtml() {
  const ai = State.settings.ai || {};
  const profiles = ai.profiles || [];
  const activeProfile = profiles.find((p) => p.id === ai.activeProfileId);

  return `
    <div class="settings-section-card">
      <h3 class="settings-section-title">Perfis de IA Configurados</h3>
      <p class="setting-item-desc">Gerencie suas conexões com provedores de inteligência artificial (OpenAI, Anthropic, Groq, Ollama, etc.). Suas chaves ficam protegidas no cofre do SO.</p>
      <div class="ai-profiles-overview">
        <div class="ai-profile-current">
          <span>Perfil Ativo: <strong>${activeProfile ? (activeProfile.model || activeProfile.label) : 'Nenhum'}</strong></span>
        </div>
        <div class="ai-profiles-actions">
          <button class="primary-btn" id="btn-settings-open-ai-wizard">+ Configurar Novo Provider</button>
        </div>
      </div>
    </div>
  `;
}

function renderGitExtraHtml() {
  const gh = State.settings.github || { accounts: [] };
  const accounts = gh.accounts || [];

  return `
    <div class="settings-section-card">
      <h3 class="settings-section-title">Contas GitHub</h3>
      <p class="setting-item-desc">Associe contas pessoais ou de organizações para commits e operações Git integradas.</p>
      <div class="git-accounts-list">
        ${accounts.length === 0 ? `<p class="hint">Nenhuma conta GitHub conectada ainda.</p>` : `
          <ul>
            ${accounts.map((a) => `<li><strong>@${escapeHtml(a.login || a.name || 'Conta')}</strong></li>`).join('')}
          </ul>
        `}
      </div>
    </div>
  `;
}

function renderUpdateExtraHtml() {
  const percent = otaProgressData ? Math.round(otaProgressData.percent) : null;

  return `
    <div class="settings-section-card">
      <h3 class="settings-section-title">Atualização Over-The-Air (OTA Multiplataforma)</h3>
      <p class="setting-item-desc">O Agzos Code consulta e baixa atualizações diretamente de <code>https://code.rsolutionsbr.com/release/</code>.</p>

      <div class="ota-status-panel">
        <div class="ota-info-line">
          <span>Versão instalada: <strong>v${escapeHtml(State.appVersion || '0.3.0')}</strong></span>
          <span>Plataforma: <strong>${escapeHtml(State.platform || 'linux')}</strong></span>
        </div>

        ${percent != null && percent < 100 ? `
          <div class="ota-progress-container">
            <div class="ota-progress-bar" style="width: ${percent}%"></div>
            <span class="ota-progress-text">Baixando atualização: ${percent}%</span>
          </div>
        ` : ''}

        <div class="ota-actions-row">
          <button class="primary-btn" id="btn-check-updates-now">
            ${lucideIcon('refresh-cw', { size: 14 }).outerHTML} Verificar Atualizações Agora
          </button>
          <button class="secondary-btn" id="btn-import-vscode-now">
            ${lucideIcon('download', { size: 14 }).outerHTML} Importar Configurações do VS Code
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPrivacyExtraHtml() {
  return `
    <div class="settings-section-card">
      <h3 class="settings-section-title">Privacidade e Armazenamento Local</h3>
      <p class="setting-item-desc">
        O Agzos Code respeita sua privacidade: não coletamos nem enviamos telemetria em segundo plano.
        Suas chaves de API de IA e tokens do GitHub permanecem criptografados no cofre nativo do seu sistema operacional.
      </p>
      <div class="settings-danger-zone">
        <h4>Zona de Manutenção</h4>
        <div class="danger-zone-actions">
          <button class="secondary-btn" id="btn-restart-onboarding-modal">Refazer Onboarding Inicial</button>
          <button class="danger-btn" id="btn-reset-all-settings">Restaurar Todas as Configurações de Fábrica</button>
        </div>
      </div>
    </div>
  `;
}

function bindModalEvents() {
  // Busca
  const searchInput = document.getElementById('settings-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderContent();
      const clearBtn = document.getElementById('settings-clear-search');
      if (clearBtn) clearBtn.hidden = !searchQuery;
    });
  }

  const clearBtn = document.getElementById('settings-clear-search');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      renderContent();
    });
  }

  // Alternar JSON
  const btnToggleJson = document.getElementById('btn-toggle-settings-json');
  if (btnToggleJson) {
    btnToggleJson.addEventListener('click', () => {
      isJsonMode = !isJsonMode;
      renderModal();
    });
  }

  // Fechar
  const btnClose = document.getElementById('btn-close-settings-modal');
  if (btnClose) btnClose.addEventListener('click', closeSettingsModal);

  // Categorias da Sidebar
  document.querySelectorAll('.settings-category-item').forEach((item) => {
    item.addEventListener('click', () => {
      activeCategory = item.dataset.cat;
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      document.querySelectorAll('.settings-category-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      renderContent();
    });
  });

  bindContentEvents();
}

function bindContentEvents() {
  // Limpar busca no botão vazio
  const resetSearch = document.getElementById('btn-reset-search');
  if (resetSearch) {
    resetSearch.addEventListener('click', () => {
      searchQuery = '';
      const input = document.getElementById('settings-search-input');
      if (input) input.value = '';
      renderContent();
    });
  }

  // Mudanças nos controles
  document.querySelectorAll('.settings-control-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const key = e.target.dataset.key;
      const val = e.target.value;
      await updateSetting(key, val);
    });
  });

  document.querySelectorAll('.settings-control-input').forEach((inp) => {
    inp.addEventListener('change', async (e) => {
      const key = e.target.dataset.key;
      let val = e.target.value;
      if (inp.type === 'number') val = Number(val);
      await updateSetting(key, val);
    });
  });

  document.querySelectorAll('.settings-switch input').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const key = e.target.dataset.key;
      await updateSetting(key, e.target.checked);
    });
  });

  // Botões de reset individual
  document.querySelectorAll('.setting-reset-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const key = e.target.dataset.resetKey;
      const defVal = getNestedValue(DEFAULTS, key);
      await updateSetting(key, defVal);
    });
  });

  // Ações especiais
  const btnAIWizard = document.getElementById('btn-settings-open-ai-wizard');
  if (btnAIWizard) {
    btnAIWizard.addEventListener('click', async () => {
      closeSettingsModal();
      const { openAIWizard } = await import('./ai-wizard.js');
      await openAIWizard({ profileId: State.settings.ai?.activeProfileId });
    });
  }

  const btnCheckUpdates = document.getElementById('btn-check-updates-now');
  if (btnCheckUpdates) {
    btnCheckUpdates.addEventListener('click', async () => {
      btnCheckUpdates.disabled = true;
      btnCheckUpdates.textContent = 'Verificando atualizações…';
      try {
        await window.agzos.update.check();
      } catch (err) {
        toast(`Falha ao verificar: ${err.message}`, 'error');
      } finally {
        setTimeout(() => {
          btnCheckUpdates.disabled = false;
          btnCheckUpdates.innerHTML = `${lucideIcon('refresh-cw', { size: 14 }).outerHTML} Verificar Atualizações Agora`;
        }, 1500);
      }
    });
  }

  const btnImportVSCode = document.getElementById('btn-import-vscode-now');
  if (btnImportVSCode) {
    btnImportVSCode.addEventListener('click', async () => {
      try {
        const res = await window.agzos.settings.importVSCode?.();
        if (res && res.imported && res.imported.length > 0) {
          toast(`Configurações importadas com sucesso: ${res.imported.join(', ')}`, 'success', 3500);
          const s = await window.agzos.settings.load();
          Object.assign(State.settings, s);
          renderContent();
        } else {
          toast('Nenhuma configuração do VS Code foi encontrada neste sistema.', 'info', 3000);
        }
      } catch (e) {
        toast(`Erro na importação: ${e.message}`, 'error');
      }
    });
  }

  const btnRestartOnboarding = document.getElementById('btn-restart-onboarding-modal');
  if (btnRestartOnboarding) {
    btnRestartOnboarding.addEventListener('click', async () => {
      closeSettingsModal();
      const { startOnboarding } = await import('./onboarding.js');
      State.onboardingForced = true;
      startOnboarding();
    });
  }

  const btnResetAll = document.getElementById('btn-reset-all-settings');
  if (btnResetAll) {
    btnResetAll.addEventListener('click', async () => {
      if (confirm('Tem certeza que deseja restaurar todas as configurações para o padrão original?')) {
        State.settings = structuredClone(DEFAULTS);
        await window.agzos.settings.save(State.settings);
        applyTheme(State.settings.theme);
        applyFontSize(State.settings.fontSize);
        applyEditorSettings(State.settings.editor);
        toast('Todas as configurações foram restauradas.', 'success', 2500);
        renderContent();
      }
    });
  }

  // Salvar JSON
  const btnSaveJson = document.getElementById('btn-save-settings-json');
  if (btnSaveJson) {
    btnSaveJson.addEventListener('click', async () => {
      const ta = document.getElementById('settings-json-textarea');
      if (!ta) return;
      try {
        const parsed = JSON.parse(ta.value);
        State.settings = parsed;
        await window.agzos.settings.save(State.settings);
        applyTheme(State.settings.theme || 'agzos-dark');
        applyFontSize(State.settings.fontSize || 14);
        applyEditorSettings(State.settings.editor || {});
        toast('settings.json salvo com sucesso!', 'success', 2000);
        isJsonMode = false;
        renderModal();
      } catch (e) {
        toast(`JSON inválido: ${e.message}`, 'error', 4000);
      }
    });
  }
}

async function updateSetting(key, val) {
  setNestedValue(State.settings, key, val);
  await window.agzos.settings.save(State.settings);

  // Aplica efeito imediato se houver definição
  const def = SETTINGS_DEF.find((d) => d.key === key);
  if (def && typeof def.apply === 'function') {
    try {
      def.apply(val);
    } catch (e) {
      console.warn(`[settings] erro ao aplicar ${key}:`, e);
    }
  }

  renderContent();
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
