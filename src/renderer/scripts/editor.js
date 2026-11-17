/**
 * Editor — wrapper sobre o Monaco Editor.
 *
 * Estratégia: usar o loader AMD oficial do Monaco via require()
 * (carregado do node_modules com file:// no Electron).
 */

import { toast } from './toast.js';
import { renderTabs, focusTab } from './tabs.js';
import { detectViewer, isViewerKind } from './viewers/detect.js';
import { showViewer, hideViewer } from './viewers/index.js';

const State = window.AgzosState;

let monacoLoaded = null;
let monaco = null;
let activeEditor = null;
let currentModel = null;
let saveHandler = null;
const autoSaveTimers = new Map(); // path -> timeout (afterDelay)
let applyingExternal = false; // recarga vinda do disco: não marca a aba como suja
const conflicts = new Set(); // arquivos sujos alterados por fora (agente)
let formatOnSaveCheck = () => false; // Agzos Formatador: formatar ao salvar por linguagem

// Workers: o loader AMD do Monaco resolve vs/base/worker/workerMain.js sozinho.
// Apontar direto para tsWorker.js/jsonWorker.js quebra (são módulos AMD: "define is not defined").

/* --------------------------------------------------------------------------
   Loader
   -------------------------------------------------------------------------- */
function loadMonaco() {
  if (monacoLoaded) return monacoLoaded;
  monacoLoaded = new Promise((resolve, reject) => {
    // O caminho é relativo ao index.html. Como o Electron resolve
    // `node_modules` no contexto do renderer (não por padrão),
    // usamos o atalho: copiar/copiar-vincular os assets Monaco
    // para dentro de `src/renderer/vendor/monaco` via script de postinstall.
    // Para o caminho aqui, esperamos o loader oficial AMD.
    const loaderScript = document.createElement('script');
    loaderScript.src = 'vendor/monaco/vs/loader.js';
    loaderScript.onload = () => {
      window.require.config({ paths: { vs: 'vendor/monaco/vs' } });
      window.require(['vs/editor/editor.main'], () => {
        monaco = window.monaco;
        // Tema Agzos Dark
        monaco.editor.defineTheme('agzos-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '6A6A6A', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'D10A11' },
            { token: 'string', foreground: '9ECE6A' },
            { token: 'number', foreground: 'FF9E64' },
            { token: 'type', foreground: '7DCFFF' },
            { token: 'function', foreground: '7AA2F7' },
          ],
          colors: {
            'editor.background': '#0E0E0E',
            'editor.foreground': '#E8E8E8',
            'editorLineNumber.foreground': '#5A5A5A',
            'editorLineNumber.activeForeground': '#D10A11',
            'editor.selectionBackground': '#D10A1133',
            'editor.lineHighlightBackground': '#181818',
            'editorCursor.foreground': '#D10A11',
            'editorIndentGuide.background1': '#1F1F1F',
            'editorBracketMatch.background': '#2A2A2A',
            'editorWidget.background': '#181818',
            'editorWidget.border': '#2E2E2E',
            'editorSuggestWidget.background': '#181818',
            'editorSuggestWidget.border': '#2E2E2E',
            'editorSuggestWidget.selectedBackground': '#D10A11',
            'scrollbarSlider.background': '#2E2E2E80',
            'scrollbarSlider.hoverBackground': '#3A3A3A',
            'scrollbarSlider.activeBackground': '#D10A11',
          },
        });
        monaco.editor.defineTheme('agzos-light', {
          base: 'vs',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '888888', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'D10A11' },
            { token: 'string', foreground: '2E7D32' },
          ],
          colors: {
            'editor.background': '#FFFFFF',
            'editor.foreground': '#1A1A1A',
            'editorLineNumber.foreground': '#999999',
            'editorLineNumber.activeForeground': '#D10A11',
            'editorCursor.foreground': '#D10A11',
            'editor.selectionBackground': '#D10A1122',
          },
        });
        resolve(monaco);
      });
    };
    loaderScript.onerror = () => reject(new Error('Falha ao carregar Monaco. Rode `npm run setup:monaco` ou copie os assets para src/renderer/vendor/monaco.'));
    document.head.appendChild(loaderScript);
  });
  return monacoLoaded;
}

/* --------------------------------------------------------------------------
   Setup do editor
   -------------------------------------------------------------------------- */
