/**
 * Comandos novos da barra de menus. Ficam na paleta (registerCommands), então
 * menu, paleta e atalhos (app.js → runCommand) chamam a mesma função.
 */

import { registerCommands, runCommand, showCommandPalette, showQuickOpen, showPicker, invalidateQuickOpenCache } from './command-palette.js';
import { toast } from './toast.js';
import { runFileCommand, parseScripts, npmRunCommand, RUNNABLE_EXTENSIONS } from './task-utils.js';

const State = window.AgzosState;

export const REPO_URL = 'https://github.com/rodrigoazevedo1988/agzos-code';

const editorMod = () => import('./editor.js');
const terminalMod = () => import('./terminal.js');

async function saveSettings() {
  await window.agzos.settings.save(State.settings);
}

async function setEditorOption(key, value) {
  State.settings.editor = State.settings.editor || {};
  State.settings.editor[key] = value;
  await saveSettings();
  (await editorMod()).applyEditorSettings(State.settings.editor);
}

function sep() {
  return State.platform === 'win32' ? '\\' : '/';
}

/* -------------------------------------------------------------------------- */
/*  Arquivo                                                                    */
/* -------------------------------------------------------------------------- */
// Cria um arquivo na pasta aberta (aceita subpastas: "src/novo.js").
async function newFileInFolder() {
  const root = State.workspaceRoot;
  if (!root) { toast('Abra uma pasta primeiro.', 'error'); return; }
  const { openGitDialog } = await import('./git-dialog.js');
  const created = await openGitDialog({
    id: 'new-file-dialog',
    title: 'Novo Arquivo',
    description: 'Caminho relativo à pasta aberta.',
    icon: 'file-plus',
    submitLabel: 'Criar',
    fields: [{ name: 'name', label: 'Nome do arquivo', required: true, placeholder: 'ex.: src/index.js' }],
    onSubmit: async ({ name }) => {
      const rel = String(name).trim().replace(/^[\\/]+/, '');
      if (!rel || rel.split(/[\\/]/).includes('..')) throw new Error('Nome inválido.');
      const full = `${root.replace(/[\\/]+$/, '')}${sep()}${rel.split(/[\\/]/).join(sep())}`;
      if (await window.agzos.fs.exists(full)) throw new Error('Já existe um arquivo com esse nome.');
      const parent = full.slice(0, full.lastIndexOf(sep()));
      if (parent && parent !== root) await window.agzos.fs.mkdir(parent);
      await window.agzos.fs.writeFile(full, '');
      return full;
    },
  });
  if (!created) return;
  invalidateQuickOpenCache();
  (await import('./file-tree.js')).refreshTree();
  await (await editorMod()).openFile(created);
}

async function openRecent(folder) {
  if (!folder) return;
  const mod = await import('./file-tree.js');
  await mod.openWorkspace(folder);
  invalidateQuickOpenCache();
}

async function clearRecent() {
  const list = await window.agzos.workspace.clearRecent();
  State.settings.recentFolders = Array.isArray(list) ? list : [];
  toast('Lista de recentes limpa.', 'info', 1500);
}

async function saveAll() {
  const m = await editorMod();
  const dirty = [...State.files.entries()].filter(([p, f]) => f.dirty && !m.isUntitled(p)).map(([p]) => p);
  for (const p of dirty) await m.saveFile(p);
  if (!dirty.length) toast('Nada para salvar.', 'info', 1200);
}

async function toggleAutoSave() {
  const on = (State.settings.editor?.autoSave || 'off') !== 'off';
  await setEditorOption('autoSave', on ? 'off' : 'afterDelay');
  toast(`Salvamento automático: ${on ? 'desligado' : 'ligado'}`, 'info', 1200);
}

async function closeFolder() {
  const mod = await import('./file-tree.js');
  await mod.closeWorkspace();
}

/* -------------------------------------------------------------------------- */
/*  Ver                                                                        */
/* -------------------------------------------------------------------------- */
function switchView(view) {
  document.querySelector(`.activity-btn[data-view="${view}"]`)?.click();
}

function findInFiles() {
  switchView('search');
  setTimeout(() => document.getElementById('search-text')?.focus(), 50);
}

async function showBottomTab(name) {
  const m = await terminalMod();
  m.selectBottomTab(name, { focus: name === 'terminal' });
  m.setBottomPanelVisible(true);
}

async function togglePanel() {
  const m = await terminalMod();
  const panel = document.getElementById('bottom-panel');
  m.setBottomPanelVisible(!!panel?.hidden);
}

/** Aplica workbench.statusBarVisible na UI (boot e toggle). */
export function applyStatusBarVisibility() {
  const visible = State.settings.workbench?.statusBarVisible !== false;
  document.body.classList.toggle('statusbar-hidden', !visible);
}

async function toggleStatusBar() {
  State.settings.workbench = State.settings.workbench || {};
  State.settings.workbench.statusBarVisible = State.settings.workbench.statusBarVisible === false;
  applyStatusBarVisibility();
  await saveSettings();
}

