/**
 * Editor — wrapper sobre o Monaco Editor.
 *
 * Estratégia: usar o loader AMD oficial do Monaco via require()
 * (carregado do node_modules com file:// no Electron).
 */

import { toast } from './toast.js';
import { renderTabs, focusTab } from './tabs.js';

const State = window.AgzosState;

let monacoLoaded = null;
let monaco = null;
let activeEditor = null;
let currentModel = null;
let saveHandler = null;
const autoSaveTimers = new Map(); // path -> timeout (afterDelay)

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
        if (State.files.get(path)?.dirty) saveFile(path);
      }, Number(State.settings.editor?.autoSaveDelay) || 1000));
    }
  });

  activeEditor.onDidBlurEditorWidget(() => {
    if (State.settings.editor?.autoSave === 'onFocusChange' && State.files.get(State.activePath)?.dirty) {
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
export async function openFile(filePath, contentOverride) {
  let file = State.files.get(filePath);
  if (!file) {
    try {
      const { content, size, mtime } = contentOverride
        ? { content: contentOverride, size: 0, mtime: 0 }
        : await window.agzos.fs.readFile(filePath);
      file = { path: filePath, content, size, mtime, dirty: false };
      State.files.set(filePath, file);
    } catch (e) {
      toast(`Não foi possível abrir: ${e.message}`, 'error');
      return;
    }
  }
  State.activePath = filePath;
  setModel(file);
  renderTabs();
  syncEditorWelcome();
  focusTab(filePath);
  document.getElementById('welcome').style.display = 'none';
  // Atualiza título da janela
  document.title = `${basename(filePath)} — Agzos Code`;
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
  await saveFile(State.activePath);
}

/**
 * Salva um arquivo aberto. Se for o ativo, usa o conteúdo do editor (e formata
 * se formatOnSave); senão, o conteúdo guardado em State.files.
 */
export async function saveFile(filePath) {
  const file = State.files.get(filePath);
  if (!file) return;
  const isActive = filePath === State.activePath && !!activeEditor && !!currentModel;
  if (isActive && State.settings.editor?.formatOnSave) {
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
    renderTabs();
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
  syncEditorWelcome();
  if (State.activePath === filePath) {
    State.activePath = null;
    const remaining = [...State.files.keys()];
    if (remaining.length > 0) {
      await openFile(remaining[remaining.length - 1]);
    } else {
      activeEditor.setModel(monaco.editor.createModel('', 'plaintext'));
      document.getElementById('welcome').style.display = '';
      document.title = 'Agzos Code';
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
  });
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
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}
