/**
 * Barra de menus — modelo puro (sem DOM/window), testável em Node.
 *
 * Menu: { id, label, mnemonic, items }
 * Item: { id, label, accel?, run?, checked?(ctx), enabled?(ctx), comingSoon?, submenu?, dynamic?, hint? }
 *     | { type: 'separator' }
 *
 *  - run: id de comando da paleta (command-palette.js / menu-actions.js) ou
 *    'monaco:<actionId>' (ação do Monaco no editor ativo). O menu nunca tem
 *    lógica própria: chama o mesmo comando que a paleta/atalho.
 *  - comingSoon: item visível, desabilitado, com selo "Em breve" (sem run).
 *  - dynamic: o menubar.js expande o item em vários (ex.: pastas recentes).
 *  - accel: texto do atalho; string ou { default, linux, win32, darwin }.
 *
 * ctx (montado pelo menubar.js): { hasEditor, hasWorkspace, openCount, recentFolders,
 *   settings, sidebarVisible, panelVisible, statusBarVisible, platform }
 */

const hasEditor = (c) => !!c?.hasEditor;
const hasWorkspace = (c) => !!c?.hasWorkspace;
const ed = (c) => c?.settings?.editor || {};
const SEP = { type: 'separator' };

const soon = (id, label, hint) => ({ id, label, comingSoon: true, ...(hint ? { hint } : {}) });
const monaco = (id, label, actionId, accel) => ({
  id, label, run: `monaco:${actionId}`, enabled: hasEditor, ...(accel ? { accel } : {}),
});

const THEMES = [
  ['agzos-dark', 'Agzos Escuro', 'theme.dark'],
  ['agzos-light', 'Agzos Claro', 'theme.light'],
  ['monokai', 'Monokai', 'theme.monokai'],
];
const ICON_THEMES = [
  ['lucide-color', 'Lucide Colorido', 'icon.lucideColor'],
  ['lucide-minimal', 'Lucide Minimalista', 'icon.lucideMinimal'],
  ['badges', 'Selos (Seti)', 'icon.badges'],
  ['emoji', 'Emojis', 'icon.emoji'],
];

