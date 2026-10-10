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
let languageByExt = null;
let saveHandler = null;

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
  activeEditor = monaco.editor.create(host, {
    value: '',
    language: 'plaintext',
    theme: themeIdToMonaco(State.settings.theme),
    automaticLayout: true,
    minimap: { enabled: true, scale: 1, renderCharacters: false },
    fontSize: State.settings.fontSize,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: 'active' },
    padding: { top: 12, bottom: 12 },
    tabSize: 2,
    wordWrap: 'off',
  });

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
  });

  // Ctrl+S → salvar
  saveHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
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
  const file = State.files.get(State.activePath);
  if (!file) return;
  const content = activeEditor.getValue();
  try {
    await window.agzos.fs.writeFile(State.activePath, content);
    file.content = content;
    file.dirty = false;
    file.mtime = Date.now();
    renderTabs();
    toast(`Salvo: ${basename(State.activePath)}`, 'success', 1800);
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
