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
import { isQuickOpenResultCurrent, quickOpenEnterAction } from './ui-utils.js';

const State = window.AgzosState;

const QUICK_OPEN_TTL_MS = 30000;

let cachedFiles = null;
let cachedAt = 0;
let lastWorkspaceRoot = null;
let inflightScan = null; // { root, gen, promise }
let cacheGen = 0;
let querySeq = 0; // incrementa a cada busca/abertura; resultados antigos são descartados
let activeIndex = 0;
let currentResults = [];
let currentMode = 'commands'; // 'commands' | 'files' | 'pick'
let pickItems = []; // itens da lista de escolha (modo 'pick')

const COMMANDS = [
  // Arquivo & Workspace
  { id: 'file.openFolder',      label: 'Arquivo: Abrir Pasta…',                         hint: 'Ctrl+O',         run: openFolder },
  { id: 'file.openFile',        label: 'Arquivo: Abrir Arquivo…',                       hint: '',               run: openFileDialog },
  { id: 'file.save',            label: 'Arquivo: Salvar',                               hint: 'Ctrl+S',         run: () => import('./editor.js').then((m) => m.saveActive()) },
  { id: 'file.saveAs',          label: 'Arquivo: Salvar Como…',                         hint: 'Ctrl+Shift+S',   run: saveFileAs },
  { id: 'file.closeTab',        label: 'Arquivo: Fechar Editor Atual',                  hint: 'Ctrl+W',         run: () => import('./tabs.js').then((m) => m.closeTab(State.activePath)) },
  { id: 'file.closeAllTabs',    label: 'Arquivo: Fechar Todos os Editores',             hint: 'Ctrl+K Ctrl+W',  run: () => import('./tabs.js').then((m) => m.closeAllTabs()) },

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
  { id: 'view.focusModules',    label: 'Exibir: Abrir Módulos Agzos',                   hint: 'Ctrl+Shift+X',   run: () => switchView('modules') },
  { id: 'view.focusAI',         label: 'Exibir: Focar no Chat Agzos IA',                hint: 'Ctrl+Shift+A',   run: () => aiDock()?.show({ focus: true }) },
  { id: 'view.toggleTerminal',  label: 'Exibir: Alternar Terminal Integrado',           hint: 'Ctrl+`',         run: () => import('./terminal.js').then((m) => m.toggleTerminal()) },
  { id: 'view.termMoveRight',   label: 'Exibir: Mover Terminal para a Direita',         hint: '',               run: () => import('./terminal.js').then((m) => m.toggleTerminalPosition('right')) },
  { id: 'view.termMoveBottom',  label: 'Exibir: Mover Terminal para Baixo',             hint: '',               run: () => import('./terminal.js').then((m) => m.toggleTerminalPosition('bottom')) },
  { id: 'view.termMaximize',    label: 'Exibir: Maximizar / Restaurar Terminal',        hint: '',               run: () => import('./terminal.js').then((m) => m.toggleTerminalMaximize()) },
  { id: 'terminal.new',         label: 'Terminal: Novo Terminal',                       hint: 'Ctrl+Shift+`',   run: () => import('./terminal.js').then((m) => m.createTerminal()) },
  { id: 'terminal.newProfile',  label: 'Terminal: Novo Terminal com Perfil…',           hint: '',               run: pickTerminalProfile },
  { id: 'terminal.split',       label: 'Terminal: Dividir Terminal',                    hint: 'Ctrl+Shift+5',   run: () => import('./terminal.js').then((m) => m.splitTerminal()) },
  { id: 'terminal.kill',        label: 'Terminal: Matar Terminal Ativo',                hint: '',               run: () => import('./terminal.js').then((m) => m.killTerminal()) },
  { id: 'terminal.next',        label: 'Terminal: Próximo Terminal',                    hint: 'Ctrl+PageDown',  run: () => import('./terminal.js').then((m) => m.focusNextTerminal(1)) },
  { id: 'terminal.prev',        label: 'Terminal: Terminal Anterior',                   hint: 'Ctrl+PageUp',    run: () => import('./terminal.js').then((m) => m.focusNextTerminal(-1)) },
  { id: 'ports.refresh',        label: 'Portas: Atualizar',                             hint: '',               run: showPorts },
  { id: 'view.termClear',       label: 'Exibir: Limpar Saída do Terminal',              hint: '',               run: () => import('./terminal.js').then((m) => m.clearTerminal()) },

  // Preferências
  { id: 'pref.settings',        label: 'Preferências: Abrir Configurações (UI)',        hint: 'Ctrl+,',         run: () => import('./settings-modal.js').then((m) => m.openSettingsModal()) },
  { id: 'pref.settingsJson',    label: 'Preferências: Abrir Configurações (JSON)',      hint: '',               run: () => import('./settings-modal.js').then((m) => m.openSettingsModal('commonlyUsed', { json: true })) },
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
  { id: 'ai.togglePanel',       label: 'Agzos IA: Alternar Painel',                     hint: 'Ctrl+L',         run: () => aiDock()?.toggle({ focus: true }) },
  { id: 'ai.agentMode',         label: 'Agzos IA: Alternar modo do agente',             hint: '',               run: () => import('./ai-chat.js').then((m) => m.pickAgentMode()) },
  { id: 'ai.moveLeft',          label: 'Agzos IA: Mover para Esquerda',                 hint: '',               run: () => moveAiDock('left') },
  { id: 'ai.moveRight',         label: 'Agzos IA: Mover para Direita',                  hint: '',               run: () => moveAiDock('right') },
  { id: 'ai.moveBottom',        label: 'Agzos IA: Mover para Embaixo',                  hint: '',               run: () => moveAiDock('bottom') },
  { id: 'ai.configure',         label: 'Agzos IA: Configurar Provedor (Wizard)',        hint: '',               run: () => import('./ai-wizard.js').then((m) => m.openAIWizard({ profileId: State.settings?.ai?.activeProfileId })) },

  // Git & GitHub (git-panel.js)
  { id: 'git.commit',           label: 'Git: Commit',                                   hint: 'Ctrl+Enter',     run: () => gitCommand('commit') },
  { id: 'git.commitPush',       label: 'Git: Commit e Push',                            hint: '',               run: () => gitCommand('commitPush') },
  { id: 'git.push',             label: 'Git: Push',                                     hint: '',               run: () => gitCommand('push') },
  { id: 'git.pull',             label: 'Git: Pull',                                     hint: '',               run: () => gitCommand('pull') },
  { id: 'git.fetch',            label: 'Git: Fetch',                                    hint: '',               run: () => gitCommand('fetch') },
  { id: 'git.sync',             label: 'Git: Sincronizar (Pull + Push)',                hint: '',               run: () => gitCommand('sync') },
  { id: 'git.createBranch',     label: 'Git: Criar Branch…',                            hint: '',               run: () => gitCommand('createBranch') },
  { id: 'git.checkout',         label: 'Git: Trocar Branch…',                           hint: '',               run: () => gitCommand('checkout') },
  { id: 'git.clone',            label: 'Git: Clonar Repositório…',                      hint: '',               run: () => gitCommand('clone') },
  { id: 'git.init',             label: 'Git: Inicializar Repositório',                  hint: '',               run: () => gitCommand('init') },
  { id: 'git.publish',          label: 'Git: Publicar no GitHub…',                      hint: '',               run: () => gitCommand('publish') },
  { id: 'git.pr',               label: 'Git: Criar Pull Request…',                      hint: '',               run: () => gitCommand('pr') },
  { id: 'git.account',          label: 'Git: Conta GitHub do Repositório…',             hint: '',               run: () => gitCommand('account') },

  // Ajuda & Atualizações
  { id: 'help.checkUpdates',    label: 'Ajuda: Verificar Atualizações Agora (OTA)',     hint: '',               run: () => window.agzos.update.check() },
  { id: 'help.about',           label: 'Ajuda: Sobre o Agzos Code',                     hint: '',               run: showAbout },
];