/* -------------------------------------------------------------------------- */
/*  Ir                                                                         */
/* -------------------------------------------------------------------------- */
async function cycleTab(dir) {
  const paths = [...State.files.keys()];
  if (paths.length < 2) return;
  const i = Math.max(0, paths.indexOf(State.activePath));
  const next = paths[(i + dir + paths.length) % paths.length];
  (await editorMod()).openFile(next);
}

/* -------------------------------------------------------------------------- */
/*  Executar / Terminal                                                        */
/* -------------------------------------------------------------------------- */
async function runActiveFile() {
  const m = await editorMod();
  const p = State.activePath;
  if (!p) { toast('Abra um arquivo para executar.', 'error'); return; }
  if (m.isUntitled(p)) { toast('Salve o arquivo antes de executar.', 'error'); return; }
  const cmd = runFileCommand(p, State.platform);
  if (!cmd) {
    toast(`Não sei executar este tipo de arquivo. Suportados: ${RUNNABLE_EXTENSIONS.join(', ')}.`, 'error', 5000);
    return;
  }
  if (State.files.get(p)?.dirty) await m.saveFile(p);
  await (await terminalMod()).runInTerminal(cmd);
}

async function runSelection() {
  const editor = (await editorMod()).getActiveEditor();
  const model = editor?.getModel();
  if (!editor || !model || !State.activePath) return;
  const sel = editor.getSelection();
  // Sem seleção: linha do cursor (como no VS Code)
  const text = sel && !sel.isEmpty()
    ? model.getValueInRange(sel)
    : model.getLineContent(editor.getPosition().lineNumber);
  if (!text.trim()) { toast('Nada selecionado para executar.', 'info', 1500); return; }
  await (await terminalMod()).runInTerminal(text);
}

/** Scripts do package.json da raiz: [{ name, command }] ou null (com aviso). */
async function readRootScripts() {
  const root = State.workspaceRoot;
  if (!root) { toast('Abra uma pasta para executar tarefas.', 'error'); return null; }
  const pkgPath = `${root.replace(/[\\/]+$/, '')}${sep()}package.json`;
  if (!(await window.agzos.fs.exists(pkgPath))) {
    toast('Nenhum package.json na raiz da pasta aberta.', 'info', 4000);
    return null;
  }
  let scripts;
  try {
    const { content } = await window.agzos.fs.readFile(pkgPath);
    scripts = parseScripts(content);
  } catch (e) {
    toast(`Não foi possível ler o package.json: ${e.message}`, 'error');
    return null;
  }
  if (scripts === null) { toast('package.json inválido.', 'error'); return null; }
  if (!scripts.length) { toast('O package.json não tem scripts.', 'info', 4000); return null; }
  return scripts;
}

async function runScript(name) {
  await (await terminalMod()).runInTerminal(npmRunCommand(name), { newTerminal: true });
}

async function runTask() {
  const scripts = await readRootScripts();
  if (!scripts) return;
  showPicker({
    placeholder: 'Escolha a tarefa (npm run …)',
    items: scripts.map((s) => ({ label: s.name, hint: s.command, run: () => runScript(s.name) })),
  });
}

async function runBuildTask() {
  const scripts = await readRootScripts();
  if (!scripts) return;
  if (scripts.some((s) => s.name === 'build')) await runScript('build');
  else {
    toast('Sem script "build": escolha a tarefa.', 'info', 2000);
    await runTask();
  }
}

/* -------------------------------------------------------------------------- */
/*  Ajuda                                                                      */
/* -------------------------------------------------------------------------- */
const openUrl = (url) => () => window.agzos.app.openExternal(url);

/* -------------------------------------------------------------------------- */
/*  Ação do Monaco no editor ativo (itens 'monaco:<id>')                       */
/* -------------------------------------------------------------------------- */
export async function runMonacoAction(actionId) {
  const editor = (await editorMod()).getActiveEditor();
  if (!editor || !State.activePath) return false;
  editor.focus();
  const action = editor.getAction(actionId);
  if (action) await action.run();
  else editor.trigger('menu', actionId, null);
  return true;
}

