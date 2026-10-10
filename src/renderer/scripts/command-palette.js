/**
 * Command Palette — abre overlay com busca fuzzy simples de comandos.
 */

const COMMANDS = [
  { id: 'file.open',          label: 'Arquivo: Abrir Pasta…',           hint: 'Ctrl+O',  run: openFolder },
  { id: 'file.openFile',      label: 'Arquivo: Abrir Arquivo…',         hint: '',        run: openFileDialog },
  { id: 'file.save',          label: 'Arquivo: Salvar',                 hint: 'Ctrl+S',  run: () => import('./editor.js').then(m => m.saveActive()) },
  { id: 'view.toggleSidebar', label: 'Exibir: Alternar Sidebar',        hint: 'Ctrl+B',  run: () => document.body.classList.toggle('sidebar-hidden') },
  { id: 'view.toggleTerminal',label: 'Exibir: Alternar Terminal',       hint: 'Ctrl+`',  run: () => import('./terminal.js').then(m => m.toggleTerminal()) },
  { id: 'view.theme.dark',    label: 'Preferências: Tema Agzos Dark',   hint: '',        run: () => setTheme('agzos-dark') },
  { id: 'view.theme.light',   label: 'Preferências: Tema Agzos Light',  hint: '',        run: () => setTheme('agzos-light') },
  { id: 'view.theme.monokai', label: 'Preferências: Tema Monokai',      hint: '',        run: () => setTheme('monokai') },
  { id: 'view.perf.economy',  label: 'Performance: Modo Economia',      hint: '',        run: () => setPerf('economy') },
  { id: 'view.perf.balanced', label: 'Performance: Modo Balanceado',    hint: '',        run: () => setPerf('balanced') },
  { id: 'view.perf.high',     label: 'Performance: Modo Alta',          hint: '',        run: () => setPerf('high') },
  { id: 'help.about',         label: 'Ajuda: Sobre o Agzos Code',       hint: '',        run: showAbout },
];

let activeIndex = 0;
let currentResults = [];

export function showCommandPalette() {
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  overlay.hidden = false;
  input.value = '';
  currentResults = [...COMMANDS];
  activeIndex = 0;
  renderList();
  setTimeout(() => input.focus(), 20);
}

export function hideCommandPalette() {
  document.getElementById('cmd-overlay').hidden = true;
}

export function setupCommandPalette() {
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  const list = document.getElementById('cmd-list');

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    currentResults = COMMANDS
      .map((c) => ({ c, score: fuzzyScore(c.label, q) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.c);
    activeIndex = 0;
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideCommandPalette(); }
    else if (e.key === 'ArrowDown') { activeIndex = Math.min(activeIndex + 1, currentResults.length - 1); renderList(); e.preventDefault(); }
    else if (e.key === 'ArrowUp')   { activeIndex = Math.max(activeIndex - 1, 0); renderList(); e.preventDefault(); }
    else if (e.key === 'Enter')     {
      const cmd = currentResults[activeIndex];
      if (cmd) { hideCommandPalette(); cmd.run(); }
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideCommandPalette();
  });
}

function renderList() {
  const list = document.getElementById('cmd-list');
  list.innerHTML = '';
  if (currentResults.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Nenhum comando encontrado.';
    li.style.color = '#7A7A7A';
    list.appendChild(li);
    return;
  }
  currentResults.forEach((cmd, idx) => {
    const li = document.createElement('li');
    if (idx === activeIndex) li.classList.add('active');
    const label = document.createElement('span'); label.textContent = cmd.label;
    const hint = document.createElement('span'); hint.className = 'kbd-hint'; hint.textContent = cmd.hint || '';
    li.appendChild(label); li.appendChild(hint);
    li.addEventListener('click', () => { hideCommandPalette(); cmd.run(); });
    li.addEventListener('mouseenter', () => { activeIndex = idx; renderList(); });
    list.appendChild(li);
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

/* command implementations */
async function openFolder() {
  const p = await window.agzos.dialog.openFolder();
  if (p) {
    const mod = await import('./file-tree.js');
    await mod.openWorkspace(p);
  }
}
async function openFileDialog() {
  const p = await window.agzos.dialog.openFile();
  if (p) {
    const mod = await import('./editor.js');
    await mod.openFile(p);
  }
}
async function setTheme(theme) {
  const mod = await import('./editor.js');
  mod.applyTheme(theme);
  document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${theme}`;
  const sel = document.getElementById('setting-theme');
  if (sel) sel.value = theme;
}
async function setPerf(mode) {
  document.body.classList.remove('perf-economy', 'perf-high');
  if (mode === 'economy') document.body.classList.add('perf-economy');
  if (mode === 'high') document.body.classList.add('perf-high');
  document.getElementById('status-perf').textContent = `⚡ ${mode === 'high' ? 'alta performance' : mode}`;
  const sel = document.getElementById('setting-perf');
  if (sel) sel.value = mode;
  const State = window.AgzosState;
  State.settings.performanceMode = mode;
  await window.agzos.settings.save(State.settings);
}
async function showAbout() {
  const info = await window.agzos.app.info();
  alert(`Agzos Code ${info.version}\nElectron ${info.electron}\nNode ${info.node}\nPlatform: ${info.platform}/${info.arch}`);
}