/**
 * Acrescenta comandos à paleta (módulos nativos). Mesmo id substitui o anterior.
 * cmds: [{ id, label, run, hint? }]
 */
export function registerCommands(cmds) {
  for (const cmd of Array.isArray(cmds) ? cmds : [cmds]) {
    if (!cmd || typeof cmd.id !== 'string' || typeof cmd.label !== 'string' || typeof cmd.run !== 'function') continue;
    const entry = { hint: '', ...cmd };
    const i = COMMANDS.findIndex((c) => c.id === cmd.id);
    if (i === -1) COMMANDS.push(entry);
    else COMMANDS[i] = entry;
  }
}

export async function showQuickOpen() {
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  if (!overlay || !input) return;

  currentMode = 'files';
  overlay.hidden = false;
  input.placeholder = 'Buscar arquivos por nome (digite > para comandos)…';
  input.value = '';
  const seq = ++querySeq;
  // Limpa a lista na hora (sem resultados de uma abertura anterior)
  currentResults = [];
  activeIndex = 0;
  renderList();
  setTimeout(() => input.focus(), 20);

  const files = await ensureWorkspaceFilesLoaded();
  if (!isQuickOpenResultCurrent({
    seq, currentSeq: querySeq, mode: currentMode, value: '', currentValue: input.value, visible: !overlay.hidden,
  })) return;
  currentResults = files.slice(0, 50);
  activeIndex = 0;
  renderList();
}

