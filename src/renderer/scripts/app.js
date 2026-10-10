/**
 * Agzos Code — Renderer entry point
 *
 * Importa todos os módulos, configura atalhos globais, carrega settings.
 */

import { toast } from './toast.js';
import { setupEditor, openFile, saveActive } from './editor.js';
import { setupCommandPalette, showCommandPalette, hideCommandPalette } from './command-palette.js';
import { setupAI } from './ai-chat.js';
import { setupSearch } from './search.js';
import { initTerminal, toggleTerminal, focusTerminal } from './terminal.js';
import { openWorkspace } from './file-tree.js';
import { lucideIcon } from './lucide.js';
import { perfLabel } from './labels.js';
import { showWelcome, hideWelcome, showEditorWelcome } from './welcome.js';
import { startOnboarding, exitOnboarding } from './onboarding.js';

const State = window.AgzosState;

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
async function boot() {
  // 1) Carrega settings
  const s = await window.agzos.settings.load();
  Object.assign(State.settings, s);

  // 2) Carrega app info
  const info = await window.agzos.app.info();
  State.appVersion = info.version;
  State.platform = info.platform;

  // 3) Inicializa Lucide sprite (com timeout — não bloqueia o boot se falhar)
  try {
    await Promise.race([
      lucideIcon.ready,
      new Promise((res) => setTimeout(res, 2000)),
    ]);
  } catch {}

  // 4) Decora todos os pontos com .icon-host usando data-icon
  hydrateLucideIcons();

  // 5) Setup Monaco
  try {
    await setupEditor();
  } catch (e) {
    toast(`Monaco não pôde ser carregado: ${e.message}`, 'error', 6000);
    return;
  }

  // 6) Aplica settings à UI
  applySettingsToUI();

  // 7) Setup command palette
  setupCommandPalette();

  // 8) Setup panels
  setupAI();
  setupSearch();

  // 9) Welcome do editor (estado vazio)
  showEditorWelcome();

  // 10) Topbar search
  document.getElementById('search').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (!q) return;
      await quickOpen(q);
    }
  });

  // 11) Botões topbar
  document.getElementById('btn-command-palette').addEventListener('click', showCommandPalette);
  document.getElementById('btn-toggle-terminal').addEventListener('click', toggleTerminal);
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-hidden');
    State.sidebarHidden = document.body.classList.contains('sidebar-hidden');
  });
  document.getElementById('btn-settings').addEventListener('click', () => switchSidebarView('settings'));

  // 12) Botões do header da sidebar
  document.getElementById('btn-open-folder').addEventListener('click', openFolderDialog);
  document.getElementById('btn-open-folder-2').addEventListener('click', openFolderDialog);
  document.getElementById('btn-new-file').addEventListener('click', newFileInRoot);
  document.getElementById('btn-new-folder').addEventListener('click', newFolderInRoot);
  document.getElementById('btn-close-bottom').addEventListener('click', () => {
    document.getElementById('bottom-panel').hidden = true;
    State.bottomHidden = true;
  });

  // 13) Activity bar
  document.querySelectorAll('.activity-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchSidebarView(btn.dataset.view));
  });

  // 14) Bottom tabs
  document.querySelectorAll('.bottom-tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.bottom-tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.bottom-pane').forEach((p) => p.classList.remove('active'));
      t.classList.add('active');
      document.getElementById(`pane-${t.dataset.tab}`).classList.add('active');
    });
  });

  // 15) Settings inputs
  bindSettingsInputs();

  // 16) Atalhos globais
  bindShortcuts();

  // 17) Menu nativo → renderer
  window.agzos.onMenu((channel) => {
    if (channel === 'menu:open-folder') openFolderDialog();
    else if (channel === 'menu:save') saveActive();
    else if (channel === 'menu:command-palette') showCommandPalette();
    else if (channel === 'menu:toggle-terminal') toggleTerminal();
    else if (channel === 'menu:toggle-sidebar') document.body.classList.toggle('sidebar-hidden');
  });

  // 18) Init terminal (lazy no primeiro toggle)
  let termInit = false;
  const observer = new MutationObserver(() => {
    const panel = document.getElementById('bottom-panel');
    if (!panel.hidden && !termInit) {
      termInit = true;
      initTerminal();
    }
  });
  observer.observe(document.getElementById('bottom-panel'), { attributes: true, attributeFilter: ['hidden'] });

  // 19) Expor para debug
  window.AgzosEditor = { openFile, saveActive };
  window.AgzosOnboarding = { start: startOnboarding, exit: exitOnboarding };

  // 20) Atalho no menu: Help → Onboarding
  setTimeout(() => {
    const btn = document.getElementById('btn-restart-onboarding');
    if (btn) btn.addEventListener('click', () => {
      State.onboardingForced = true;
      startOnboarding();
    });
  }, 100);

  // 21) Decide se mostra Welcome/Onboarding
  // - Se nunca viu welcome → welcome + onboarding
  // - Se viu welcome mas não completou onboarding → onboarding
  // - Se completou → só o editor welcome normal
  if (!State.settings.welcomeSeen) {
    setTimeout(() => showWelcome(), 400);
  } else if (!State.settings.onboardingCompleted && !State.settings.onboardingSkipped) {
    setTimeout(() => startOnboarding(), 400);
  }

  console.log(`[Agzos Code] v${info.version} • Electron ${info.electron} • ${info.platform}/${info.arch}`);
  updateStatusAI();
  toast('Agzos Code carregado.', 'success', 1500);
}