export async function setupEditor() {
  monaco = await loadMonaco();
  const host = document.getElementById('editor-host');
  // Mantém o #welcome (estado vazio) ao recriar o editor
  [...host.children].filter((el) => el.id !== 'welcome').forEach((el) => el.remove());
  const edCfg = State.settings.editor || {};
  activeEditor = monaco.editor.create(host, {
    value: '',
    language: 'plaintext',
    theme: themeIdToMonaco(State.settings.theme),
    automaticLayout: true,
    minimap: { enabled: edCfg.minimap !== false, scale: 1, renderCharacters: false },
    fontSize: State.settings.fontSize || 14,
    fontFamily: edCfg.fontFamily || 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
    lineNumbers: edCfg.lineNumbers || 'on',
    renderWhitespace: edCfg.renderWhitespace || 'selection',
    scrollBeyondLastLine: false,
    smoothScrolling: edCfg.smoothScrolling !== false,
    cursorBlinking: edCfg.cursorBlinking || 'smooth',
    cursorSmoothCaretAnimation: edCfg.cursorSmoothCaretAnimation || 'on',
    bracketPairColorization: { enabled: edCfg.bracketPairColorization !== false },
    guides: { indentation: true, bracketPairs: 'active' },
    padding: { top: 12, bottom: 12 },
    tabSize: Number(edCfg.tabSize) || 2,
    insertSpaces: edCfg.insertSpaces !== false,
    wordWrap: edCfg.wordWrap || 'off',
    wordWrapColumn: Number(edCfg.wordWrapColumn) || 80,
    columnSelection: !!edCfg.columnSelection,
    multiCursorModifier: edCfg.multiCursorModifier === 'ctrlCmd' ? 'ctrlCmd' : 'alt',
  });

  const aiActions = [
    ['explain', 'Explicar', 'Explique o código selecionado de forma objetiva.'],
    ['refactor', 'Refatorar', 'Refatore o código selecionado mantendo o comportamento. Responda só com o código final em um bloco.'],
    ['document', 'Documentar', 'Adicione comentários de documentação ao código selecionado. Responda só com o código final em um bloco.'],
    ['tests', 'Gerar testes', 'Escreva testes para o código selecionado.'],
  ];
  aiActions.forEach(([id, label, prompt], index) => activeEditor.addAction({
    id: `agzos-ai.${id}`, label: `Agzos IA: ${label}`, contextMenuGroupId: 'agzos-ai', contextMenuOrder: index,
    run: async () => {
      const { captureAITarget, setAITarget } = await import('./ai-apply.js');
      const { sendToChat, focusChat } = await import('./ai-chat.js');
      setAITarget(captureAITarget());
      sendToChat(prompt, { includeSelection: true });
      focusChat();
    },
  }));

  // Status bar: posição do cursor
  activeEditor.onDidChangeCursorPosition((e) => {
    document.getElementById('status-pos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });
  // Status bar: linguagem
  activeEditor.onDidChangeModelLanguage((e) => {
    document.getElementById('status-lang').textContent = langLabel(e.newLanguage);
  });

  // Detectar mudanças → marca tab como dirty
  activeEditor.onDidChangeModelContent(() => {
    if (applyingExternal) return;
    if (currentModel && State.activePath) {
      const file = State.files.get(State.activePath);
      if (file) {
        file.content = activeEditor.getValue();
        file.dirty = true;
        renderTabs();
      }
    }
    if (State.settings.editor?.autoSave === 'afterDelay' && State.activePath) {
      // Captura o arquivo agora: se o usuário trocar de aba, salva ESTE arquivo
      const path = State.activePath;
      clearTimeout(autoSaveTimers.get(path));
      autoSaveTimers.set(path, setTimeout(() => {
        autoSaveTimers.delete(path);
        if (State.files.get(path)?.dirty && !isUntitled(path)) saveFile(path);
      }, Number(State.settings.editor?.autoSaveDelay) || 1000));
    }
  });

  activeEditor.onDidBlurEditorWidget(() => {
    if (State.settings.editor?.autoSave === 'onFocusChange' && State.files.get(State.activePath)?.dirty && !isUntitled(State.activePath)) {
      saveActive();
    }
  });

  // Chords Ctrl+K … com foco no Monaco: registrados no próprio editor para não
  // brigar com os chords nativos (Ctrl+K Ctrl+C etc.). Fora dele: app.js.
  const { KeyMod, KeyCode } = monaco;
  activeEditor.addCommand(KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyW), () => { closeAllTabs(); });
  activeEditor.addCommand(KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyS), () => {
    import('./command-palette.js').then((m) => m.showShortcutsModal());
  });

  // Ctrl+S → salvar (ignora se o Monaco já consumiu, ex.: Ctrl+K Ctrl+S)
  saveHandler = (e) => {
    if (e.defaultPrevented) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
      e.preventDefault();
      saveActive();
    }
  };
  document.addEventListener('keydown', saveHandler);
}