export function showCommandPalette() {
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  if (!overlay || !input) return;

  currentMode = 'commands';
  querySeq++;
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

/**
 * Lista de escolha na paleta (ex.: perfis de terminal).
 * items: [{ label, hint?, run }]
 */
export function showPicker({ placeholder = 'Escolha…', items = [] } = {}) {
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  if (!overlay || !input) return;
  currentMode = 'pick';
  querySeq++;
  pickItems = items.slice();
  overlay.hidden = false;
  input.placeholder = placeholder;
  input.value = '';
  currentResults = [...pickItems];
  activeIndex = 0;
  renderList();
  setTimeout(() => input.focus(), 20);
}

async function pickTerminalProfile() {
  const m = await import('./terminal.js');
  const { profiles, defaultId, fallback } = await m.getTerminalProfiles();
  showPicker({
    placeholder: 'Escolha o perfil do novo terminal',
    items: profiles.map((p) => ({
      label: p.label,
      hint: p.id === defaultId && !fallback ? 'padrão' : (p.shell || ''),
      run: () => m.createTerminal({ profileId: p.id }),
    })),
  });
}

async function showPorts() {
  const m = await import('./terminal.js');
  m.selectBottomTab('ports', { focus: false });
  m.setBottomPanelVisible(true);
  m.refreshPorts();
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
    const seq = ++querySeq;

    if (currentMode === 'pick' && !val.startsWith('>')) {
      const q = val.trim().toLowerCase();
      currentResults = pickItems
        .map((c) => ({ c, score: fuzzyScore(c.label, q) }))
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.c);
    } else if (val.startsWith('>')) {
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
      const files = await ensureWorkspaceFilesLoaded();
      // Outra tecla/modo chegou enquanto varria o disco: descarta este resultado
      if (!isQuickOpenResultCurrent({
        seq, currentSeq: querySeq, mode: currentMode, value: val, currentValue: input.value, visible: !overlay.hidden,
      })) return;

      const q = val.trim().toLowerCase();
      if (!q) {
        currentResults = files.slice(0, 50);
      } else {
        currentResults = files
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
      e.preventDefault();
      const item = currentResults[activeIndex];
      const action = quickOpenEnterAction(currentMode === 'pick' ? 'commands' : currentMode, item);
      if (!action) return;
      hideCommandPalette();
      if (action === 'run') item.run();
      else import('./editor.js').then((m) => m.openFile(item.path));
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideCommandPalette();
  });
}

function openFilesAsEntries() {
  return [...State.files.keys()].map((p) => ({
    name: p.split(/[\\/]/).pop(),
    path: p,
    relativePath: p,
  }));
}

/**
 * Lista de arquivos do workspace para o Quick Open. Cache por raiz com TTL de
 * 30s; varreduras simultâneas compartilham a mesma promise (sem corrida).
 */
