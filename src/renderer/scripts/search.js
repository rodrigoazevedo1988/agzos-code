/**
 * Search — busca textual simples recursiva em arquivos da workspace aberta.
 * Limitado a 5MB por arquivo e primeiros 200 hits para não travar a UI.
 * Inclui dotfiles relevantes (.env, .github) e cancela buscas antigas.
 */

import { revealLocation } from './editor.js';

const State = window.AgzosState;
const MAX_HITS = 200;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', '.cache', '.next', '.nuxt', 'coverage', 'build', 'dist-electron',
]);

let debounceTimer = null;
let searchRun = 0;

export function setupSearch() {
  const input = document.getElementById('search-text');
  const results = document.getElementById('search-results');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(input.value, results), 250);
  });
}

async function runSearch(query, resultsHost) {
  const runId = ++searchRun;
  resultsHost.innerHTML = '';
  if (!query || query.length < 2) {
    resultsHost.innerHTML = '<p class="hint">Digite ao menos 2 caracteres.</p>';
    return;
  }
  if (!State.workspaceRoot) {
    resultsHost.innerHTML = '<p class="hint">Abra uma pasta primeiro.</p>';
    return;
  }
  const hits = [];
  await walk(State.workspaceRoot, async (filePath, stat) => {
    if (!stat || stat.isDirectory || stat.size > MAX_FILE_SIZE) return;
    if (!isTexty(filePath)) return;
    try {
      const { content, binary, encoding } = await window.agzos.fs.readFile(filePath);
      if (binary || encoding === 'binary') return;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i].indexOf(query);
        if (col !== -1) {
          hits.push({ file: filePath, line: i + 1, column: col + 1, text: lines[i].trim().slice(0, 200) });
          if (hits.length >= MAX_HITS) return;
        }
      }
    } catch {}
  });

  // Uma busca mais nova começou enquanto esta varria a árvore.
  if (runId !== searchRun) return;

  if (hits.length === 0) {
    resultsHost.innerHTML = '<p class="hint">Nenhum resultado.</p>';
    return;
  }
  for (const h of hits) {
    const div = document.createElement('div');
    div.className = 'search-hit';
    const f = document.createElement('div'); f.className = 'file'; f.textContent = `${shortPath(h.file)}:${h.line}`;
    const t = document.createElement('div'); t.className = 'line'; t.textContent = h.text;
    div.appendChild(f); div.appendChild(t);
    div.addEventListener('click', () => revealLocation(h.file, h.line, h.column));
    resultsHost.appendChild(div);
  }
  if (hits.length === MAX_HITS) {
    const more = document.createElement('p');
    more.className = 'hint';
    more.textContent = `Mostrando primeiros ${MAX_HITS} resultados. Refine a busca para mais.`;
    resultsHost.appendChild(more);
  }
}

async function walk(dir, onFile, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = await window.agzos.fs.readDir(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name) || e.name === '.DS_Store') continue;
    if (State.settings.showHiddenFiles === false && e.name.startsWith('.')) continue;
    if (e.isDirectory) {
      await walk(e.path, onFile, depth + 1);
    } else {
      let stat;
      try { stat = await window.agzos.fs.stat(e.path); } catch { continue; }
      await onFile(e.path, stat);
    }
  }
}

function isTexty(p) {
  const name = p.split(/[\\/]/).pop() || '';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (['dockerfile', 'makefile', 'readme', 'license'].includes(name.toLowerCase())) return true;
  const textExts = new Set([
    'js','jsx','ts','tsx','mjs','cjs','json','md','txt','html','css','scss','less','py','rb','go','rs','java','php',
    'sh','bash','zsh','yml','yaml','toml','xml','svg','vue','svelte','env','conf','ini','log','sql','c','h','cpp',
    'hpp','cc','cs','lock','gitignore','editorconfig','npmrc','nvmrc',
  ]);
  return textExts.has(ext);
}

function shortPath(p) {
  if (!State.workspaceRoot) return p;
  return p.startsWith(State.workspaceRoot) ? p.slice(State.workspaceRoot.length).replace(/^[\\/]/, '') : p;
}