/* --------------------------------------------------------------------------
   Abrir / criar arquivos
   -------------------------------------------------------------------------- */
/**
 * Abre (ou ativa) um arquivo. Roteia pelo tipo: texto vai para o Monaco;
 * imagem/vídeo/áudio/PDF/planilha/binário viram aba de visualização (sem modelo).
 * opts.as === 'text' força o editor de texto (ex.: "Abrir como texto" no SVG/CSV).
 */
export async function openFile(filePath, contentOverride, opts = {}) {
  if (contentOverride && typeof contentOverride === 'object') {
    opts = contentOverride;
    contentOverride = undefined;
  }
  const asText = opts.as === 'text';
  let file = State.files.get(filePath);
  if (file && asText && file.preview) file.preview = false;
  if (file && asText && file.viewer) {
    // Converte a aba de visualização em texto mantendo a posição da aba.
    try {
      const loaded = await loadFile(filePath, undefined, true);
      delete file.viewer;
      Object.assign(file, loaded);
    } catch (e) {
      toast(`Não foi possível abrir como texto: ${e.message}`, 'error');
      return;
    }
  }
  if (!file) {
    try {
      file = await loadFile(filePath, contentOverride, asText);
      State.files.set(filePath, file);
    } catch (e) {
      toast(`Não foi possível abrir: ${e.message}`, 'error');
      return;
    }
  }
  State.activePath = filePath;
  activate(file);
  renderTabs();
  syncEditorWelcome();
  focusTab(filePath);
  syncConflictBar();
  document.getElementById('welcome').style.display = 'none';
  // Atualiza título da janela
  document.title = `${basename(filePath)} — Agzos Code`;
  notifyActiveChanged();
}

async function loadFile(filePath, contentOverride, asText) {
  if (typeof contentOverride === 'string') return { path: filePath, content: contentOverride, size: 0, mtime: 0, dirty: false };
  const kind = asText ? 'text' : detectViewer(filePath);
  if (isViewerKind(kind)) {
    const st = await window.agzos.fs.stat(filePath);
    if (!st || !st.isFile) throw new Error('arquivo não encontrado');
    return { path: filePath, viewer: kind, size: st.size, mtime: st.mtime, dirty: false };
  }
  const res = await window.agzos.fs.readFile(filePath, asText ? undefined : { detectBinary: true });
  if (res.binary) return { path: filePath, viewer: 'binary', size: res.size, mtime: res.mtime, dirty: false };
  return { path: filePath, content: res.content, size: res.size, mtime: res.mtime, dirty: false };
}

const VIEWER_LABELS = {
  image: 'Imagem', video: 'Vídeo', audio: 'Áudio', pdf: 'PDF', sheet: 'Planilha', docx: 'Documento',
  external: 'Sem pré-visualização', binary: 'Binário', 'md-preview': 'Markdown (pré-visualização)',
};

const viewerCtx = {
  openAsText: (p) => openFile(p, undefined, { as: 'text' }),
  previewSide: (p) => openMarkdownPreview(p, 'side'),
  getText: (p) => State.files.get(p)?.content ?? '',
};

function activate(file) {
  if (file.viewer || file.preview) {
    if (currentModel) { currentModel.dispose(); currentModel = null; }
    activeEditor?.setModel(null);
    const view = file.preview ? { ...file, viewer: 'md-preview' } : file;
    showViewer(view, viewerCtx);
    document.getElementById('status-lang').textContent = VIEWER_LABELS[view.viewer] || 'Visualização';
    return;
  }
  hideViewer();
  setModel(file);
}

function notifyActiveChanged() {
  const file = State.activePath ? State.files.get(State.activePath) : null;
  window.dispatchEvent(new CustomEvent('agzos:active-file-changed', { detail: { path: State.activePath, file } }));
}

export function isMarkdownPath(p) {
  return detectViewer(p) === 'markdown';
}