function ensureWorkspaceFilesLoaded() {
  const root = State.workspaceRoot;
  if (!root || !window.agzos.fs?.findFiles) return Promise.resolve(openFilesAsEntries());

  const fresh = cachedFiles && root === lastWorkspaceRoot && Date.now() - cachedAt < QUICK_OPEN_TTL_MS;
  if (fresh) return Promise.resolve(cachedFiles);
  if (inflightScan && inflightScan.root === root && inflightScan.gen === cacheGen) return inflightScan.promise;

  const gen = cacheGen;
  const promise = (async () => {
    let files;
    try {
      files = await window.agzos.fs.findFiles(root, 1500);
    } catch (err) {
      console.error('Falha ao varrer arquivos para Quick Open:', err);
      files = [];
    }
    if (!Array.isArray(files)) files = [];
    // Só grava no cache se ninguém invalidou nem trocou de raiz durante a varredura
    if (gen === cacheGen && State.workspaceRoot === root) {
      cachedFiles = files;
      cachedAt = Date.now();
      lastWorkspaceRoot = root;
    }
    return files;
  })();
  inflightScan = { root, gen, promise };
  promise.finally(() => {
    if (inflightScan?.promise === promise) inflightScan = null;
  });
  return promise;
}

export function invalidateQuickOpenCache() {
  cachedFiles = null;
  cachedAt = 0;
  cacheGen++;
  inflightScan = null;
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

    if (currentMode === 'commands' || currentMode === 'pick') {
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
  const defaultPath = State.activePath || 'sem-titulo.txt';
  const targetPath = await window.agzos.dialog.saveFile(defaultPath);
  if (targetPath) {
    const editorMod = await import('./editor.js');
    const editor = editorMod.getActiveEditor();
    if (editor) {
      await window.agzos.fs.writeFile(targetPath, editor.getValue());
      invalidateQuickOpenCache();
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

// Dock do Agzos IA (ai-dock.js expõe window.AgzosAiDock no boot)
const aiDock = () => window.AgzosAiDock || null;

function moveAiDock(position) {
  const dock = aiDock();
  if (!dock) return;
  dock.setPosition(position, { show: true });
  dock.focusInput();
}

function gitCommand(id) {
  return import('./git-panel.js').then((m) => m.runGitCommand(id));
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
  try {
    // IPC devolve { ok, imported: string[], path } ou { ok: false, reason, error?, path }
    const res = await window.agzos.settings.importVSCode();
    if (!res?.ok) {
      const why = res?.reason === 'parse_error' ? `erro ao ler ${res.path}: ${res.error || ''}` : 'settings.json do VS Code não encontrado';
      toast(`Importação não realizada: ${why}`, 'info', 4000);
      return;
    }
    // O main gravou no disco: recarrega para o próximo save não sobrescrever a importação
    Object.assign(State.settings, await window.agzos.settings.load());
    const mod = await import('./settings-modal.js');
    await mod.applySettingsLive();
    const n = res.imported?.length || 0;
    toast(n ? `Importadas ${n} configurações: ${res.imported.join(', ')}` : 'Nenhuma configuração compatível encontrada no VS Code.', n ? 'success' : 'info', 3500);
  } catch (e) {
    toast(`Erro na importação: ${e.message}`, 'error');
  }
}

export function showShortcutsModal() {
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
    { key: 'Ctrl + K  Ctrl + W', desc: 'Arquivo: Fechar todos os editores' },
    { key: 'Ctrl + K  Ctrl + S', desc: 'Preferências: Atalhos de Teclado' },
    { key: "Ctrl + ` / Ctrl + '", desc: 'Exibir: Alternar Terminal Integrado' },
    { key: 'Ctrl + Shift + `', desc: 'Terminal: Novo terminal' },
    { key: 'Ctrl + Shift + 5', desc: 'Terminal: Dividir terminal' },
    { key: 'Ctrl + PageUp / PageDown', desc: 'Terminal: Terminal anterior / próximo (foco no terminal)' },
    { key: 'Ctrl + B', desc: 'Exibir: Alternar Barra Lateral' },
    { key: 'Ctrl + Shift + E', desc: 'Exibir: Focar no Explorer de Arquivos' },
    { key: 'Ctrl + Shift + F', desc: 'Exibir: Focar na Busca no Projeto' },
    { key: 'Ctrl + Shift + G', desc: 'Exibir: Focar no Controle de Versão (Git)' },
    { key: 'Ctrl + Shift + X', desc: 'Exibir: Abrir Módulos Agzos' },
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
