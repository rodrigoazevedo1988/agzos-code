/**
 * Agzos Code — Renderer entry point
 *
 * Importa todos os módulos, configura atalhos globais, carrega settings.
 */

import { toast } from './toast.js';
import { setupEditor, openFile, saveActive, getActiveEditor, applyEditorSettings, openMarkdownPreview } from './editor.js';
import { setupMarkdownSide } from './viewers/markdown-side.js';
import { setupFileDrop } from './viewers/drop.js';
import { setupCommandPalette, showCommandPalette, showQuickOpen, hideCommandPalette, showShortcutsModal, invalidateQuickOpenCache, runCommand } from './command-palette.js';
import { setupMenuActions, applyStatusBarVisibility } from './menu-actions.js';
import { setupMenubar } from './menubar.js';
import { setupAI, sendToChat } from './ai-chat.js';
import { captureAITarget, setAITarget } from './ai-apply.js';
import { setupSearch } from './search.js';
import {
  initTerminal, setupTerminalPanel, toggleTerminal, selectBottomTab, setBottomPanelVisible, getActiveBottomTab,
  createTerminal, splitTerminal, focusNextTerminal,
} from './terminal.js';
import { setupAiDock } from './ai-dock.js';
import { openWorkspace, refreshTree, collapseAllFolders } from './file-tree.js';
import { setupGitPanel } from './git-panel.js';
import { setupModulesHub } from './modules-hub.js';
import { setupBroom } from './broom.js';
import { setupEnvVault } from './envvault.js';
import { setupSsh } from './ssh.js';
import { setupTree } from './mods/tree.js';
import { setupSnap } from './mods/snap.js';
import { setupLive } from './mods/live.js';
import { lucideIcon } from './lucide.js';
import { perfLabel } from './labels.js';
import { showWelcome, showEditorWelcome } from './welcome.js';
import { startOnboarding, exitOnboarding } from './onboarding.js';
import { setupSettingsModal, openSettingsModal, updateOTAProgress } from './settings-modal.js';
import { closeTab, closeAllTabs } from './editor.js';
import { createChord, matchShortcut, isEditableTarget, isMonacoTarget, shouldHandleInTarget } from './keymap.js';

const State = window.AgzosState;
let aiDock = null; // API do dock (ai-dock.js), definida no boot

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
async function boot() {
  // 1) Carrega settings
  const s = await window.agzos.settings.load();
  Object.assign(State.settings, s);
  // Outra janela salvou settings: atualiza a cópia local e reaplica tema/editor.
  window.agzos.settings.onChanged?.((next) => {
    const before = JSON.stringify(State.settings);
    Object.assign(State.settings, next);
    if (JSON.stringify(State.settings) === before) return;
    import('./settings-modal.js').then((m) => m.applySettingsLive()).catch((e) => console.warn('[settings] sync', e));
  });

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

  // Visualizadores: pré-visualização de Markdown ao lado e arquivos soltos do SO.
  setupMarkdownSide();
  setupFileDrop(openFile);

  // 6) Aplica settings à UI
  applySettingsToUI();

  // 7) Setup command palette + comandos da barra de menus
  setupCommandPalette();
  setupMenuActions();
  // Barra de menus in-app: Windows/Linux. macOS usa o menu nativo do sistema.
  try {
    setupMenubar({ visible: info.platform !== 'darwin' });
  } catch (e) {
    console.error('[Menu] setupMenubar falhou:', e);
  }

  // 8) Setup panels — o dock posiciona o #ai-panel antes de o chat renderizar nele
  aiDock = setupAiDock({ switchSidebarView, selectBottomTab, setBottomPanelVisible, getActiveBottomTab });
  try {
    setupAI();
  } catch (e) {
    // Falha do chat não pode derrubar o boot (editor, terminal, atalhos).
    console.error('[Agzos IA] setupAI falhou:', e);
  }
  setupSearch();
  try {
    setupGitPanel({ switchSidebarView });
  } catch (e) {
    console.error('[Git] setupGitPanel falhou:', e);
  }

  // 8b) Módulos nativos (hub + Vassoura + Cofre .env). Falha de um módulo não derruba o boot.
  try {
    setupModulesHub({ switchSidebarView });
  } catch (e) {
    console.error('[Módulos] setupModulesHub falhou:', e);
  }
  for (const [name, setup] of [['Vassoura', setupBroom], ['Cofre .env', setupEnvVault], ['SSH', setupSsh]]) {
    try {
      setup();
    } catch (e) {
      console.error(`[Módulos] ${name} falhou:`, e);
    }
  }

  // 8c) Módulos Agzos de ferramentas (1.2.0): Árvore, Snap e Ao Vivo.
  for (const [name, setup] of [['Agzos Árvore', setupTree], ['Agzos Snap', setupSnap], ['Agzos Ao Vivo', setupLive]]) {
    try {
      setup();
    } catch (e) {
      console.error(`[Módulos] ${name} falhou:`, e);
    }
  }

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
  document.getElementById('btn-refresh-explorer').addEventListener('click', () => { refreshTree(false); invalidateQuickOpenCache(); });
  document.getElementById('btn-collapse-folders').addEventListener('click', collapseAllFolders);
  document.getElementById('btn-open-folder-2').addEventListener('click', openFolderDialog);
  document.getElementById('btn-new-file').addEventListener('click', newFileInRoot);
  document.getElementById('btn-new-folder').addEventListener('click', newFolderInRoot);
  // Toolbar do painel (fechar, mover, maximizar, abas) e splitter: terminal.js
  setupTerminalPanel();

  // 13) Activity bar
  document.querySelectorAll('.activity-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Botão da IA: na sidebar abre a view; acoplada à direita/embaixo alterna o dock.
      if (btn.dataset.view === 'ai') {
        if (aiDock.getPosition() === 'left') aiDock.show({ focus: true });
        else aiDock.toggle({ focus: true });
        return;
      }
      switchSidebarView(btn.dataset.view);
    });
  });

  // 14) Bottom tabs: ligadas em setupTerminalPanel() (terminal.js)

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
    'btn-refresh-explorer': 'refresh-cw',
    'btn-collapse-folders': 'copy-minus',
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
    'modules': 'blocks',
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
  applyStatusBarVisibility();
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
// Ação do keymap → id do comando (quando diferem)
const MENU_SHORTCUT_COMMANDS = { 'window.fullscreen': 'window.toggleFullScreen' };
const NATIVE_MENU_ON_MAC = new Set(['window.new', 'file.openFolder', 'app.quit']);

