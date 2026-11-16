/**
 * Unified Command Palette & Quick Open — busca fuzzy de arquivos e comandos no padrão VS Code.
 *
 * Suporta:
 *  - Ctrl+P: Quick Open (arquivos do workspace)
 *  - Ctrl+Shift+P: Command Palette (comandos de IDE com prefixo '>')
 *  - Alternância dinâmica: digitar '>' muda para comandos, apagar '>' volta para arquivos
 *  - Navegação por teclado (↑, ↓, Enter, Esc)
 */

import { perfLabel } from './labels.js';
import { renderFileIcon } from './icon-theme.js';
import { toast } from './toast.js';

const State = window.AgzosState;

let cachedFiles = null;
let lastWorkspaceRoot = null;
let activeIndex = 0;
let currentResults = [];
let currentMode = 'commands'; // 'commands' | 'files'

const COMMANDS = [
  // Arquivo & Workspace
  { id: 'file.openFolder',      label: 'Arquivo: Abrir Pasta…',                         hint: 'Ctrl+O',         run: openFolder },
  { id: 'file.openFile',        label: 'Arquivo: Abrir Arquivo…',                       hint: '',               run: openFileDialog },
  { id: 'file.save',            label: 'Arquivo: Salvar',                               hint: 'Ctrl+S',         run: () => import('./editor.js').then((m) => m.saveActive()) },
  { id: 'file.saveAs',          label: 'Arquivo: Salvar Como…',                         hint: 'Ctrl+Shift+S',   run: saveFileAs },
  { id: 'file.closeTab',        label: 'Arquivo: Fechar Editor Atual',                  hint: 'Ctrl+W',         run: () => import('./tabs.js').then((m) => m.closeTab(State.activeFile)) },
  { id: 'file.closeAllTabs',    label: 'Arquivo: Fechar Todos os Editores',             hint: 'Ctrl+K Ctrl+W',  run: () => import('./tabs.js').then((m) => m.closeAllTabs?.()) },

  // Editor & Produtividade
  { id: 'editor.find',          label: 'Editor: Localizar no Arquivo',                  hint: 'Ctrl+F',         run: () => triggerEditorAction('actions.find') },
  { id: 'editor.replace',       label: 'Editor: Substituir no Arquivo',                 hint: 'Ctrl+H',         run: () => triggerEditorAction('editor.action.startFindReplaceAction') },
  { id: 'editor.gotoLine',      label: 'Editor: Ir para Linha/Coluna…',                 hint: 'Ctrl+G',         run: () => triggerEditorAction('editor.action.gotoLine') },
  { id: 'editor.format',        label: 'Editor: Formatar Documento',                    hint: 'Shift+Alt+F',    run: () => triggerEditorAction('editor.action.formatDocument') },
  { id: 'editor.toggleWordWrap',label: 'Editor: Alternar Quebra Automática de Linha',   hint: 'Alt+Z',          run: toggleWordWrap },
  { id: 'editor.zoomIn',        label: 'Editor: Aumentar Fonte (Zoom In)',              hint: 'Ctrl+=',         run: () => zoomFont(1) },
  { id: 'editor.zoomOut',       label: 'Editor: Diminuir Fonte (Zoom Out)',             hint: 'Ctrl+-',         run: () => zoomFont(-1) },
  { id: 'editor.zoomReset',     label: 'Editor: Resetar Zoom da Fonte',                 hint: 'Ctrl+0',         run: () => zoomFont(0) },

  // Visualização & Painéis
  { id: 'view.toggleSidebar',   label: 'Exibir: Alternar Barra Lateral (Sidebar)',      hint: 'Ctrl+B',         run: () => document.body.classList.toggle('sidebar-hidden') },
  { id: 'view.focusExplorer',   label: 'Exibir: Focar no Explorer de Arquivos',         hint: 'Ctrl+Shift+E',   run: () => switchView('explorer') },
  { id: 'view.focusSearch',     label: 'Exibir: Focar na Busca no Projeto',             hint: 'Ctrl+Shift+F',   run: () => switchView('search') },
  { id: 'view.focusGit',        label: 'Exibir: Focar no Controle de Versão (Git)',     hint: 'Ctrl+Shift+G',   run: () => switchView('git') },
  { id: 'view.focusAI',         label: 'Exibir: Focar no Chat Agzos IA',                hint: 'Ctrl+Shift+A',   run: () => switchView('ai') },
  { id: 'view.toggleTerminal',  label: 'Exibir: Alternar Terminal Integrado',           hint: 'Ctrl+`',         run: () => import('./terminal.js').then((m) => m.toggleTerminal()) },
  { id: 'view.termMoveRight',   label: 'Exibir: Mover Terminal para a Direita',         hint: '',               run: () => import('./terminal.js').then((m) => m.toggleTerminalPosition('right')) },
  { id: 'view.termMoveBottom',  label: 'Exibir: Mover Terminal para Baixo',             hint: '',               run: () => import('./terminal.js').then((m) => m.toggleTerminalPosition('bottom')) },
  { id: 'view.termMaximize',    label: 'Exibir: Maximizar / Restaurar Terminal',        hint: '',               run: () => import('./terminal.js').then((m) => m.toggleTerminalMaximize()) },
  { id: 'view.termClear',       label: 'Exibir: Limpar Saída do Terminal',              hint: '',               run: () => import('./terminal.js').then((m) => m.clearTerminal()) },

  // Preferências
  { id: 'pref.settings',        label: 'Preferências: Abrir Configurações (UI)',        hint: 'Ctrl+,',         run: () => import('./settings-modal.js').then((m) => m.openSettingsModal()) },
  { id: 'pref.settingsJson',    label: 'Preferências: Abrir Configurações (JSON)',      hint: '',               run: () => import('./settings-modal.js').then((m) => { m.openSettingsModal(); const b = document.getElementById('btn-toggle-settings-json'); if (b) b.click(); }) },
  { id: 'pref.importVSCode',    label: 'Preferências: Importar do VS Code / Cursor',    hint: '',               run: importVSCodeDialog },
  { id: 'pref.shortcuts',       label: 'Preferências: Atalhos de Teclado',              hint: 'Ctrl+K Ctrl+S',  run: showShortcutsModal },

  // Temas e Performance
  { id: 'theme.dark',           label: 'Preferências: Tema Agzos Dark',                 hint: '',               run: () => setTheme('agzos-dark') },
  { id: 'theme.light',          label: 'Preferências: Tema Agzos Light',                hint: '',               run: () => setTheme('agzos-light') },
  { id: 'theme.monokai',        label: 'Preferências: Tema Monokai',                    hint: '',               run: () => setTheme('monokai') },
  { id: 'icon.lucideColor',     label: 'Preferências: Ícones Lucide Colorido',          hint: '',               run: () => setIconTheme('lucide-color') },
  { id: 'icon.lucideMinimal',   label: 'Preferências: Ícones Lucide Minimalista',        hint: '',               run: () => setIconTheme('lucide-minimal') },
  { id: 'icon.badges',          label: 'Preferências: Ícones Badges (Seti)',            hint: '',               run: () => setIconTheme('badges') },
  { id: 'icon.emoji',           label: 'Preferências: Ícones Emojis',                   hint: '',               run: () => setIconTheme('emoji') },
  { id: 'perf.economy',         label: 'Performance: Modo Economia',                    hint: '',               run: () => setPerf('economy') },
  { id: 'perf.balanced',        label: 'Performance: Modo Balanceado',                  hint: '',               run: () => setPerf('balanced') },
  { id: 'perf.high',            label: 'Performance: Modo Alta Performance',            hint: '',               run: () => setPerf('high') },

  // Agzos IA
  { id: 'ai.explain',           label: 'Agzos IA: Explicar Código Selecionado',         hint: '',               run: () => triggerAIAction('explain') },
  { id: 'ai.refactor',          label: 'Agzos IA: Refatorar Código Selecionado',        hint: '',               run: () => triggerAIAction('refactor') },
  { id: 'ai.document',          label: 'Agzos IA: Gerar Documentação',                  hint: '',               run: () => triggerAIAction('document') },
  { id: 'ai.tests',             label: 'Agzos IA: Gerar Testes Unitários',              hint: '',               run: () => triggerAIAction('tests') },
  { id: 'ai.configure',         label: 'Agzos IA: Configurar Provedor (Wizard)',        hint: '',               run: () => import('./ai-wizard.js').then((m) => m.openAIWizard({ profileId: State.settings?.ai?.activeProfileId })) },

  // Ajuda & Atualizações
  { id: 'help.checkUpdates',    label: 'Ajuda: Verificar Atualizações Agora (OTA)',     hint: '',               run: () => window.agzos.updater.check() },
  { id: 'help.about',           label: 'Ajuda: Sobre o Agzos Code',                     hint: '',               run: showAbout },
];

