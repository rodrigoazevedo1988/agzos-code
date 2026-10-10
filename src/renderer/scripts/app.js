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

const State = window.AgzosState;

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
async function boot() {
  // Carrega settings
  const s = await window.agzos.settings.load();
  Object.assign(State.settings, s);
  applySettingsToUI();

  // Setup Monaco (carrega vendor on demand)
  try {
    await setupEditor();
  } catch (e) {
    toast(`Monaco não pôde ser carregado: ${e.message}`, 'error', 6000);
    return;
  }

  // Setup command palette
  setupCommandPalette();

  // Setup AI
  setupAI();
  setupSearch();

  // Atalho Ctrl+P → busca rápida
  document.getElementById('search').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (!q) return;
      await quickOpen(q);
    }
  });

  // Botões topbar
  document.getElementById('btn-command-palette').addEventListener('click', showCommandPalette);
  document.getElementById('btn-toggle-terminal').addEventListener('click', toggleTerminal);
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-hidden');
    State.sidebarHidden = document.body.classList.contains('sidebar-hidden');
  });
  document.getElementById('btn-settings').addEventListener('click', () => switchSidebarView('settings'));

  // Botões do header da sidebar
  document.getElementById('btn-open-folder').addEventListener('click', openFolderDialog);
  document.getElementById('btn-open-folder-2').addEventListener('click', openFolderDialog);
  document.getElementById('btn-new-file').addEventListener('click', newFileInRoot);
  document.getElementById('btn-new-folder').addEventListener('click', newFolderInRoot);

  // Botões welcome
  document.getElementById('welcome-open-folder').addEventListener('click', openFolderDialog);
  document.getElementById('welcome-open-file').addEventListener('click', openFileDialog);
  document.getElementById('welcome-clone').addEventListener('click', cloneRepo);

  // Activity bar
  document.querySelectorAll('.activity-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchSidebarView(btn.dataset.view));
  });

  // Settings inputs
  document.getElementById('setting-theme').addEventListener('change', async (e) => {
    const theme = e.target.value;
    document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${theme}`;
    const mod = await import('./editor.js');
    mod.applyTheme(theme);
  });
  document.getElementById('setting-perf').addEventListener('change', async (e) => {
    const mode = e.target.value;
    State.settings.performanceMode = mode;
    document.body.classList.remove('perf-economy', 'perf-high');
    if (mode === 'economy') document.body.classList.add('perf-economy');
    if (mode === 'high') document.body.classList.add('perf-high');
    document.getElementById('status-perf').textContent = `⚡ ${mode === 'high' ? 'alta performance' : mode}`;
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
    State.settings.aiApiKey = e.target.value || null;
    await window.agzos.settings.save(State.settings);
  });

  // Bottom panel
  document.getElementById('btn-close-bottom').addEventListener('click', () => {
    document.getElementById('bottom-panel').hidden = true;
    State.bottomHidden = true;
  });
  document.querySelectorAll('.bottom-tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.bottom-tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.bottom-pane').forEach((p) => p.classList.remove('active'));
      t.classList.add('active');
      document.getElementById(`pane-${t.dataset.tab}`).classList.add('active');
    });
  });

  // Atalhos globais
  bindShortcuts();

  // Menu nativo → renderer
  window.agzos.onMenu((channel) => {
    if (channel === 'menu:open-folder') openFolderDialog();
    else if (channel === 'menu:save') saveActive();
    else if (channel === 'menu:command-palette') showCommandPalette();
    else if (channel === 'menu:toggle-terminal') toggleTerminal();
    else if (channel === 'menu:toggle-sidebar') document.body.classList.toggle('sidebar-hidden');
  });

  // Init terminal (lazy no primeiro toggle, mas já carrega o módulo)
  // Vamos iniciar o terminal quando o usuário abrir pela 1ª vez.
  let termInit = false;
  const observer = new MutationObserver(() => {
    const panel = document.getElementById('bottom-panel');
    if (!panel.hidden && !termInit) {
      termInit = true;
      initTerminal();
    }
  });
  observer.observe(document.getElementById('bottom-panel'), { attributes: true, attributeFilter: ['hidden'] });

  // Expor para debug + integrações
  window.AgzosEditor = { openFile, saveActive };

  // Carrega app info
  const info = await window.agzos.app.info();
  document.title = `Agzos Code ${info.version}`;
  console.log(`[Agzos Code] v${info.version} • Electron ${info.electron} • ${info.platform}/${info.arch}`);

  // Restaura folders recentes (se houver)
  if (State.settings.recentFolders && State.settings.recentFolders.length > 0) {
    const last = State.settings.recentFolders[0];
    // Opcional: reabrir automaticamente. Comentado pra evitar carga surpresa.
    // await openWorkspace(last);
  }

  updateStatusAI();
  toast('Agzos Code carregado.', 'success', 1500);
}

function applySettingsToUI() {
  const s = State.settings;
  document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${s.theme}`;
  if (s.performanceMode === 'economy') document.body.classList.add('perf-economy');
  if (s.performanceMode === 'high') document.body.classList.add('perf-high');
  document.getElementById('setting-theme').value = s.theme;
  document.getElementById('setting-perf').value = s.performanceMode;
  document.getElementById('setting-telemetry').checked = !!s.telemetry;
  document.getElementById('setting-fontsize').value = s.fontSize;
  document.getElementById('setting-ai-provider').value = s.aiProvider || '';
  document.getElementById('setting-ai-key').value = s.aiApiKey || '';
  document.getElementById('status-perf').textContent = `⚡ ${s.performanceMode === 'high' ? 'alta performance' : s.performanceMode}`;
}

function updateStatusAI() {
  const el = document.getElementById('status-ai');
  if (State.settings.aiProvider) {
    el.textContent = `✦ IA: ${State.settings.aiProvider}`;
  } else {
    el.textContent = `✦ IA: off`;
  }
}

function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
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
  // Esconde tudo
  ['file-tree','empty-explorer','panel-search','panel-git','panel-extensions','panel-ai','panel-settings'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  // Mostra o selecionado (exceto file-tree que tem lógica própria)
  if (cfg.panel === 'file-tree') {
    if (State.workspaceRoot) {
      document.getElementById('file-tree').hidden = false;
    } else {
      document.getElementById('empty-explorer').hidden = false;
    }
  } else {
    document.getElementById(cfg.panel).hidden = false;
  }
  // Activity bar active state
  document.querySelectorAll('.activity-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

/* --------------------------------------------------------------------------
   Ações de arquivo
   -------------------------------------------------------------------------- */
async function openFolderDialog() {
  const p = await window.agzos.dialog.openFolder();
  if (p) await openWorkspace(p);
}
async function openFileDialog() {
  const p = await window.agzos.dialog.openFile();
  if (p) await openFile(p);
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
async function cloneRepo() {
  const url = prompt('URL do repositório git:');
  if (!url) return;
  const target = prompt('Pasta de destino:', url.split('/').pop().replace('.git', ''));
  if (!target) return;
  toast(`Para clonar, use o terminal: git clone ${url}`, 'info', 5000);
}
async function quickOpen(query) {
  // Match simples por nome de arquivo na workspace
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

// Boot!
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