/* --------------------------------------------------------------------------
   Lucide: percorre .icon-host[data-icon] e injeta SVG
   -------------------------------------------------------------------------- */
function hydrateLucideIcons() {
  const map = {
    'btn-toggle-sidebar': 'panel-left-close',
    'btn-toggle-terminal': 'square-terminal',
    'btn-command-palette': 'square-asterisk',
    'btn-settings': 'settings',
    'btn-new-file': 'file-plus',
    'btn-new-folder': 'folder-plus',
    'btn-open-folder': 'folder-open',
    'btn-close-bottom': 'x',
    'cmd-palette-input-icon': 'square-asterisk',
    'status-remote': 'git-branch',
    'status-perf': 'zap',
    'status-ai': 'sparkles',
  };
  // Activity bar
  const activityMap = {
    'explorer': 'folder-tree',
    'search': 'search',
    'git': 'git-branch',
    'extensions': 'puzzle',
    'ai': 'sparkles',
    'settings': 'settings',
  };
  document.querySelectorAll('.activity-btn').forEach((btn) => {
    const view = btn.dataset.view;
    if (view && activityMap[view]) {
      btn.appendChild(lucideIcon(activityMap[view], { size: 22, strokeWidth: 1.6 }));
    }
  });
  // IDs simples
  Object.entries(map).forEach(([id, name]) => {
    const el = document.getElementById(id);
    if (el) el.appendChild(lucideIcon(name, { size: id === 'status-remote' || id === 'status-perf' || id === 'status-ai' ? 12 : 16, strokeWidth: 1.8 }));
  });
}

/* --------------------------------------------------------------------------
   Settings
   -------------------------------------------------------------------------- */