const isMacPlatform = () => /mac/i.test(navigator.platform || '') || State.platform === 'darwin';
const shortcutChord = createChord();

function saveSettingsAndApplyEditor() {
  window.agzos.settings.save(State.settings);
  applyEditorSettings(State.settings);
}

function runEditorAction(e, actionId, { focus = true } = {}) {
  const editor = getActiveEditor();
  if (!editor) return;
  e.preventDefault();
  if (focus) editor.focus();
  editor.getAction(actionId)?.run();
}

function setFontSize(next, message) {
  State.settings.fontSize = next;
  saveSettingsAndApplyEditor();
  toast(message, 'info', 800);
}

function runChordAction(action) {
  if (action === 'shortcuts.show') showShortcutsModal();
  else if (action === 'tabs.closeAll') closeAllTabs();
}

function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (State.onboardingActive || State.welcomeOpen) {
      // Bloqueia atalhos durante onboarding/welcome; ESC no welcome é absorvido
      if (State.welcomeOpen && e.key === 'Escape') e.preventDefault();
      return;
    }

    // Terminal (xterm) e campos de texto fora do Monaco recebem as teclas;
    // só atalhos globais (GLOBAL_IN_EDITABLE) passam.
    const inEditable = isEditableTarget(e.target);
    const inMonaco = isMonacoTarget(e.target);

    // Chords Ctrl+K …: no Monaco, o próprio editor resolve (addCommand em
    // editor.js) para não conflitar com os chords nativos dele (Ctrl+K Ctrl+C…).
    if (!inEditable) {
      const chord = shortcutChord.feed(e);
      if (chord.handled) {
        if (chord.action === 'chord.start') {
          if (!inMonaco) e.preventDefault();
        } else if (chord.action && !inMonaco) {
          e.preventDefault();
          e.stopPropagation();
          runChordAction(chord.action);
        }
        return;
      }
    }

    const action = matchShortcut(e, { isMac: isMacPlatform() });
    if (!action) {
      if (e.key === 'Escape') hideCommandPalette();
      return;
    }
    // Ctrl+L / Ctrl+Shift+A valem também em inputs (inclusive na caixa do chat,
    // para fechar), mas nunca no xterm: lá Ctrl+L é o "clear" do shell.
    const aiAction = action === 'ai.sendSelection' || action === 'ai.focus';
    if (aiAction) {
      if (e.target?.closest?.('.xterm')) return;
    } else if (!shouldHandleInTarget(action, inEditable)) return;
    // Ctrl+PageUp/PageDown só trocam de terminal com foco no painel do terminal
    // (no editor/inputs seguem o comportamento nativo).
    if ((action === 'terminal.prev' || action === 'terminal.next') && !e.target?.closest?.('#pane-terminal')) return;

    switch (action) {
      case 'ai.focus':
        e.preventDefault(); e.stopPropagation();
        aiDock.show({ focus: true });
        break;
      case 'ai.sendSelection': {
        // Ctrl+L (padrão VS Code/Cursor, sobrepõe o "expandir seleção de linha" do Monaco):
        // com seleção no editor → envia ao chat; senão alterna o painel / foca a caixa.
        e.preventDefault(); e.stopPropagation();
        const editor = inMonaco ? getActiveEditor() : null;
        const selection = editor?.getSelection();
        const text = selection && !selection.isEmpty() ? editor.getModel()?.getValueInRange(selection) : '';
        if (text) {
          setAITarget(captureAITarget());
          aiDock.show();
          sendToChat(text, { includeSelection: true });
          aiDock.focusInput();
        } else {
          toggleAiPanel(e.target);
        }
        break;
      }
      case 'palette.commands':
        e.preventDefault();
        showCommandPalette();
        break;
      case 'markdown.previewSide':
        e.preventDefault(); e.stopPropagation();
        openMarkdownPreview(State.activePath, 'side');
        break;
      case 'palette.quickOpen':
        e.preventDefault();
        showQuickOpen();
        break;
      case 'tab.close':
        e.preventDefault();
        if (State.activePath) closeTab(State.activePath);
        break;
      case 'editor.find':
        runEditorAction(e, 'actions.find');
        break;
      case 'editor.replace':
        runEditorAction(e, 'editor.action.startFindReplaceAction');
        break;
      case 'editor.gotoLine':
        runEditorAction(e, 'editor.action.gotoLine');
        break;
      case 'editor.format':
        runEditorAction(e, 'editor.action.formatDocument', { focus: false });
        break;
      case 'editor.toggleWordWrap': {
        e.preventDefault();
        const curr = State.settings?.editor?.wordWrap || 'off';
        const next = curr === 'on' ? 'off' : 'on';
        State.settings.editor = State.settings.editor || {};
        State.settings.editor.wordWrap = next;
        saveSettingsAndApplyEditor();
        toast(`Quebra de linha: ${next.toUpperCase()}`, 'info', 1000);
        break;
      }
      case 'zoom.in': {
        e.preventDefault();
        const next = Math.min(32, (State.settings.fontSize || 14) + 1);
        setFontSize(next, `Fonte: ${next}px`);
        break;
      }
      case 'zoom.out': {
        e.preventDefault();
        const next = Math.max(8, (State.settings.fontSize || 14) - 1);
        setFontSize(next, `Fonte: ${next}px`);
        break;
      }
      case 'zoom.reset':
        e.preventDefault();
        setFontSize(14, 'Fonte resetada: 14px');
        break;
      case 'terminal.toggle':
        e.preventDefault();
        toggleTerminal();
        break;
      case 'terminal.new':
        e.preventDefault(); e.stopPropagation();
        createTerminal();
        break;
      case 'terminal.split':
        e.preventDefault(); e.stopPropagation();
        splitTerminal();
        break;
      case 'terminal.prev':
      case 'terminal.next':
        e.preventDefault(); e.stopPropagation();
        focusNextTerminal(action === 'terminal.next' ? 1 : -1);
        break;
      case 'sidebar.toggle':
        e.preventDefault();
        document.body.classList.toggle('sidebar-hidden');
        break;
      case 'view.explorer':
        e.preventDefault();
        switchSidebarView('explorer');
        break;
      case 'view.search':
        e.preventDefault();
        runCommand('search.findInFiles');
        break;
      case 'view.git':
        e.preventDefault();
        switchSidebarView('git');
        break;
      case 'view.modules':
        e.preventDefault();
        switchSidebarView('modules');
        break;
      // Atalhos da barra de menus (antes só no menu nativo): mesmo comando do menu/paleta
      case 'window.new':
      case 'file.newUntitled':
      case 'file.openFolder':
      case 'file.saveAs':
      case 'task.build':
      case 'window.devtools':
      case 'app.quit':
      case 'window.fullscreen':
        // macOS: o menu nativo já tem esses aceleradores (não abrir 2 janelas)
        if (isMacPlatform() && NATIVE_MENU_ON_MAC.has(action)) break;
        e.preventDefault(); e.stopPropagation();
        runCommand(MENU_SHORTCUT_COMMANDS[action] || action);
        break;
      // 'settings.open' é tratado em settings-modal.js (abre de forma idempotente)
      default:
        break;
    }
  }, true);
}

