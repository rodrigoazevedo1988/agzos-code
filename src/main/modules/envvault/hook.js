/**
 * Hook pre-commit opcional do Cofre .env (para commits feitos no terminal).
 *
 * installHook(repoRoot) → { installed: true } | { installed: false, reason: 'exists' }
 * removeHook(repoRoot) → { removed: true } | { removed: false, reason: 'foreign'|'none' }
 * hookStatus(repoRoot) → 'installed' | 'foreign' | 'none'
 *
 * O hook só é sobrescrito/apagado se tiver a linha marcadora (HOOK_MARKER).
 * O script nunca imprime a linha encontrada (não ecoa o segredo no terminal).
 */

const fs = require('node:fs');
const path = require('node:path');
const { runGit } = require('../../git/run');

const HOOK_MARKER = '# agzos-envvault-hook';

// Padrões principais (ERE do grep): AWS, Stripe, Anthropic, OpenAI, GitHub, chave privada.
const HOOK_PATTERN = [
  '(AKIA|ASIA)[0-9A-Z]{16}',
  '(sk|rk)_live_[0-9a-zA-Z]{16,}',
  'sk_test_[0-9a-zA-Z]{16,}',
  'sk-ant-[A-Za-z0-9_-]{20,}',
  'sk-proj-[A-Za-z0-9_-]{20,}',
  'sk-[A-Za-z0-9]{40,}',
  'gh[posu]_[A-Za-z0-9]{36,}',
  'github_pat_[A-Za-z0-9_]{22,}',
  '-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----',
].join('|');

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Proteção pre-commit gerada pelo Cofre .env do Agzos Code.
# Remova pelo Cofre (Remover proteção) ou apagando este arquivo.
# Para pular uma única vez: git commit --no-verify

PATTERN='${HOOK_PATTERN}'

if git diff --cached -U0 --no-color --no-ext-diff -- . \\
    ':(exclude,glob)**/package-lock.json' ':(exclude,glob)**/yarn.lock' ':(exclude,glob)**/pnpm-lock.yaml' \\
  | grep -E '^[+]' | grep -v -E '^[+][+][+] ' | grep -E -q -e "$PATTERN"; then
  echo "Agzos Code (Cofre .env): commit bloqueado — possíveis segredos nas alterações preparadas." >&2
  echo "Revise com: git diff --cached    (para ignorar uma vez: git commit --no-verify)" >&2
  exit 1
fi

if git diff --cached --name-only --diff-filter=ACMR \\
  | grep -E '(^|/)[.]env([.][^/]*)?$' | grep -v -E '[.](example|sample|template)$' | grep -q .; then
  echo "Agzos Code (Cofre .env): commit bloqueado — arquivo .env no stage." >&2
  echo "Tire do stage com: git restore --staged <arquivo>    (ou git commit --no-verify)" >&2
  exit 1
fi

exit 0
`;

async function hookPath(repoRoot, { run = runGit } = {}) {
  const { stdout } = await run(repoRoot, ['rev-parse', '--git-path', 'hooks']);
  return path.join(path.resolve(repoRoot, stdout.trim()), 'pre-commit');
}

function readOrNull(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

async function hookStatus(repoRoot, opts) {
  const text = readOrNull(await hookPath(repoRoot, opts));
  if (text === null) return 'none';
  return text.includes(HOOK_MARKER) ? 'installed' : 'foreign';
}

async function installHook(repoRoot, opts) {
  const file = await hookPath(repoRoot, opts);
  const text = readOrNull(file);
  if (text !== null && !text.includes(HOOK_MARKER)) return { installed: false, reason: 'exists' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, HOOK_SCRIPT, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return { installed: true };
}

async function removeHook(repoRoot, opts) {
  const file = await hookPath(repoRoot, opts);
  const text = readOrNull(file);
  if (text === null) return { removed: false, reason: 'none' };
  if (!text.includes(HOOK_MARKER)) return { removed: false, reason: 'foreign' };
  fs.unlinkSync(file);
  return { removed: true };
}

module.exports = { installHook, removeHook, hookStatus, HOOK_MARKER, HOOK_SCRIPT, HOOK_PATTERN };