function applySettingsToUI() {
  const s = State.settings;
  document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${s.theme}`;
  if (s.performanceMode === 'economy') document.body.classList.add('perf-economy');
  if (s.performanceMode === 'high') document.body.classList.add('perf-high');
  document.getElementById('setting-theme').value = s.theme;
  const iconThemeEl = document.getElementById('setting-icon-theme');
  if (iconThemeEl) iconThemeEl.value = s.iconTheme || 'lucide-color';
  document.getElementById('setting-perf').value = s.performanceMode;
  document.getElementById('setting-telemetry').checked = !!s.telemetry;
  document.getElementById('setting-fontsize').value = s.fontSize;
  document.getElementById('setting-ai-provider').value = s.aiProvider || '';
  refreshAiKeyPlaceholder();
  document.getElementById('status-perf').textContent = perfLabel(s.performanceMode);
}

function bindSettingsInputs() {
  document.getElementById('setting-theme').addEventListener('change', async (e) => {
    const theme = e.target.value;
    document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${theme}`;
    const mod = await import('./editor.js');
    mod.applyTheme(theme);
    // Re-renderiza welcome com novo logo
    if (!State.workspaceRoot || !State.activePath) showEditorWelcome();
  });
  const iconThemeSelect = document.getElementById('setting-icon-theme');
  if (iconThemeSelect) {
    iconThemeSelect.addEventListener('change', async (e) => {
      const theme = e.target.value;
      State.settings.iconTheme = theme;
      await window.agzos.settings.save(State.settings);
      const fileTreeMod = await import('./file-tree.js');
      fileTreeMod.refreshTree(true);
      const tabsMod = await import('./tabs.js');
      tabsMod.renderTabs();
      toast('Tema de ícones atualizado.', 'info', 1500);
    });
  }
  document.getElementById('setting-perf').addEventListener('change', async (e) => {
    const mode = e.target.value;
    State.settings.performanceMode = mode;
    document.body.classList.remove('perf-economy', 'perf-high');
    if (mode === 'economy') document.body.classList.add('perf-economy');
    if (mode === 'high') document.body.classList.add('perf-high');
    document.getElementById('status-perf').textContent = perfLabel(mode);
    await window.agzos.settings.save(State.settings);
  });
  document.getElementById('setting-telemetry').addEventListener('change', async (e) => {
    State.settings.telemetry = e.target.checked;
    await window.agzos.settings.save(State.settings);
    toast(`Telemetria ${e.target.checked ? 'ativada' : 'desativada'}.`, 'info');
  });
  document.getElementById('setting-fontsize').addEventListener('change', async (e) => {
    const size = parseInt(e.target.value, 10) || 14;
    const mod = await import('./editor.js');
    mod.applyFontSize(size);
  });
  document.getElementById('setting-ai-provider').addEventListener('change', async (e) => {
    State.settings.aiProvider = e.target.value || null;
    await window.agzos.settings.save(State.settings);
    updateStatusAI();
  });
  document.getElementById('setting-ai-key').addEventListener('change', async (e) => {
    const value = e.target.value.trim();
    e.target.value = '';
    try {
      if (value) {
        await window.agzos.secrets.set('ai.legacy', value);
        toast('Chave salva no cofre do sistema.', 'success');
      } else {
        await window.agzos.secrets.delete('ai.legacy');
      }
    } catch (err) {
      toast(`Erro ao salvar a chave: ${err.message}`, 'error', 5000);
    }
    refreshAiKeyPlaceholder();
  });
}

// Campo de chave nunca mostra o valor: placeholder indica se há chave salva.
async function refreshAiKeyPlaceholder() {
  const el = document.getElementById('setting-ai-key');
  let saved = false;
  try { saved = await window.agzos.secrets.has('ai.legacy'); } catch {}
  el.placeholder = saved ? '•••• salva no cofre' : 'sk-…';
}

function updateStatusAI() {
  const el = document.getElementById('status-ai');
  if (State.settings.aiProvider) {
    el.textContent = `IA: ${State.settings.aiProvider}`;
  } else {
    el.textContent = `IA: off`;
  }
}

/* --------------------------------------------------------------------------
   Atalhos
   -------------------------------------------------------------------------- */