// Ctrl+L sem seleção: fechado → abre e foca; aberto com foco fora → foca;
// aberto com foco dentro do chat → fecha e devolve o foco ao editor.
function toggleAiPanel(target) {
  const inPanel = !!target?.closest?.('#ai-panel');
  if (!aiDock.isVisible()) {
    aiDock.show({ focus: true });
  } else if (!inPanel) {
    if (!aiDock.focusInput()) aiDock.hide();
  } else {
    aiDock.hide();
    getActiveEditor()?.focus();
  }
}

function switchSidebarView(view) {
  const map = {
    explorer: { panel: 'file-tree', title: 'EXPLORER' },
    search:   { panel: 'panel-search', title: 'BUSCAR' },
    git:      { panel: 'panel-git', title: 'GIT' },
    modules:  { panel: 'panel-modules', title: 'MÓDULOS AGZOS' },
    ai:       { panel: 'panel-ai', title: 'AGZOS IA' },
  };
  const cfg = map[view];
  if (!cfg) return;
  document.getElementById('sidebar-title').textContent = cfg.title;
  const explorerActions = document.getElementById('explorer-actions');
  if (explorerActions) explorerActions.hidden = view !== 'explorer';
  ['file-tree','empty-explorer','panel-search','panel-git','panel-modules','panel-ai'].forEach((id) => {
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
    invalidateQuickOpenCache();
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
    invalidateQuickOpenCache();
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