/**
 * Pré-visualização de Markdown: where = 'side' (painel ao lado, atualiza ao
 * digitar) ou 'tab' (substitui o editor na própria aba).
 */
export async function openMarkdownPreview(filePath = State.activePath, where = 'side') {
  if (!filePath || !isMarkdownPath(filePath)) {
    toast('A pré-visualização é para arquivos Markdown (.md).', 'info');
    return;
  }
  if (where === 'tab') {
    if (!State.files.has(filePath)) await openFile(filePath);
    const file = State.files.get(filePath);
    if (!file) return;
    file.preview = true;
    await openFile(filePath);
    return;
  }
  await openFile(filePath, undefined, { as: 'text' });
  window.dispatchEvent(new CustomEvent('agzos:md-preview-side', { detail: { path: filePath } }));
}

function setModel(file) {
  const lang = detectLanguage(file.path);
  if (currentModel) currentModel.dispose();
  currentModel = monaco.editor.createModel(file.content, lang);
  activeEditor.setModel(currentModel);
  document.getElementById('status-lang').textContent = langLabel(lang);
}

export async function saveActive() {
  if (!State.activePath) return;
  // Sem título: ainda não tem caminho no disco → Salvar Como
  if (isUntitled(State.activePath)) {
    const { saveFileAs } = await import('./command-palette.js');
    await saveFileAs();
    return;
  }
  await saveFile(State.activePath);
}

/* --------------------------------------------------------------------------
   Arquivos sem título (Arquivo › Novo Arquivo de Texto)
   -------------------------------------------------------------------------- */
const UNTITLED_PREFIX = 'untitled:';

export function isUntitled(p) {
  return typeof p === 'string' && p.startsWith(UNTITLED_PREFIX);
}

/** Abre uma aba "Sem título-N" vazia (salvar pede o caminho). */
export async function newUntitledFile() {
  let n = 1;
  while (State.files.has(`${UNTITLED_PREFIX}Sem título-${n}`)) n++;
  const p = `${UNTITLED_PREFIX}Sem título-${n}`;
  await openFile(p, '');
  activeEditor?.focus();
  return p;
}

/** Tira o arquivo das abas sem perguntar (ex.: sem título já salvo em outro caminho). */
export function discardFile(filePath) {
  if (!State.files.has(filePath)) return;
  State.files.delete(filePath);
  if (conflicts.delete(filePath)) syncConflictBar();
  if (State.activePath === filePath) State.activePath = null;
  renderTabs();
}

/** Recarrega do disco descartando as alterações (pede confirmação se sujo). */
export async function revertFile(filePath = State.activePath) {
  if (!filePath || isUntitled(filePath) || !State.files.has(filePath)) return false;
  const file = State.files.get(filePath);
  if (file.dirty && !confirm(`Descartar as alterações de ${basename(filePath)} e recarregar do disco?`)) return false;
  const res = await handleExternalChange(filePath, { force: true });
  if (res === 'missing') toast('O arquivo não existe mais no disco.', 'error');
  return res !== 'missing';
}

/**
 * Salva um arquivo aberto. Se for o ativo, usa o conteúdo do editor (e formata
 * se formatOnSave); senão, o conteúdo guardado em State.files.
 */
export async function saveFile(filePath) {
  const file = State.files.get(filePath);
  // Abas de visualização não têm texto: nunca escrever nada no arquivo.
  if (!file || file.viewer) return;
  const isActive = filePath === State.activePath && !!activeEditor && !!currentModel;
  if (isActive && (State.settings.editor?.formatOnSave || formatOnSaveCheck(currentModel))) {
    try {
      await activeEditor.getAction('editor.action.formatDocument')?.run();
    } catch { }
  }
  const stillActive = isActive && filePath === State.activePath;
  const content = stillActive ? activeEditor.getValue() : file.content;
  try {
    await window.agzos.fs.writeFile(filePath, content);
    // Só limpa o dirty se nada mudou durante a escrita
    if (file.content === content) file.dirty = false;
    file.mtime = Date.now();
    if (conflicts.delete(filePath)) syncConflictBar();
    renderTabs();
    window.dispatchEvent(new CustomEvent('agzos:file-saved', { detail: { path: filePath } }));
    toast(`Salvo: ${basename(filePath)}`, 'success', 1800);
  } catch (e) {
    toast(`Erro ao salvar: ${e.message}`, 'error');
  }
}

