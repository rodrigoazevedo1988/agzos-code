'use strict';

/**
 * Arquivos e pastas ocultos no Explorer e no Quick Open (como o `files.exclude`
 * do VS Code). Arquivos com ponto (.gitignore, .env, .github, .vscode…) aparecem;
 * só os nomes desta lista somem.
 */
const DEFAULT_FILES_EXCLUDE = ['.git', '.svn', '.hg', 'CVS', '.DS_Store', 'Thumbs.db'];

/** Lista válida de nomes (sem barras, até 200 itens); inválida volta ao padrão. */
function normalizeFilesExclude(value) {
  if (!Array.isArray(value)) return [...DEFAULT_FILES_EXCLUDE];
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name || name.length > 255 || /[\\/]/.test(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length >= 200) break;
  }
  return out;
}

/** true se o nome deve ficar oculto (comparação sem diferenciar maiúsculas). */
function isExcludedName(name, list = DEFAULT_FILES_EXCLUDE) {
  const lower = String(name || '').toLowerCase();
  return list.some((x) => x.toLowerCase() === lower);
}

module.exports = { DEFAULT_FILES_EXCLUDE, normalizeFilesExclude, isExcludedName };
