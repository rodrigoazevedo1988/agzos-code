/**
 * Varredura do que está no stage (git diff --cached) em busca de segredos.
 * Usa `--cached`, então funciona sem commits e em detached HEAD.
 * Só linhas adicionadas (`+`) passam pelo detector; valores nunca saem daqui.
 */

const path = require('node:path');
const { runGit } = require('../../git/run');
const { detectSecrets } = require('./detect');

const EXAMPLE_SUFFIX_RE = /\.(?:example|sample|template)$/i;

/** `.env` ou `.env.*`, exceto `*.example|*.sample|*.template`. */
function isRealEnvFile(p) {
  const base = path.posix.basename(String(p || '').replace(/\\/g, '/'));
  if (!/^\.env(?:\..+)?$/.test(base)) return false;
  return !EXAMPLE_SUFFIX_RE.test(base);
}

/** Desfaz o quoting do git ("a/caf\303\251") → string UTF-8. */
function unquoteGitPath(s) {
  if (!s.startsWith('"') || !s.endsWith('"')) return s;
  const body = s.slice(1, -1);
  const bytes = [];
  const simple = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const n = body[i + 1];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(simple[n] ?? n.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function stripPrefix(p) {
  return p.startsWith('b/') ? p.slice(2) : p;
}

/**
 * Lê a saída de `git diff --cached -U0 --no-color --no-ext-diff` e devolve
 * [{ file, line, rule, preview }] (line = número na versão nova do arquivo).
 */
function scanStagedDiff(diffText, opts = {}) {
  const files = new Map(); // file → { lines: string[], numbers: number[] }
  let current = null;
  let newLine = 0;
  for (const raw of String(diffText || '').split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) { current = null; continue; }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      if (target === '/dev/null') { current = null; continue; }
      const file = stripPrefix(unquoteGitPath(target));
      if (!files.has(file)) files.set(file, { lines: [], numbers: [] });
      current = files.get(file);
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { newLine = Number(hunk[1]); continue; }
    if (!current) continue;
    if (line.startsWith('+')) {
      current.lines.push(line.slice(1));
      current.numbers.push(newLine);
      newLine++;
    } else if (line.startsWith(' ')) {
      newLine++;
    }
  }
  const out = [];
  for (const [file, { lines, numbers }] of files) {
    if (!lines.length) continue;
    const found = detectSecrets(lines.join('\n'), { ...opts, fileName: file });
    for (const f of found) out.push({ file, line: numbers[f.line - 1], rule: f.rule, preview: f.preview });
  }
  return out;
}

/**
 * Varre o staged de `repoRoot`. → { findings, envFiles }
 * opts: { extraPatterns, allowlist, runGit } (runGit injetável nos testes).
 */
async function scanStaged(repoRoot, { runGit: run = runGit, ...opts } = {}) {
  const { stdout: diff } = await run(repoRoot, ['-c', 'core.quotePath=false', 'diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--no-renames']);
  const { stdout: names } = await run(repoRoot, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  const envFiles = names.split('\0').filter(Boolean).filter(isRealEnvFile);
  return { findings: scanStagedDiff(diff, opts), envFiles };
}

module.exports = { scanStagedDiff, scanStaged, isRealEnvFile, unquoteGitPath };