function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (State.onboardingActive || State.welcomeOpen) {
      // Bloqueia atalhos durante onboarding/welcome
      if (e.key === 'Escape') {
        // permite ESC pra fechar welcome
        if (State.welcomeOpen && e.key === 'Escape') {
          // não fecha, mas absorve
          e.preventDefault();
        }
      }
      return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      showCommandPalette();
    } else if (ctrl && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      document.getElementById('search').focus();
    } else if (ctrl && e.key === '`') {
      e.preventDefault();
      toggleTerminal();
    } else if (ctrl && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      document.body.classList.toggle('sidebar-hidden');
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      switchSidebarView('explorer');
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      switchSidebarView('search');
      setTimeout(() => document.getElementById('search-text')?.focus(), 50);
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      switchSidebarView('git');
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      switchSidebarView('extensions');
    } else if (e.key === 'Escape') {
      hideCommandPalette();
    }
  });
}

function switchSidebarView(view) {
  const map = {
    explorer: { panel: 'file-tree', title: 'EXPLORER' },
    search:   { panel: 'panel-search', title: 'BUSCAR' },
    git:      { panel: 'panel-git', title: 'GIT' },
    extensions: { panel: 'panel-extensions', title: 'EXTENSÕES' },
    ai:       { panel: 'panel-ai', title: 'AGZOS IA' },
    settings: { panel: 'panel-settings', title: 'CONFIGURAÇÕES' },
  };
  const cfg = map[view];
  if (!cfg) return;
  document.getElementById('sidebar-title').textContent = cfg.title;
  ['file-tree','empty-explorer','panel-search','panel-git','panel-extensions','panel-ai','panel-settings'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  if (cfg.panel === 'file-tree') {
    if (State.workspaceRoot) {
      document.getElementById('file-tree').hidden = false;
    } else {
      document.getElementById('empty-explorer').hidden = false;
    }
  } else {
    document.getElementById(cfg.panel).hidden = false;
  }
  document.querySelectorAll('.activity-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

/* --------------------------------------------------------------------------
   Ações
   -------------------------------------------------------------------------- */
async function openFolderDialog() {
  const p = await window.agzos.dialog.openFolder();
  if (p) await openWorkspace(p);
}
async function newFileInRoot() {
  if (!State.workspaceRoot) { toast('Abra uma pasta primeiro.', 'error'); return; }
  const name = prompt('Nome do arquivo:');
  if (!name) return;
  const newPath = State.workspaceRoot + sep() + name;
  try {
    await window.agzos.fs.writeFile(newPath, '');
    const mod = await import('./file-tree.js');
    mod.refreshTree();
    await openFile(newPath);
  } catch (e) { toast(`Erro: ${e.message}`, 'error'); }
}
async function newFolderInRoot() {
  if (!State.workspaceRoot) { toast('Abra uma pasta primeiro.', 'error'); return; }
  const name = prompt('Nome da pasta:');
  if (!name) return;
  const newPath = State.workspaceRoot + sep() + name;
  try {
    await window.agzos.fs.mkdir(newPath);
    const mod = await import('./file-tree.js');
    mod.refreshTree();
  } catch (e) { toast(`Erro: ${e.message}`, 'error'); }
}
async function quickOpen(query) {
  if (!State.workspaceRoot) { toast('Abra uma pasta primeiro.', 'error'); return; }
  const lower = query.toLowerCase();
  const results = [];
  await walkForQuickOpen(State.workspaceRoot, lower, results);
  if (results.length === 0) { toast(`Nenhum arquivo combina com "${query}"`, 'info'); return; }
  await openFile(results[0]);
  toast(`Aberto: ${results[0].split(/[\\/]/).pop()}`, 'success', 1500);
}
async function walkForQuickOpen(dir, q, results, depth = 0) {
  if (depth > 6 || results.length > 1) return;
  let entries;
  try { entries = await window.agzos.fs.readDir(dir); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
    if (['node_modules','dist','out','build','.git'].includes(e.name)) continue;
    if (e.isDirectory) await walkForQuickOpen(e.path, q, results, depth + 1);
    else if (e.name.toLowerCase().includes(q)) results.push(e.path);
  }
}

function sep() { return navigator.userAgent.includes('Windows') ? '\\' : '/'; }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