export async function closeTab(filePath) {
  const file = State.files.get(filePath);
  if (file?.dirty) {
    if (!confirm(`${basename(filePath)} tem mudanças não salvas. Fechar?`)) return;
  }
  // Dispose do model se for o ativo
  if (State.activePath === filePath && currentModel) {
    currentModel.dispose();
    currentModel = null;
  }
  State.files.delete(filePath);
  if (conflicts.delete(filePath)) syncConflictBar();
  syncEditorWelcome();
  window.dispatchEvent(new CustomEvent('agzos:tab-closed', { detail: { path: filePath } }));
  if (State.activePath === filePath) {
    State.activePath = null;
    hideViewer();
    const remaining = [...State.files.keys()];
    if (remaining.length > 0) {
      await openFile(remaining[remaining.length - 1]);
    } else {
      activeEditor.setModel(monaco.editor.createModel('', 'plaintext'));
      document.getElementById('welcome').style.display = '';
      document.title = 'Agzos Code';
      notifyActiveChanged();
    }
  }
  renderTabs();
}

/**
 * Fecha todos os editores. Arquivos sujos pedem confirmação (como closeTab);
 * os recusados continuam abertos. Fecha os inativos primeiro para não
 * reabrir modelos à toa.
 */
export async function closeAllTabs() {
  const paths = [...State.files.keys()];
  const ordered = [...paths.filter((p) => p !== State.activePath), ...paths.filter((p) => p === State.activePath)];
  for (const p of ordered) {
    if (State.files.has(p)) await closeTab(p);
  }
}

// Welcome do editor só aparece sem arquivos abertos
function syncEditorWelcome() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.hidden = State.files.size > 0;
}

export function getActiveEditor() { return activeEditor; }

/** Módulos (Agzos Formatador) decidem se o modelo ativo é formatado ao salvar. fn(model) → boolean */
export function setFormatOnSaveCheck(fn) {
  formatOnSaveCheck = typeof fn === 'function' ? fn : () => false;
}
export function getMonaco() { return monaco; }

export function applyTheme(themeName) {
  if (!monaco) return;
  monaco.editor.setTheme(themeIdToMonaco(themeName));
  State.settings.theme = themeName;
  window.agzos.settings.save(State.settings);
}

export function applyFontSize(size) {
  if (!activeEditor) return;
  activeEditor.updateOptions({ fontSize: size });
  State.settings.fontSize = size;
  window.agzos.settings.save(State.settings);
}

export function applyEditorSettings(customSettings) {
  if (!activeEditor) return;
  const ed = { ...(State.settings.editor || {}), ...(customSettings || {}) };
  activeEditor.updateOptions({
    fontSize: State.settings.fontSize || 14,
    fontFamily: ed.fontFamily || 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
    tabSize: Number(ed.tabSize) || 2,
    insertSpaces: ed.insertSpaces !== false,
    wordWrap: ed.wordWrap || 'off',
    wordWrapColumn: Number(ed.wordWrapColumn) || 80,
    lineNumbers: ed.lineNumbers || 'on',
    minimap: { enabled: ed.minimap !== false, scale: 1, renderCharacters: false },
    renderWhitespace: ed.renderWhitespace || 'selection',
    bracketPairColorization: { enabled: ed.bracketPairColorization !== false },
    cursorBlinking: ed.cursorBlinking || 'smooth',
    cursorSmoothCaretAnimation: ed.cursorSmoothCaretAnimation || 'on',
    smoothScrolling: ed.smoothScrolling !== false,
    columnSelection: !!ed.columnSelection,
    multiCursorModifier: ed.multiCursorModifier === 'ctrlCmd' ? 'ctrlCmd' : 'alt',
  });
}

/* --------------------------------------------------------------------------
   Mudanças feitas por fora (agente da IA)
   -------------------------------------------------------------------------- */
const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

/** Caminho como está em State.files (aceita separadores diferentes; case-insensitive no Windows). */
function openPathFor(filePath) {
  if (State.files.has(filePath)) return filePath;
  const target = normPath(filePath);
  const win = /^[a-z]:/i.test(target);
  for (const key of State.files.keys()) {
    const k = normPath(key);
    if (k === target || (win && k.toLowerCase() === target.toLowerCase())) return key;
  }
  return null;
}