export async function showQuickOpen() {
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  if (!overlay || !input) return;

  currentMode = 'files';
  overlay.hidden = false;
  input.placeholder = 'Buscar arquivos por nome (digite > para comandos)…';
  input.value = '';

  await ensureWorkspaceFilesLoaded();
  currentResults = cachedFiles ? [...cachedFiles.slice(0, 50)] : [];
  activeIndex = 0;
  renderList();
  setTimeout(() => input.focus(), 20);
}

export function showCommandPalette() {
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  if (!overlay || !input) return;

  currentMode = 'commands';
  overlay.hidden = false;
  input.placeholder = 'Digite um comando…';
  input.value = '> ';
  currentResults = [...COMMANDS];
  activeIndex = 0;
  renderList();
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(2, 2);
  }, 20);
}

export function hideCommandPalette() {
  const overlay = document.getElementById('cmd-overlay');
  if (overlay) overlay.hidden = true;
}

export function setupCommandPalette() {
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  if (!overlay || !input) return;

  input.addEventListener('input', async () => {
    const val = input.value;

    if (val.startsWith('>')) {
      // Modo comandos
      currentMode = 'commands';
      input.placeholder = 'Digite um comando…';
      const q = val.slice(1).trim().toLowerCase();
      currentResults = COMMANDS
        .map((c) => ({ c, score: fuzzyScore(c.label, q) }))
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.c);
    } else {
      // Modo arquivos (Quick Open)
      currentMode = 'files';
      input.placeholder = 'Buscar arquivos por nome (digite > para comandos)…';
      await ensureWorkspaceFilesLoaded();

      const q = val.trim().toLowerCase();
      if (!q) {
        currentResults = (cachedFiles || []).slice(0, 50);
      } else {
        currentResults = (cachedFiles || [])
          .map((file) => ({
            file,
            score: Math.max(fuzzyScore(file.name, q) * 1.5, fuzzyScore(file.relativePath, q)),
          }))
          .filter((r) => r.score >= 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 50)
          .map((r) => r.file);
      }
    }

    activeIndex = 0;
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideCommandPalette();
    } else if (e.key === 'ArrowDown') {
      activeIndex = (activeIndex + 1) % Math.max(1, currentResults.length);
      renderList();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      activeIndex = (activeIndex - 1 + currentResults.length) % Math.max(1, currentResults.length);
      renderList();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const item = currentResults[activeIndex];
      if (item) {
        hideCommandPalette();
        if (currentMode === 'commands') {
          item.run();
        } else {
          import('./editor.js').then((m) => m.openFile(item.path));
        }
      }
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideCommandPalette();
  });
}

