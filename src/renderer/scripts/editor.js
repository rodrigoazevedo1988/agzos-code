/**
 * Editor — wrapper sobre o Monaco Editor.
 *
 * Estratégia: usar o loader AMD oficial do Monaco via require()
 * (carregado de src/renderer/vendor/monaco).
 *
 * A partir da Fase 1.5 o editor carrega metadados de encoding/EOL/binário,
 * protege dirty ao fechar e preserva o conteúdo ao trocar de aba.
 */

import { toast } from './toast.js';
import { renderTabs, focusTab } from './tabs.js';

const State = window.AgzosState;

let monacoLoaded = null;
let monaco = null;
let activeEditor = null;
let currentModel = null;
let saveHandler = null;

const ENCODING_LABELS = {
  utf8: 'UTF-8',
  'windows-1252': 'Windows-1252',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  binary: 'Binário',
  unknown: 'Desconhecido',
};

/* --------------------------------------------------------------------------
   Loader
   -------------------------------------------------------------------------- */
function loadMonaco() {
  if (monacoLoaded) return monacoLoaded;
  monacoLoaded = new Promise((resolve, reject) => {
    const loaderScript = document.createElement('script');
    loaderScript.src = 'vendor/monaco/vs/loader.js';
    loaderScript.onload = () => {
      window.require.config({ paths: { vs: 'vendor/monaco/vs' } });
      window.require(['vs/editor/editor.main'], () => {
        monaco = window.monaco;
        defineThemes();
        resolve(monaco);
      });
    };
    loaderScript.onerror = () => reject(new Error('Falha ao carregar Monaco. Rode `npm run setup:vendor`.'));
    document.head.appendChild(loaderScript);
  });
  return monacoLoaded;
}

function defineThemes() {
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

  monaco.editor.defineTheme('monokai', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '75715E', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'F92672' },
      { token: 'string', foreground: 'E6DB74' },
      { token: 'number', foreground: 'AE81FF' },
      { token: 'type', foreground: '66D9EF' },
      { token: 'function', foreground: 'A6E22E' },
      { token: 'variable', foreground: 'FD971F' },
    ],
    colors: {
      'editor.background': '#272822',
      'editor.foreground': '#F8F8F2',
      'editorLineNumber.foreground': '#90908A',
      'editorLineNumber.activeForeground': '#F8F8F2',
      'editor.selectionBackground': '#49483E',
      'editor.lineHighlightBackground': '#3E3D32',
      'editorCursor.foreground': '#F8F8F0',
      'editorWidget.background': '#1E1F1C',
      'editorWidget.border': '#34352F',
    },
  });
}

/* --------------------------------------------------------------------------
   Setup do editor
   -------------------------------------------------------------------------- */