/**
 * Um arquivo mudou no disco por fora do editor (ex.: o agente editou).
 * Aberto e limpo → recarrega mantendo cursor/rolagem (e o Ctrl+Z desfaz a mudança).
 * Aberto e sujo → mantém o texto do usuário e mostra o aviso de conflito.
 * @returns {Promise<'closed'|'conflict'|'reloaded'|'same'|'missing'>}
 */
export async function handleExternalChange(filePath, { force = false } = {}) {
  const key = openPathFor(filePath);
  if (!key) return 'closed';
  const file = State.files.get(key);
  if (file.viewer) {
    // Aba de visualização: só recarrega a mídia (mtime novo fura o cache).
    const st = await window.agzos.fs.stat(key);
    if (!st) { await closeTab(key); return 'missing'; }
    file.size = st.size;
    file.mtime = st.mtime;
    if (key === State.activePath) activate(file);
    return 'reloaded';
  }
  if (file.dirty && !force) {
    conflicts.add(key);
    syncConflictBar();
    return 'conflict';
  }
  let disk;
  try {
    disk = await window.agzos.fs.readFile(key);
  } catch {
    // Apagado: fecha a aba se não houver nada a perder.
    if (!file.dirty) await closeTab(key);
    return 'missing';
  }
  const current = State.files.get(key);
  if (!current) return 'closed';
  if (current.dirty && !force) { conflicts.add(key); syncConflictBar(); return 'conflict'; }
  conflicts.delete(key);
  const changed = disk.content !== current.content;
  Object.assign(current, { content: disk.content, size: disk.size, mtime: disk.mtime, dirty: false });
  if (key === State.activePath && currentModel && activeEditor && currentModel.getValue() !== disk.content) {
    const view = activeEditor.saveViewState();
    applyingExternal = true;
    try {
      currentModel.pushEditOperations([], [{ range: currentModel.getFullModelRange(), text: disk.content }], () => null);
    } finally {
      applyingExternal = false;
    }
    if (view) activeEditor.restoreViewState(view);
  }
  renderTabs();
  syncConflictBar();
  return changed ? 'reloaded' : 'same';
}

function syncConflictBar() {
  const host = document.getElementById('editor-host');
  if (!host) return;
  let bar = document.getElementById('agent-conflict');
  const path = State.activePath && conflicts.has(State.activePath) ? State.activePath : null;
  if (!path) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'agent-conflict';
    bar.className = 'agent-conflict';
    bar.setAttribute('role', 'alert');
    host.append(bar);
  }
  const text = document.createElement('span');
  text.className = 'agent-conflict-text';
  text.textContent = `${basename(path)} foi alterado pelo agente, mas você tem mudanças não salvas aqui.`;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'agent-conflict-reload';
  reload.textContent = 'Usar a versão do disco';
  reload.addEventListener('click', () => handleExternalChange(path, { force: true }));
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'agent-conflict-keep';
  keep.textContent = 'Manter as minhas';
  keep.addEventListener('click', () => { conflicts.delete(path); syncConflictBar(); });
  bar.replaceChildren(text, reload, keep);
}

/** Linguagem do Monaco para um caminho (usado pelo diff do agente). */
export function languageForPath(filePath) {
  return detectLanguage(filePath);
}

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
function detectLanguage(filePath) {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    json: 'json', jsonc: 'json',
    md: 'markdown', mdx: 'markdown',
    html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
    css: 'css', scss: 'scss', less: 'less',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', php: 'php',
    sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', bat: 'bat',
    yml: 'yaml', yaml: 'yaml', toml: 'ini',
    sql: 'sql',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
    cs: 'csharp',
    vue: 'html', svelte: 'html',
    dockerfile: 'dockerfile',
  };
  return map[ext] || 'plaintext';
}

function langLabel(lang) {
  const m = {
    javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON',
    markdown: 'Markdown', html: 'HTML', css: 'CSS', scss: 'SCSS',
    python: 'Python', go: 'Go', rust: 'Rust', java: 'Java',
    shell: 'Shell', yaml: 'YAML', plaintext: 'Texto Simples',
  };
  return m[lang] || lang;
}

function themeIdToMonaco(name) {
  if (name === 'agzos-light') return 'agzos-light';
  return 'agzos-dark';
}

function basename(p) {
  if (!p) return '';
  if (isUntitled(p)) return p.slice(UNTITLED_PREFIX.length);
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}
