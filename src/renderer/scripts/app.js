/**
 * Agzos Code — Renderer entry point
 *
 * Importa todos os módulos, configura atalhos globais, carrega settings.
 */

import { toast } from './toast.js';
import { setupEditor, openFile, saveActive, getActiveEditor, applyEditorSettings } from './editor.js';
import { setupCommandPalette, showCommandPalette, showQuickOpen, hideCommandPalette } from './command-palette.js';
import { setupAI, focusChat, sendToChat } from './ai-chat.js';
import { captureAITarget, setAITarget } from './ai-apply.js';
import { setupSearch } from './search.js';
import { initTerminal, toggleTerminal } from './terminal.js';
import { openWorkspace } from './file-tree.js';
import { lucideIcon } from './lucide.js';
import { perfLabel } from './labels.js';
import { showWelcome, showEditorWelcome } from './welcome.js';
import { startOnboarding, exitOnboarding } from './onboarding.js';
import { setupSettingsModal, openSettingsModal, updateOTAProgress } from './settings-modal.js';
import { closeTab } from './editor.js';

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

  // 10) Topbar search — clique ou foco abre o Quick Open
  const searchInput = document.getElementById('search');
  searchInput.addEventListener('click', () => showQuickOpen());
  searchInput.addEventListener('focus', () => showQuickOpen());

  // 11) Botões topbar e configurações
  setupSettingsModal();
  document.getElementById('btn-command-palette').addEventListener('click', showCommandPalette);
  document.getElementById('btn-toggle-terminal').addEventListener('click', toggleTerminal);
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-hidden');
    State.sidebarHidden = document.body.classList.contains('sidebar-hidden');
  });
  document.getElementById('btn-settings').addEventListener('click', () => openSettingsModal());
  const btnActSettings = document.getElementById('btn-activity-settings');
  if (btnActSettings) btnActSettings.addEventListener('click', () => openSettingsModal());

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
    else if (channel === 'menu:check-updates') window.agzos.update.check();
    else if (channel === 'menu:open-settings') openSettingsModal();
  });

  window.agzos.update.onNotice(async (notice) => {
    if (notice.type === 'progress') {
      updateOTAProgress(notice);
      return;
    }
    if (notice.type === 'ready') {
      const hasUnsaved = [...State.files.values()].some((file) => file.dirty);
      const warning = hasUnsaved ? '\n\nHá arquivos não salvos. Salve-os antes de continuar.' : '';
      if (window.confirm(`A versão ${notice.version || 'nova'} foi baixada. Reiniciar e instalar agora?${warning}`)) {
        if (hasUnsaved) return;
        await window.agzos.update.install();
      }
      return;
    }
    if (notice.type === 'manual-download') {
      toast(`Atualização ${notice.version || ''} disponível para download em code.rsolutionsbr.com.`, 'info', 7000);
      return;
    }
    if (notice.type === 'not-available') toast('Você já está usando a versão mais recente.', 'success');
    else if (notice.type === 'error') toast(`Falha ao verificar atualização: ${notice.message}`, 'error', 6000);
    else if (notice.type === 'available') toast(`Baixando atualização ${notice.version || ''}…`, 'info', 5000);
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
    'btn-activity-settings': 'settings',
    'btn-new-file': 'file-plus',
    'btn-new-folder': 'folder-plus',
    'btn-open-folder': 'folder-open',
    'btn-clear-terminal': 'trash-2',
    'btn-restart-terminal': 'rotate-ccw',
    'btn-pos-terminal': 'panel-right',
    'btn-maximize-bottom': 'maximize-2',
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
  const themeEl = document.getElementById('setting-theme');
  if (themeEl) themeEl.value = s.theme;
  const iconThemeEl = document.getElementById('setting-icon-theme');
  if (iconThemeEl) iconThemeEl.value = s.iconTheme || 'lucide-color';
  const perfEl = document.getElementById('setting-perf');
  if (perfEl) perfEl.value = s.performanceMode;
  const telEl = document.getElementById('setting-telemetry');
  if (telEl) telEl.checked = !!s.telemetry;
  const fsEl = document.getElementById('setting-fontsize');
  if (fsEl) fsEl.value = s.fontSize;
  const statusPerf = document.getElementById('status-perf');
  if (statusPerf) statusPerf.textContent = perfLabel(s.performanceMode);
}

function bindSettingsInputs() {
  const statusAi = document.getElementById('status-ai');
  if (statusAi) statusAi.addEventListener('click', openAISettings);
}

async function openAISettings() {
  const { openAIWizard } = await import('./ai-wizard.js');
  await openAIWizard({ profileId: State.settings.ai?.activeProfileId });
  updateStatusAI();
}

function updateStatusAI() {
  const ai = State.settings.ai;
  const profile = ai?.profiles?.find((item) => item.id === ai.activeProfileId);
  document.getElementById('status-ai').textContent = profile ? `IA: ${profile.model || profile.label}` : 'IA: off';
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
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault(); e.stopPropagation(); focusChat();
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault(); e.stopPropagation();
      const editor = getActiveEditor();
      const selection = editor?.getSelection();
      const text = selection && editor.getModel()?.getValueInRange(selection);
      if (text) { setAITarget(captureAITarget()); sendToChat(text, { includeSelection: true }); }
      focusChat();
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      showCommandPalette();
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      showQuickOpen();
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (State.activeFile) closeTab(State.activeFile);
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'f') {
      const editor = getActiveEditor();
      if (editor) {
        e.preventDefault();
        editor.focus();
        editor.getAction('actions.find')?.run();
      }
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'h') {
      const editor = getActiveEditor();
      if (editor) {
        e.preventDefault();
        editor.focus();
        editor.getAction('editor.action.startFindReplaceAction')?.run();
      }
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'g') {
      const editor = getActiveEditor();
      if (editor) {
        e.preventDefault();
        editor.focus();
        editor.getAction('editor.action.gotoLine')?.run();
      }
    } else if (e.altKey && !ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      const curr = State.settings?.editor?.wordWrap || 'off';
      const next = curr === 'on' ? 'off' : 'on';
      State.settings.editor = State.settings.editor || {};
      State.settings.editor.wordWrap = next;
      window.agzos.settings.save(State.settings);
      applyEditorSettings(State.settings);
      toast(`Quebra de linha: ${next.toUpperCase()}`, 'info', 1000);
    } else if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
      const editor = getActiveEditor();
      if (editor) {
        e.preventDefault();
        editor.getAction('editor.action.formatDocument')?.run();
      }
    } else if (ctrl && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      const next = Math.min(32, (State.settings.fontSize || 14) + 1);
      State.settings.fontSize = next;
      window.agzos.settings.save(State.settings);
      applyEditorSettings(State.settings);
      toast(`Fonte: ${next}px`, 'info', 800);
    } else if (ctrl && e.key === '-') {
      e.preventDefault();
      const next = Math.max(8, (State.settings.fontSize || 14) - 1);
      State.settings.fontSize = next;
      window.agzos.settings.save(State.settings);
      applyEditorSettings(State.settings);
      toast(`Fonte: ${next}px`, 'info', 800);
    } else if (ctrl && e.key === '0') {
      e.preventDefault();
      State.settings.fontSize = 14;
      window.agzos.settings.save(State.settings);
      applyEditorSettings(State.settings);
      toast('Fonte resetada: 14px', 'info', 800);
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
  }, true);
}

function switchSidebarView(view) {
  const map = {
    explorer: { panel: 'file-tree', title: 'EXPLORER' },
    search:   { panel: 'panel-search', title: 'BUSCAR' },
    git:      { panel: 'panel-git', title: 'GIT' },
    extensions: { panel: 'panel-extensions', title: 'EXTENSÕES' },
    ai:       { panel: 'panel-ai', title: 'AGZOS IA' },
  };
  const cfg = map[view];
  if (!cfg) return;
  document.getElementById('sidebar-title').textContent = cfg.title;
  ['file-tree','empty-explorer','panel-search','panel-git','panel-extensions','panel-ai'].forEach((id) => {
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

function sep() { return navigator.userAgent.includes('Windows') ? '\\' : '/'; }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