export const MENUS = [
  {
    id: 'file',
    label: 'Arquivo',
    mnemonic: 'A',
    items: [
      { id: 'file.newUntitled', label: 'Novo Arquivo de Texto', accel: 'Ctrl+N', run: 'file.newUntitled' },
      { id: 'file.newFile', label: 'Novo Arquivo…', run: 'file.newFileInFolder', enabled: hasWorkspace },
      { id: 'file.newWindow', label: 'Nova Janela', accel: 'Ctrl+Shift+N', run: 'window.new' },
      SEP,
      { id: 'file.openFile', label: 'Abrir Arquivo…', run: 'file.openFile' },
      { id: 'file.openFolder', label: 'Abrir Pasta…', accel: 'Ctrl+O', run: 'file.openFolder' },
      {
        id: 'file.openRecent',
        label: 'Abrir Recente',
        submenu: [
          { id: 'file.recent.folders', label: 'Pastas Recentes', dynamic: 'recentFolders', run: 'file.openRecent' },
          SEP,
          { id: 'file.recent.clear', label: 'Limpar Recentes', run: 'file.clearRecent', enabled: (c) => (c?.recentFolders?.length || 0) > 0 },
        ],
      },
      SEP,
      soon('file.addFolderToWorkspace', 'Adicionar Pasta ao Workspace…', 'Workspaces com várias pastas ainda não são suportados'),
      soon('file.saveWorkspaceAs', 'Salvar Workspace Como…', 'Arquivos de workspace ainda não são suportados'),
      SEP,
      { id: 'file.save', label: 'Salvar', accel: 'Ctrl+S', run: 'file.save', enabled: hasEditor },
      { id: 'file.saveAs', label: 'Salvar Como…', accel: 'Ctrl+Shift+S', run: 'file.saveAs', enabled: hasEditor },
      { id: 'file.saveAll', label: 'Salvar Todos', run: 'file.saveAll', enabled: (c) => (c?.openCount || 0) > 0 },
      SEP,
      { id: 'file.autoSave', label: 'Salvamento Automático', run: 'file.toggleAutoSave', checked: (c) => (ed(c).autoSave || 'off') !== 'off' },
      {
        id: 'file.preferences',
        label: 'Preferências',
        submenu: [
          { id: 'pref.menu.settings', label: 'Configurações', accel: 'Ctrl+,', run: 'pref.settings' },
          { id: 'pref.menu.shortcuts', label: 'Atalhos de Teclado', accel: 'Ctrl+K Ctrl+S', run: 'pref.shortcuts' },
          SEP,
          {
            id: 'pref.menu.theme',
            label: 'Tema',
            submenu: THEMES.map(([value, label, run]) => ({
              id: `pref.menu.theme.${value}`, label, run, checked: (c) => (c?.settings?.theme || 'agzos-dark') === value,
            })),
          },
          {
            id: 'pref.menu.iconTheme',
            label: 'Tema de Ícones',
            submenu: ICON_THEMES.map(([value, label, run]) => ({
              id: `pref.menu.icon.${value}`, label, run, checked: (c) => (c?.settings?.iconTheme || 'lucide-color') === value,
            })),
          },
          SEP,
          { id: 'pref.menu.import', label: 'Importar do VS Code / Cursor', run: 'pref.importVSCode' },
        ],
      },
      SEP,
      { id: 'file.revert', label: 'Reverter Arquivo', run: 'file.revert', enabled: (c) => !!c?.hasEditor && !c?.untitled },
      { id: 'file.closeEditor', label: 'Fechar Editor', accel: 'Ctrl+W', run: 'file.closeTab', enabled: hasEditor },
      { id: 'file.closeFolder', label: 'Fechar Pasta', run: 'file.closeFolder', enabled: hasWorkspace },
      { id: 'file.closeWindow', label: 'Fechar Janela', run: 'window.close' },
      SEP,
      { id: 'file.exit', label: 'Sair', accel: 'Ctrl+Q', run: 'app.quit' },
    ],
  },
  {
    id: 'edit',
    label: 'Editar',
    mnemonic: 'E',
    items: [
      monaco('edit.undo', 'Desfazer', 'undo', 'Ctrl+Z'),
      monaco('edit.redo', 'Refazer', 'redo', 'Ctrl+Y'),
      SEP,
      monaco('edit.cut', 'Recortar', 'editor.action.clipboardCutAction', 'Ctrl+X'),
      monaco('edit.copy', 'Copiar', 'editor.action.clipboardCopyAction', 'Ctrl+C'),
      monaco('edit.paste', 'Colar', 'editor.action.clipboardPasteAction', 'Ctrl+V'),
      SEP,
      { id: 'edit.find', label: 'Localizar', accel: 'Ctrl+F', run: 'editor.find', enabled: hasEditor },
      { id: 'edit.replace', label: 'Substituir', accel: 'Ctrl+H', run: 'editor.replace', enabled: hasEditor },
      SEP,
      { id: 'edit.findInFiles', label: 'Localizar nos Arquivos', accel: 'Ctrl+Shift+F', run: 'search.findInFiles' },
      soon('edit.replaceInFiles', 'Substituir nos Arquivos', 'A busca no projeto ainda não substitui'),
      SEP,
      monaco('edit.lineComment', 'Alternar Comentário de Linha', 'editor.action.commentLine', 'Ctrl+/'),
      monaco('edit.blockComment', 'Alternar Comentário de Bloco', 'editor.action.blockComment', 'Shift+Alt+A'),
      soon('edit.emmet', 'Expandir Abreviação Emmet', 'Emmet ainda não está integrado'),
    ],
  },
  {
    id: 'selection',
    label: 'Seleção',
    mnemonic: 'S',
    items: [
      monaco('selection.selectAll', 'Selecionar Tudo', 'editor.action.selectAll', 'Ctrl+A'),
      monaco('selection.expand', 'Expandir Seleção', 'editor.action.smartSelect.expand', 'Shift+Alt+→'),
      monaco('selection.shrink', 'Reduzir Seleção', 'editor.action.smartSelect.shrink', 'Shift+Alt+←'),
      SEP,
      monaco('selection.copyLineUp', 'Copiar Linha Acima', 'editor.action.copyLinesUpAction', { default: 'Shift+Alt+↑', linux: 'Ctrl+Shift+Alt+↑' }),
      monaco('selection.copyLineDown', 'Copiar Linha Abaixo', 'editor.action.copyLinesDownAction', { default: 'Shift+Alt+↓', linux: 'Ctrl+Shift+Alt+↓' }),
      monaco('selection.moveLineUp', 'Mover Linha Acima', 'editor.action.moveLinesUpAction', 'Alt+↑'),
      monaco('selection.moveLineDown', 'Mover Linha Abaixo', 'editor.action.moveLinesDownAction', 'Alt+↓'),
      monaco('selection.duplicate', 'Duplicar Seleção', 'editor.action.duplicateSelection'),
      SEP,
      monaco('selection.cursorAbove', 'Adicionar Cursor Acima', 'editor.action.insertCursorAbove', { default: 'Ctrl+Alt+↑', linux: 'Shift+Alt+↑' }),
      monaco('selection.cursorBelow', 'Adicionar Cursor Abaixo', 'editor.action.insertCursorBelow', { default: 'Ctrl+Alt+↓', linux: 'Shift+Alt+↓' }),
      monaco('selection.cursorsLineEnds', 'Adicionar Cursores aos Finais de Linha', 'editor.action.insertCursorAtEndOfEachLineSelected', 'Shift+Alt+I'),
      monaco('selection.addNext', 'Adicionar Próxima Ocorrência', 'editor.action.addSelectionToNextFindMatch', 'Ctrl+D'),
      monaco('selection.addPrevious', 'Adicionar Ocorrência Anterior', 'editor.action.addSelectionToPreviousFindMatch'),
      monaco('selection.selectAllOccurrences', 'Selecionar Todas as Ocorrências', 'editor.action.selectHighlights', 'Ctrl+Shift+L'),
      SEP,
      {
        id: 'selection.multiCursorCtrl', label: 'Alternar para Ctrl+Clique para Vários Cursores',
        run: 'editor.toggleMultiCursorModifier', checked: (c) => ed(c).multiCursorModifier === 'ctrlCmd',
      },
      {
        id: 'selection.columnMode', label: 'Modo de Seleção de Coluna',
        run: 'editor.toggleColumnSelection', checked: (c) => !!ed(c).columnSelection,
      },
    ],
  },
  {
    id: 'view',
    label: 'Ver',
    mnemonic: 'V',
    items: [
      { id: 'view.commandPalette', label: 'Paleta de Comandos…', accel: 'Ctrl+Shift+P', run: 'view.commandPalette' },
      soon('view.openView', 'Abrir Visualização…'),
      SEP,
      {
        id: 'view.appearance',
        label: 'Aparência',
        submenu: [
          { id: 'view.fullScreen', label: 'Tela Cheia', accel: 'F11', run: 'window.toggleFullScreen' },
          SEP,
          { id: 'view.sidebar', label: 'Barra Lateral', accel: 'Ctrl+B', run: 'view.toggleSidebar', checked: (c) => c?.sidebarVisible !== false },
          { id: 'view.panel', label: 'Painel', run: 'view.togglePanel', checked: (c) => !!c?.panelVisible },
          { id: 'view.statusBar', label: 'Barra de Status', run: 'view.toggleStatusBar', checked: (c) => c?.statusBarVisible !== false },
          { id: 'view.minimap', label: 'Minimap', run: 'view.toggleMinimap', checked: (c) => ed(c).minimap !== false },
          SEP,
          { id: 'view.zoomIn', label: 'Aumentar Zoom', accel: 'Ctrl+=', run: 'editor.zoomIn' },
          { id: 'view.zoomOut', label: 'Diminuir Zoom', accel: 'Ctrl+-', run: 'editor.zoomOut' },
          { id: 'view.zoomReset', label: 'Redefinir Zoom', accel: 'Ctrl+0', run: 'editor.zoomReset' },
        ],
      },
      soon('view.editorLayout', 'Layout do Editor', 'Dividir o editor ainda não é suportado'),
      SEP,
      { id: 'view.explorer', label: 'Explorer', accel: 'Ctrl+Shift+E', run: 'view.focusExplorer' },
      { id: 'view.search', label: 'Pesquisar', accel: 'Ctrl+Shift+F', run: 'search.findInFiles' },
      { id: 'view.scm', label: 'Controle do Código-Fonte', accel: 'Ctrl+Shift+G', run: 'view.focusGit' },
      soon('view.runView', 'Executar e Depurar'),
      { id: 'view.modules', label: 'Módulos Agzos', accel: 'Ctrl+Shift+X', run: 'view.focusModules' },
      { id: 'view.ai', label: 'Agzos IA', accel: 'Ctrl+Shift+A', run: 'view.focusAI' },
      soon('view.browser', 'Navegador'),
      SEP,
      { id: 'view.problems', label: 'Problemas', run: 'view.problems' },
      { id: 'view.output', label: 'Saída', run: 'view.output' },
      soon('view.debugConsole', 'Console de Depuração'),
      { id: 'view.terminal', label: 'Terminal', accel: 'Ctrl+`', run: 'view.showTerminal' },
      { id: 'view.ports', label: 'Portas', run: 'ports.refresh' },
      SEP,
      { id: 'view.wordWrap', label: 'Quebra Automática de Linha', accel: 'Alt+Z', run: 'editor.toggleWordWrap', checked: (c) => ed(c).wordWrap === 'on' },
    ],
  },
  {
    id: 'go',
    label: 'Ir',
    mnemonic: 'I',
    items: [
      soon('go.back', 'Voltar', 'Histórico de navegação ainda não existe'),
      soon('go.forward', 'Avançar', 'Histórico de navegação ainda não existe'),
      soon('go.lastEdit', 'Último Local de Edição', 'Histórico de navegação ainda não existe'),
      SEP,
      {
        id: 'go.switchEditor',
        label: 'Alternar Editor',
        submenu: [
          { id: 'go.nextEditor', label: 'Próximo Editor', run: 'editor.nextTab', enabled: (c) => (c?.openCount || 0) > 1 },
          { id: 'go.previousEditor', label: 'Editor Anterior', run: 'editor.prevTab', enabled: (c) => (c?.openCount || 0) > 1 },
        ],
      },
      SEP,
      { id: 'go.file', label: 'Ir para Arquivo…', accel: 'Ctrl+P', run: 'go.quickOpen' },
      soon('go.workspaceSymbol', 'Ir para Símbolo no Workspace…', 'Requer um servidor de linguagem (LSP)'),
      SEP,
      monaco('go.symbol', 'Ir para Símbolo no Editor…', 'editor.action.quickOutline', 'Ctrl+Shift+O'),
      monaco('go.definition', 'Ir para Definição', 'editor.action.revealDefinition', 'F12'),
      monaco('go.declaration', 'Ir para Declaração', 'editor.action.revealDeclaration'),
      monaco('go.typeDefinition', 'Ir para Definição de Tipo', 'editor.action.goToTypeDefinition'),
      monaco('go.implementation', 'Ir para Implementações', 'editor.action.goToImplementation', 'Ctrl+F12'),
      monaco('go.references', 'Ir para Referências', 'editor.action.goToReferences', 'Shift+F12'),
      SEP,
      { id: 'go.line', label: 'Ir para Linha/Coluna…', accel: 'Ctrl+G', run: 'editor.gotoLine', enabled: hasEditor },
      monaco('go.bracket', 'Ir para Colchete', 'editor.action.jumpToBracket', 'Ctrl+Shift+\\'),
      SEP,
      monaco('go.nextProblem', 'Próximo Problema', 'editor.action.marker.nextInFiles', 'F8'),
      monaco('go.previousProblem', 'Problema Anterior', 'editor.action.marker.prevInFiles', 'Shift+F8'),
      soon('go.nextChange', 'Próxima Alteração', 'Marcadores de alteração (git) no editor ainda não existem'),
      soon('go.previousChange', 'Alteração Anterior', 'Marcadores de alteração (git) no editor ainda não existem'),
    ],
  },
  {
    id: 'run',
    label: 'Executar',
    mnemonic: 'X',
    items: [
      { id: 'run.activeFile', label: 'Executar Arquivo Ativo no Terminal', run: 'run.activeFile', enabled: hasEditor },
      SEP,
      soon('run.startDebugging', 'Iniciar Depuração', 'O Agzos Code ainda não tem depurador'),
      soon('run.withoutDebugging', 'Executar Sem Depuração', 'O Agzos Code ainda não tem depurador'),
      soon('run.stopDebugging', 'Parar Depuração'),
      soon('run.restartDebugging', 'Reiniciar Depuração'),
      SEP,
      soon('run.openConfigurations', 'Abrir Configurações de Depuração'),
      soon('run.addConfiguration', 'Adicionar Configuração…'),
      SEP,
      soon('run.stepOver', 'Depuração Parcial'),
      soon('run.stepInto', 'Intervir'),
      soon('run.stepOut', 'Sair da Função'),
      soon('run.continue', 'Continuar'),
      SEP,
      soon('run.toggleBreakpoint', 'Alternar Ponto de Interrupção'),
      soon('run.newBreakpoint', 'Novo Ponto de Interrupção'),
      soon('run.enableBreakpoints', 'Habilitar Todos os Pontos de Interrupção'),
      soon('run.disableBreakpoints', 'Desabilitar Todos os Pontos de Interrupção'),
      soon('run.removeBreakpoints', 'Remover Todos os Pontos de Interrupção'),
      SEP,
      soon('run.installDebuggers', 'Instalar Depuradores Adicionais…'),
    ],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    mnemonic: 'T',
    items: [
      { id: 'terminal.menu.new', label: 'Novo Terminal', accel: 'Ctrl+Shift+`', run: 'terminal.new' },
      { id: 'terminal.menu.split', label: 'Dividir Terminal', accel: 'Ctrl+Shift+5', run: 'terminal.split' },
      soon('terminal.menu.newWindow', 'Nova Janela de Terminal', 'Terminal em janela própria ainda não existe'),
      SEP,
      { id: 'terminal.menu.runTask', label: 'Executar Tarefa…', run: 'task.run' },
      { id: 'terminal.menu.runBuildTask', label: 'Executar Tarefa de Build…', accel: 'Ctrl+Shift+B', run: 'task.build' },
      { id: 'terminal.menu.runActiveFile', label: 'Executar Arquivo Ativo', run: 'run.activeFile', enabled: hasEditor },
      { id: 'terminal.menu.runSelection', label: 'Executar Texto Selecionado', run: 'terminal.runSelection', enabled: hasEditor },
      SEP,
      soon('terminal.menu.showTasks', 'Mostrar Tarefas em Execução…'),
      soon('terminal.menu.restartTask', 'Reiniciar Tarefa em Execução…'),
      soon('terminal.menu.terminateTask', 'Encerrar Tarefa…'),
      SEP,
      soon('terminal.menu.configureTasks', 'Configurar Tarefas…', 'tasks.json ainda não é suportado'),
    ],
  },
  {
    id: 'help',
    label: 'Ajuda',
    mnemonic: 'U',
    items: [
      { id: 'help.menu.welcome', label: 'Boas-vindas', run: 'help.welcome' },
      { id: 'help.menu.allCommands', label: 'Mostrar Todos os Comandos', accel: 'Ctrl+Shift+P', run: 'view.commandPalette' },
      { id: 'help.menu.docs', label: 'Documentação', run: 'help.docs' },
      { id: 'help.menu.releaseNotes', label: 'Notas da Versão', run: 'help.releaseNotes' },
      SEP,
      { id: 'help.menu.shortcuts', label: 'Referência de Atalhos de Teclado', accel: 'Ctrl+K Ctrl+S', run: 'pref.shortcuts' },
      SEP,
      { id: 'help.menu.reportIssue', label: 'Relatar Problema', run: 'help.reportIssue' },
      SEP,
      { id: 'help.menu.license', label: 'Ver Licença', run: 'help.license' },
      { id: 'help.menu.privacy', label: 'Declaração de Privacidade', run: 'help.privacy' },
      SEP,
      { id: 'help.menu.devtools', label: 'Alternar Ferramentas de Desenvolvedor', accel: 'Ctrl+Shift+I', run: 'window.devtools' },
      SEP,
      { id: 'help.menu.updates', label: 'Verificar Atualizações…', run: 'help.checkUpdates' },
      SEP,
      { id: 'help.menu.about', label: 'Sobre o Agzos Code', run: 'help.about' },
    ],
  },
];