export function setupMenuActions() {
  registerCommands([
    // Arquivo
    { id: 'file.newUntitled',     label: 'Arquivo: Novo Arquivo de Texto',          hint: 'Ctrl+N',       run: () => editorMod().then((m) => m.newUntitledFile()) },
    { id: 'file.newFileInFolder', label: 'Arquivo: Novo Arquivo na Pasta…',         run: newFileInFolder },
    { id: 'window.new',           label: 'Arquivo: Nova Janela',                    hint: 'Ctrl+Shift+N', run: () => window.agzos.window.newWindow() },
    { id: 'file.openRecent',      label: 'Arquivo: Abrir Recente…',                 run: (folder) => (folder ? openRecent(folder) : pickRecent()) },
    { id: 'file.clearRecent',     label: 'Arquivo: Limpar Recentes',                run: clearRecent },
    { id: 'file.saveAll',         label: 'Arquivo: Salvar Todos',                   run: saveAll },
    { id: 'file.toggleAutoSave',  label: 'Arquivo: Alternar Salvamento Automático', run: toggleAutoSave },
    { id: 'file.revert',          label: 'Arquivo: Reverter Arquivo',               run: () => editorMod().then((m) => m.revertFile()) },
    { id: 'file.closeFolder',     label: 'Arquivo: Fechar Pasta',                   run: closeFolder },
    { id: 'window.close',         label: 'Arquivo: Fechar Janela',                  run: () => window.agzos.window.close() },
    { id: 'app.quit',             label: 'Arquivo: Sair',                           hint: 'Ctrl+Q',       run: () => window.agzos.window.quit() },
    // Seleção
    { id: 'editor.toggleMultiCursorModifier', label: 'Seleção: Alternar Ctrl+Clique para Vários Cursores', run: () => setEditorOption('multiCursorModifier', State.settings.editor?.multiCursorModifier === 'ctrlCmd' ? 'alt' : 'ctrlCmd') },
    { id: 'editor.toggleColumnSelection',     label: 'Seleção: Alternar Modo de Seleção de Coluna',        run: () => setEditorOption('columnSelection', !State.settings.editor?.columnSelection) },
    // Ver
    { id: 'view.commandPalette',      label: 'Exibir: Paleta de Comandos',            hint: 'Ctrl+Shift+P', run: () => setTimeout(showCommandPalette, 0) },
    { id: 'window.toggleFullScreen',  label: 'Exibir: Alternar Tela Cheia',           hint: 'F11',          run: () => window.agzos.window.toggleFullScreen() },
    { id: 'view.togglePanel',         label: 'Exibir: Alternar Painel',               run: togglePanel },
    { id: 'view.toggleStatusBar',     label: 'Exibir: Alternar Barra de Status',      run: toggleStatusBar },
    { id: 'view.toggleMinimap',       label: 'Exibir: Alternar Minimap',              run: () => setEditorOption('minimap', State.settings.editor?.minimap === false) },
    { id: 'search.findInFiles',       label: 'Pesquisar: Localizar nos Arquivos',     hint: 'Ctrl+Shift+F', run: findInFiles },
    { id: 'view.problems',            label: 'Exibir: Problemas',                     run: () => showBottomTab('problems') },
    { id: 'view.output',              label: 'Exibir: Saída',                         run: () => showBottomTab('output') },
    { id: 'view.showTerminal',        label: 'Exibir: Terminal',                      run: () => showBottomTab('terminal') },
    // Ir
    { id: 'editor.nextTab',  label: 'Ir: Próximo Editor',       run: () => cycleTab(1) },
    { id: 'editor.prevTab',  label: 'Ir: Editor Anterior',      run: () => cycleTab(-1) },
    { id: 'go.quickOpen',    label: 'Ir: Ir para Arquivo…',     hint: 'Ctrl+P', run: () => setTimeout(showQuickOpen, 0) },
    // Executar / Terminal
    { id: 'run.activeFile',        label: 'Executar: Executar Arquivo Ativo no Terminal', run: runActiveFile },
    { id: 'terminal.runSelection', label: 'Terminal: Executar Texto Selecionado',         run: runSelection },
    { id: 'task.run',              label: 'Terminal: Executar Tarefa…',                   run: runTask },
    { id: 'task.build',            label: 'Terminal: Executar Tarefa de Build',           hint: 'Ctrl+Shift+B', run: runBuildTask },
    // Ajuda
    { id: 'help.welcome',       label: 'Ajuda: Boas-vindas',                 run: () => import('./welcome.js').then((m) => m.showWelcome()) },
    { id: 'help.docs',          label: 'Ajuda: Documentação',                run: openUrl(`${REPO_URL}#readme`) },
    { id: 'help.releaseNotes',  label: 'Ajuda: Notas da Versão',             run: openUrl(`${REPO_URL}/blob/main/CHANGELOG.md`) },
    { id: 'help.reportIssue',   label: 'Ajuda: Relatar Problema',            run: openUrl(`${REPO_URL}/issues/new`) },
    { id: 'help.license',       label: 'Ajuda: Ver Licença',                 run: openUrl(`${REPO_URL}/blob/main/LICENSE`) },
    { id: 'help.privacy',       label: 'Ajuda: Declaração de Privacidade',   run: () => import('./settings-modal.js').then((m) => m.openSettingsModal('privacy')) },
    { id: 'window.devtools',    label: 'Ajuda: Alternar Ferramentas de Desenvolvedor', hint: 'Ctrl+Shift+I', run: () => window.agzos.window.toggleDevTools() },
  ]);
}

async function pickRecent() {
  const s = await window.agzos.settings.load();
  const list = Array.isArray(s?.recentFolders) ? s.recentFolders : [];
  if (!list.length) { toast('Nenhuma pasta recente.', 'info', 1500); return; }
  showPicker({
    placeholder: 'Abrir pasta recente',
    items: list.map((p) => ({ label: p.split(/[\\/]/).filter(Boolean).pop() || p, hint: p, run: () => openRecent(p) })),
  });
}

export { runCommand };