async function ensureWorkspaceFilesLoaded() {
  if (State.workspaceRoot !== lastWorkspaceRoot || !cachedFiles) {
    lastWorkspaceRoot = State.workspaceRoot;
    if (State.workspaceRoot && window.agzos.fs?.findFiles) {
      try {
        cachedFiles = await window.agzos.fs.findFiles(State.workspaceRoot, 1500);
      } catch (err) {
        console.error('Falha ao varrer arquivos para Quick Open:', err);
        cachedFiles = [];
      }
    } else {
      cachedFiles = (State.openFiles || []).map((p) => ({
        name: p.split(/[\\/]/).pop(),
        path: p,
        relativePath: p,
      }));
    }
  }
}

export function invalidateQuickOpenCache() {
  cachedFiles = null;
}

function renderList() {
  const list = document.getElementById('cmd-list');
  if (!list) return;
  list.innerHTML = '';

  if (currentResults.length === 0) {
    const li = document.createElement('li');
    li.textContent = currentMode === 'commands' ? 'Nenhum comando encontrado.' : 'Nenhum arquivo encontrado.';
    li.style.color = 'var(--fg-mute)';
    li.style.padding = '12px 18px';
    list.appendChild(li);
    return;
  }

  const iconTheme = State.settings?.iconTheme || 'lucide-color';

  currentResults.forEach((item, idx) => {
    const li = document.createElement('li');
    if (idx === activeIndex) li.classList.add('active');

    if (currentMode === 'commands') {
      const label = document.createElement('span');
      label.textContent = item.label;
      const hint = document.createElement('span');
      hint.className = 'kbd-hint';
      hint.textContent = item.hint || '';
      li.appendChild(label);
      li.appendChild(hint);

      li.addEventListener('click', () => {
        hideCommandPalette();
        item.run();
      });
    } else {
      li.classList.add('cmd-item-file');

      const iconEl = renderFileIcon(item.name, iconTheme);
      iconEl.style.marginRight = '8px';
      li.appendChild(iconEl);

      const infoWrap = document.createElement('div');
      infoWrap.className = 'cmd-file-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'cmd-file-name';
      nameEl.textContent = item.name;

      const pathEl = document.createElement('span');
      pathEl.className = 'cmd-file-path';
      pathEl.textContent = item.relativePath;

      infoWrap.appendChild(nameEl);
      infoWrap.appendChild(pathEl);
      li.appendChild(infoWrap);

      li.addEventListener('click', () => {
        hideCommandPalette();
        import('./editor.js').then((m) => m.openFile(item.path));
      });
    }

    li.addEventListener('mouseenter', () => {
      activeIndex = idx;
      updateActiveVisual(list, activeIndex);
    });

    list.appendChild(li);
  });

  // Garante scroll visível para o item ativo
  const activeEl = list.children[activeIndex];
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

function updateActiveVisual(list, idx) {
  Array.from(list.children).forEach((child, i) => {
    child.classList.toggle('active', i === idx);
  });
}

function fuzzyScore(text, query) {
  if (!query) return 1;
  text = text.toLowerCase();
  let i = 0, j = 0, score = 0, lastMatch = -1;
  while (i < text.length && j < query.length) {
    if (text[i] === query[j]) {
      score += (lastMatch === i - 1) ? 3 : 1;
      lastMatch = i;
      j++;
    }
    i++;
  }
  return j === query.length ? score : -1;
}

/* --------------------------------------------------------------------------
   Ações de Comandos
   -------------------------------------------------------------------------- */
async function openFolder() {
  const p = await window.agzos.dialog.openFolder();
  if (p) {
    const mod = await import('./file-tree.js');
    await mod.openWorkspace(p);
    invalidateQuickOpenCache();
  }
}

async function openFileDialog() {
  const p = await window.agzos.dialog.openFile();
  if (p) {
    const mod = await import('./editor.js');
    await mod.openFile(p);
  }
}

async function saveFileAs() {
  const defaultPath = State.activeFile || 'sem-titulo.txt';
  const targetPath = await window.agzos.dialog.saveFile(defaultPath);
  if (targetPath) {
    const editorMod = await import('./editor.js');
    const editor = editorMod.getActiveEditor();
    if (editor) {
      await window.agzos.fs.writeFile(targetPath, editor.getValue());
      await editorMod.openFile(targetPath);
      toast('Arquivo salvo com sucesso.', 'success', 1500);
    }
  }
}

async function triggerEditorAction(actionId) {
  const editorMod = await import('./editor.js');
  const editor = editorMod.getActiveEditor();
  if (editor) {
    editor.focus();
    const action = editor.getAction(actionId);
    if (action) action.run();
  }
}

async function toggleWordWrap() {
  const curr = State.settings?.editor?.wordWrap || 'off';
  const next = curr === 'on' ? 'off' : 'on';
  State.settings.editor = State.settings.editor || {};
  State.settings.editor.wordWrap = next;
  await window.agzos.settings.save(State.settings);
  const editorMod = await import('./editor.js');
  editorMod.applyEditorSettings(State.settings);
  toast(`Quebra de linha: ${next.toUpperCase()}`, 'info', 1200);
}

async function zoomFont(delta) {
  const curr = State.settings?.fontSize || 14;
  const next = delta === 0 ? 14 : Math.max(8, Math.min(32, curr + delta));
  State.settings.fontSize = next;
  await window.agzos.settings.save(State.settings);
  const editorMod = await import('./editor.js');
  editorMod.applyFontSize(next);
  toast(`Tamanho da fonte: ${next}px`, 'info', 1000);
}

function switchView(view) {
  const btn = document.querySelector(`.activity-btn[data-view="${view}"]`);
  if (btn) btn.click();
}

async function triggerAIAction(actionKey) {
  const editorMod = await import('./editor.js');
  const editor = editorMod.getActiveEditor();
  if (editor) {
    const action = editor.getAction(`agzos-ai.${actionKey}`);
    if (action) action.run();
  }
}

async function setTheme(theme) {
  const mod = await import('./editor.js');
  mod.applyTheme(theme);
  document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${theme}`;
  State.settings.theme = theme;
  await window.agzos.settings.save(State.settings);
}

async function setPerf(mode) {
  document.body.classList.remove('perf-economy', 'perf-high');
  if (mode === 'economy') document.body.classList.add('perf-economy');
  if (mode === 'high') document.body.classList.add('perf-high');
  const statusEl = document.getElementById('status-perf');
  if (statusEl) statusEl.textContent = perfLabel(mode);
  State.settings.performanceMode = mode;
  await window.agzos.settings.save(State.settings);
}

async function setIconTheme(theme) {
  State.settings.iconTheme = theme;
  await window.agzos.settings.save(State.settings);
  const fileTreeMod = await import('./file-tree.js');
  fileTreeMod.refreshTree(true);
  const tabsMod = await import('./tabs.js');
  tabsMod.renderTabs();
  toast(`Tema de ícones: ${theme}`, 'info', 1500);
}

async function importVSCodeDialog() {
  const res = await window.agzos.settings.importVSCode();
  if (res?.success) {
    toast(`Importadas ${res.count} configurações do ${res.source}.`, 'success');
  } else {
    toast(`Nenhum arquivo de configuração encontrado: ${res?.error || ''}`, 'info');
  }
}

function showShortcutsModal() {
  const shortcuts = [
    { key: 'Ctrl + P', desc: 'Quick Open: Busca rápida de arquivos' },
    { key: 'Ctrl + Shift + P', desc: 'Command Palette: Todos os comandos e atalhos' },
    { key: 'Ctrl + ,', desc: 'Preferências: Abrir Configurações' },
    { key: 'Ctrl + F', desc: 'Editor: Localizar no arquivo ativo' },
    { key: 'Ctrl + H', desc: 'Editor: Substituir no arquivo ativo' },
    { key: 'Ctrl + G', desc: 'Editor: Ir para Linha/Coluna' },
    { key: 'Shift + Alt + F', desc: 'Editor: Formatar documento' },
    { key: 'Alt + Z', desc: 'Editor: Alternar quebra de linha (Word Wrap)' },
    { key: 'Ctrl + S', desc: 'Arquivo: Salvar alterações' },
    { key: 'Ctrl + W', desc: 'Arquivo: Fechar editor/aba ativa' },
    { key: 'Ctrl + `', desc: 'Exibir: Alternar Terminal Integrado' },
    { key: 'Ctrl + B', desc: 'Exibir: Alternar Barra Lateral' },
    { key: 'Ctrl + Shift + E', desc: 'Exibir: Focar no Explorer de Arquivos' },
    { key: 'Ctrl + Shift + F', desc: 'Exibir: Focar na Busca no Projeto' },
    { key: 'Ctrl + Shift + G', desc: 'Exibir: Focar no Controle de Versão (Git)' },
    { key: 'Ctrl + Shift + A', desc: 'Agzos IA: Abrir e focar no Chat de IA' },
    { key: 'Ctrl + = / -', desc: 'Zoom: Aumentar / diminuir tamanho da fonte' },
  ];

  let modalEl = document.getElementById('shortcuts-modal-overlay');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'shortcuts-modal-overlay';
    modalEl.className = 'overlay';
    document.body.appendChild(modalEl);
  }

  modalEl.innerHTML = `
    <div class="cmd-palette" style="width: 550px; padding: 18px 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid var(--line); padding-bottom:10px;">
        <h3 style="margin:0; font-size:16px;">Atalhos de Teclado</h3>
        <button id="btn-close-shortcuts" class="icon-btn" style="cursor:pointer; font-size:16px; background:none; border:none; color:var(--fg-mute);">✕</button>
      </div>
      <div style="max-height:60vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">
        ${shortcuts.map((s) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-bottom:1px solid var(--line-2);">
            <span style="font-size:13px; color:var(--fg);">${s.desc}</span>
            <kbd style="background:var(--bg-soft2); border:1px solid var(--line); border-radius:4px; padding:2px 8px; font-size:11px; font-family:monospace; color:var(--fg-dim);">${s.key}</kbd>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  modalEl.hidden = false;
  const closeBtn = document.getElementById('btn-close-shortcuts');
  if (closeBtn) closeBtn.onclick = () => { modalEl.hidden = true; };
  modalEl.onclick = (e) => { if (e.target === modalEl) modalEl.hidden = true; };
}

async function showAbout() {
  const info = await window.agzos.app.info();
  alert(`Agzos Code ${info.version}\nElectron ${info.electron}\nNode ${info.node}\nPlatform: ${info.platform}/${info.arch}`);
}