/** Procura um item (ou menu) por id em qualquer nível. */
export function findItem(menus, id) {
  const stack = [...menus];
  while (stack.length) {
    const it = stack.shift();
    if (it.id === id) return it;
    if (Array.isArray(it.items)) stack.push(...it.items);
    if (Array.isArray(it.submenu)) stack.push(...it.submenu);
  }
  return null;
}

/** Todos os itens (não separadores) de todos os níveis. */
export function allItems(menus = MENUS) {
  const out = [];
  const walk = (items) => {
    for (const it of items) {
      if (it.type === 'separator') continue;
      out.push(it);
      if (Array.isArray(it.submenu)) walk(it.submenu);
    }
  };
  for (const m of menus) walk(m.items);
  return out;
}

const isLetter = (ch) => /\p{L}/u.test(ch);

/**
 * Mnemônicos por nível: Map(item → { letter, index }). Prefere a inicial de cada
 * palavra (na ordem), depois qualquer letra do label. Letras já usadas e letras
 * acentuadas (ç, ã…) são puladas. Separadores ficam de fora.
 */
export function mnemonicsFor(items) {
  const used = new Set();
  const map = new Map();
  for (const item of items) {
    if (!item || item.type === 'separator' || !item.label) continue;
    const label = item.label;
    const candidates = [];
    for (let i = 0; i < label.length; i++) {
      if (isLetter(label[i]) && (i === 0 || !isLetter(label[i - 1]))) candidates.push(i);
    }
    for (let i = 0; i < label.length; i++) if (isLetter(label[i]) && !candidates.includes(i)) candidates.push(i);
    for (const i of candidates) {
      const letter = label[i].toLowerCase();
      if (!/^[a-z]$/.test(letter) || used.has(letter)) continue;
      used.add(letter);
      map.set(item, { letter, index: i });
      break;
    }
  }
  return map;
}

/** Próximo índice selecionável (pula separadores), circular. from=-1 começa do início. */
export function nextIndex(items, from, dir = 1) {
  const n = items.length;
  if (!n) return -1;
  let i = from;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    if (items[i] && items[i].type !== 'separator') return i;
  }
  return -1;
}

/** Texto do atalho por plataforma. accel: string ou { default, linux, win32, darwin }. */
export function resolveAccel(accel, platform) {
  if (!accel) return '';
  if (typeof accel === 'string') return accel;
  return accel[platform] || accel.default || '';
}

export function accelLabel(accel, isMac = false) {
  if (!accel) return '';
  return isMac ? accel.replace(/\bCtrl\b/g, '⌘') : accel;
}