export async function setupEditor() {
  monaco = await loadMonaco();
  const host = document.getElementById('editor-host');
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

  activeEditor.onDidChangeCursorPosition((e) => {
    document.getElementById('status-pos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });
  activeEditor.onDidChangeModelLanguage((e) => {
    document.getElementById('status-lang').textContent = langLabel(e.newLanguage);
  });

  // Marca dirty uma única vez por transição. O conteúdo é persistido ao
  // trocar de aba/salvar, para não fazer getValue() a cada tecla.
  activeEditor.onDidChangeModelContent(() => {
    if (!currentModel || !State.activePath) return;
    const file = State.files.get(State.activePath);
    if (!file || file.readOnly) return;
    if (!file.dirty) {
      file.dirty = true;
      renderTabs();
    }
    updateWindowState();
  });

  saveHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveActive();
    }
  };
  document.addEventListener('keydown', saveHandler);
  updateWindowState();
}

/* --------------------------------------------------------------------------
   Abrir / criar arquivos
   -------------------------------------------------------------------------- */
export async function openFile(filePath, contentOverride) {
  if (State.activePath === filePath && currentModel) {
    renderTabs();
    focusTab(filePath);
    return;
  }

  // Persiste o buffer atual antes de trocar o modelo.
  persistActiveContent();

  let file = State.files.get(filePath);
  if (!file) {
    try {
      const meta = contentOverride
        ? { content: contentOverride, size: 0, mtime: 0, encoding: 'utf8', eol: 'LF', binary: false, readOnly: false, bom: false }
        : await window.agzos.fs.readFile(filePath);
      file = { path: filePath, ...meta, dirty: false };
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
  updateWindowState();
}

function setModel(file) {
  const lang = detectLanguage(file.path);
  if (currentModel) currentModel.dispose();
  currentModel = monaco.editor.createModel(file.content, lang);
  if (file.eol === 'CRLF') {
    currentModel.setEOL(monaco.editor.EndOfLineSequence.CRLF);
  } else if (file.eol === 'LF') {
    currentModel.setEOL(monaco.editor.EndOfLineSequence.LF);
  }
  activeEditor.setModel(currentModel);
  activeEditor.updateOptions({ readOnly: !!file.readOnly });
  document.getElementById('status-lang').textContent = langLabel(lang);
  updateEncodingStatus(file);
  if (file.readOnly) showReadOnlyBanner(file);
  else hideBanner();
}

function updateEncodingStatus(file) {
  const enc = document.getElementById('status-encoding');
  const eol = document.getElementById('status-eol');
  if (enc) enc.textContent = ENCODING_LABELS[file.encoding] || 'UTF-8';
  if (eol) eol.textContent = file.eol || 'LF';
}

function persistActiveContent() {
  if (!State.activePath || !currentModel) return;
  const file = State.files.get(State.activePath);
  if (file) file.content = currentModel.getValue();
}

export async function saveActive() {
  if (!State.activePath) return false;
  const file = State.files.get(State.activePath);
  if (!file) return false;
  if (file.readOnly) {
    toast('Arquivo somente leitura: não é possível salvar nesta codificação.', 'error', 5000);
    return false;
  }
  const content = activeEditor.getValue();
  try {
    await window.agzos.fs.writeFile(State.activePath, content, {
      encoding: file.encoding,
      eol: file.eol,
      bom: file.bom,
    });
    file.content = content;
    file.dirty = false;
    file.mtime = Date.now();
    renderTabs();
    updateWindowState();
    toast(`Salvo: ${basename(State.activePath)}`, 'success', 1800);
    return true;
  } catch (e) {
    toast(`Erro ao salvar: ${e.message}`, 'error', 6000);
    return false;
  }
}

export async function saveAll() {
  const dirtyPaths = [...State.files.entries()].filter(([, f]) => f.dirty).map(([p]) => p);
  for (const path of dirtyPaths) {
    if (State.activePath !== path) await openFile(path);
    const ok = await saveActive();
    if (!ok) return false;
  }
  return true;
}

export function getDirtyFiles() {
  return [...State.files.values()].filter((f) => f.dirty);
}

export async function closeTab(filePath) {
  const file = State.files.get(filePath);
  if (file?.dirty) {
    if (!confirm(`${basename(filePath)} tem mudanças não salvas. Fechar?`)) return;
  }
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
      activeEditor.updateOptions({ readOnly: false });
      hideBanner();
      document.getElementById('welcome').style.display = '';
      document.title = 'Agzos Code';
      updateWindowState();
    }
  }
  renderTabs();
  updateWindowState();
}

export async function closeActiveTab() {
  if (State.activePath) {
    await closeTab(State.activePath);
    return;
  }
  window.close();
}

// Remove abas cujos caminhos foram apagados (arquivo ou diretório).
export function handleDeletedPath(target) {
  const sep = pathSep();
  const affected = [...State.files.keys()].filter((p) => p === target || p.startsWith(target + sep));
  if (affected.length === 0) return;
  const activeAffected = affected.includes(State.activePath);
  for (const p of affected) State.files.delete(p);
  if (activeAffected) {
    if (currentModel) currentModel.dispose();
    currentModel = null;
    State.activePath = null;
    const remaining = [...State.files.keys()];
    if (remaining.length > 0) {
      openFile(remaining[remaining.length - 1]);
    } else {
      activeEditor.setModel(monaco.editor.createModel('', 'plaintext'));
      activeEditor.updateOptions({ readOnly: false });
      hideBanner();
      document.getElementById('welcome').style.display = '';
      document.title = 'Agzos Code';
    }
  }
  renderTabs();
  syncEditorWelcome();
  updateWindowState();
}

export async function reopenWithEncoding(filePath, encoding) {
  const file = State.files.get(filePath);
  if (!file) return;
  try {
    const meta = await window.agzos.fs.readFile(filePath, { encoding });
    Object.assign(file, meta, { dirty: false });
    if (State.activePath === filePath) setModel(file);
    renderTabs();
    toast(`Arquivo reaberto como ${ENCODING_LABELS[meta.encoding] || encoding}.`, 'info', 4000);
  } catch (e) {
    toast(`Não foi possível reabrir: ${e.message}`, 'error');
  }
}

// Welcome do editor só aparece sem arquivos abertos
function syncEditorWelcome() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.hidden = State.files.size > 0;
}

