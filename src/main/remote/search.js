/**
 * Listagem de arquivos (Quick Open) e busca em arquivos no host remoto.
 * Usa `rg` se existir no host; senão `find`/`grep`, com as mesmas exclusões.
 * Os scripts só levam valores do usuário por shQuote (remote/sh.js).
 * Parsers puros para os testes.
 */

const { shQuote } = require('./sh');

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '.vscode', '.idea', '.nuxt'];
const LIST_LIMIT = 20_000;
const SEARCH_LIMIT = 200;
const RG_MARK = '__AGZOS_RG__';
const GREP_MARK = '__AGZOS_GREP__';

/** Script que lista arquivos relativos à raiz (um por linha, `./` removido no parse). */
function buildListScript(rootPath, limit = LIST_LIMIT) {
  const n = Math.max(1, Math.min(Number(limit) || LIST_LIMIT, LIST_LIMIT));
  const rgGlobs = EXCLUDED_DIRS.map((d) => `-g ${shQuote(`!${d}/`)}`).join(' ');
  const prune = EXCLUDED_DIRS.map((d) => `-name ${shQuote(d)}`).join(' -o ');
  return `cd ${shQuote(rootPath)} && if command -v rg >/dev/null 2>&1; then `
    + `rg --files --hidden --no-require-git ${rgGlobs} 2>/dev/null; `
    + `else find . \\( ${prune} \\) -prune -o -type f -print 2>/dev/null; fi | head -n ${n}`;
}

function parseFileList(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((l) => l.replace(/\r$/, '').replace(/^\.\//, ''))
    .filter(Boolean);
}

/** Script de busca de texto literal (-F). Linha 1 indica a ferramenta usada. */
function buildSearchScript(rootPath, query, max = SEARCH_LIMIT) {
  const n = Math.max(1, Math.min(Number(max) || SEARCH_LIMIT, 1000));
  const rgGlobs = EXCLUDED_DIRS.map((d) => `-g ${shQuote(`!${d}/`)}`).join(' ');
  const excl = EXCLUDED_DIRS.map((d) => `--exclude-dir=${shQuote(d)}`).join(' ');
  const q = shQuote(query);
  return `cd ${shQuote(rootPath)} && if command -v rg >/dev/null 2>&1; then echo ${RG_MARK}; `
    + `rg --json -F --max-filesize 5M --max-count 50 ${rgGlobs} -e ${q} . 2>/dev/null | head -n ${n * 4}; `
    + `else echo ${GREP_MARK}; grep -rIn -F ${excl} -e ${q} . 2>/dev/null | head -n ${n}; fi`;
}

/** → [{ rel, line, text }] */
function parseSearchOutput(stdout, max = SEARCH_LIMIT) {
  const lines = String(stdout || '').split('\n');
  const tool = (lines.shift() || '').trim();
  const hits = [];
  if (tool === RG_MARK) {
    for (const l of lines) {
      if (hits.length >= max) break;
      if (!l.trim()) continue;
      let obj;
      try { obj = JSON.parse(l); } catch { continue; }
      if (obj.type !== 'match') continue;
      const rel = obj.data?.path?.text;
      const text = obj.data?.lines?.text;
      if (typeof rel !== 'string' || typeof text !== 'string') continue;
      hits.push({ rel: rel.replace(/^\.\//, ''), line: Number(obj.data.line_number) || 1, text: text.replace(/\r?\n$/, '').trim().slice(0, 200) });
    }
  } else if (tool === GREP_MARK) {
    for (const l of lines) {
      if (hits.length >= max) break;
      const m = /^(.+?):(\d+):(.*)$/.exec(l);
      if (!m) continue;
      hits.push({ rel: m[1].replace(/^\.\//, ''), line: Number(m[2]), text: m[3].replace(/\r$/, '').trim().slice(0, 200) });
    }
  }
  return hits;
}

module.exports = {
  buildListScript, parseFileList, buildSearchScript, parseSearchOutput, EXCLUDED_DIRS, LIST_LIMIT, SEARCH_LIMIT,
};