export function getActiveEditor() { return activeEditor; }
export function getMonaco() { return monaco; }

export async function revealLocation(filePath, line, column = 1) {
  await openFile(filePath);
  const editor = getActiveEditor();
  const model = editor?.getModel();
  if (!editor || !model) return;
  const lineNumber = Math.max(1, Math.min(Number(line) || 1, model.getLineCount()));
  const col = Math.max(1, Math.min(Number(column) || 1, model.getLineMaxColumn(lineNumber)));
  editor.revealLineInCenter(lineNumber);
  editor.setPosition({ lineNumber, column: col });
  editor.focus();
}

export function applyTheme(themeName) {
  if (!monaco) return;
  monaco.editor.setTheme(themeIdToMonaco(themeName));
  State.settings.theme = themeName;
  document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${themeName}`;
  window.agzos.settings.save(State.settings);
}

export function applyFontSize(size) {
  if (!activeEditor) return;
  activeEditor.updateOptions({ fontSize: size });
  State.settings.fontSize = size;
  window.agzos.settings.save(State.settings);
}

/* --------------------------------------------------------------------------
   Banner do editor (somente leitura / encoding)
   -------------------------------------------------------------------------- */
function bannerElement() {
  return document.getElementById('editor-banner');
}

export function hideBanner() {
  const el = bannerElement();
  if (!el) return;
  el.hidden = true;
  el.replaceChildren();
}

function showReadOnlyBanner(file) {
  const el = bannerElement();
  if (!el) return;
  el.replaceChildren();
  el.hidden = false;

  const msg = document.createElement('span');
  msg.className = 'editor-banner-text';
  if (file.binary) {
    msg.textContent = 'Arquivo binário — aberto somente para leitura.';
  } else if (file.encoding === 'unknown') {
    msg.textContent = 'Codificação não reconhecida (provável Windows-1252/Latin-1). O arquivo está somente leitura para não corromper.';
  } else {
    msg.textContent = 'Arquivo somente leitura.';
  }
  el.appendChild(msg);

  if (file.encoding === 'unknown' && !file.binary) {
    const btn = document.createElement('button');
    btn.className = 'primary-btn editor-banner-action';
    btn.textContent = 'Abrir como Windows-1252';
    btn.addEventListener('click', () => reopenWithEncoding(file.path, 'windows-1252'));
    el.appendChild(btn);
  }
}

/* --------------------------------------------------------------------------
   Estado da janela (dirty/título)
   -------------------------------------------------------------------------- */
function dirtyCount() {
  let count = 0;
  for (const f of State.files.values()) if (f.dirty) count++;
  return count;
}

let lastDirtyCount = -1;
let lastTitle = '';

function updateWindowState() {
  const active = State.activePath ? State.files.get(State.activePath) : null;
  const prefix = active?.dirty ? '● ' : '';
  const title = active ? `${prefix}${basename(active.path)} — Agzos Code` : 'Agzos Code';
  if (title !== lastTitle) {
    document.title = title;
    lastTitle = title;
  }
  const count = dirtyCount();
  if (count !== lastDirtyCount) {
    lastDirtyCount = count;
    try {
      window.agzos.windowState?.setDirty(count);
    } catch {}
  }
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
  if (name === 'agzos-light' || name === 'monokai') return name;
  return 'agzos-dark';
}

function pathSep() {
  return navigator.userAgent.includes('Windows') ? '\\' : '/';
}

function basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}
