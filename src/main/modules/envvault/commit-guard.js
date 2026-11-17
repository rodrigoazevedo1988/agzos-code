/**
 * Bloqueio de commit com possíveis segredos (Cofre .env).
 *
 * createCommitGuard({ getSettings, userDataDir }) → {
 *   options() → settings.modules.envVault normalizado,
 *   check(repoDir) → { active, findings: [{ file, line, rule, preview }] },
 *   logOverride(repoDir, findings) → grava `ISO\trepo\tarquivos\tregras` em envvault-overrides.log
 * }
 * Arquivos `.env` reais no stage viram achado `{ rule: 'env-file', line: 0, preview: '' }`.
 *
 * O `ipc/envvault.js` chama `configureCommitGuard(deps)` no registro; `ipc/git.js` e o
 * gancho de risco do `run_command` usam `getCommitGuard()` (sem mexer na ordem do main.js).
 * Valores nunca são logados.
 */

const fs = require('node:fs');
const path = require('node:path');
const { normalizeModules } = require('../../lib/settings');
const { scanStaged } = require('./staged');

const LOG_FILE = 'envvault-overrides.log';
const COMMIT_RE = /\bgit\b[^;|&]*\bcommit\b/;
const COMMIT_RISK_REASON = 'commit com possíveis segredos';

class SecretsDetectedError extends Error {
  constructor(findings) {
    super('Commit bloqueado: possíveis segredos no stage.');
    this.name = 'SecretsDetectedError';
    this.kind = 'secrets_detected';
    this.findings = findings;
  }
}

function createCommitGuard({ getSettings = () => ({}), userDataDir, scan = scanStaged } = {}) {
  function options() {
    return normalizeModules(getSettings()?.modules).envVault;
  }

  async function check(repoDir) {
    const o = options();
    if (!o.enabled || !o.blockCommits) return { active: false, findings: [] };
    const { findings, envFiles } = await scan(repoDir, { extraPatterns: o.extraPatterns, allowlist: o.allowlist });
    const envFindings = envFiles.map((file) => ({ file, line: 0, rule: 'env-file', preview: '' }));
    return { active: true, findings: [...envFindings, ...findings] };
  }

  function logOverride(repoDir, findings) {
    if (!userDataDir) return;
    const clean = (s) => String(s).replace(/[\t\r\n]/g, ' ');
    const files = [...new Set(findings.map((f) => clean(f.file)))].join(',');
    const rules = [...new Set(findings.map((f) => clean(f.rule)))].join(',');
    const line = `${new Date().toISOString()}\t${clean(repoDir)}\t${files}\t${rules}\n`;
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.appendFileSync(path.join(userDataDir, LOG_FILE), line, { mode: 0o600 });
    } catch {
      // log é auxiliar: falha ao gravar não impede o commit já autorizado
    }
  }

  return { options, check, logOverride };
}

let current = null;
function configureCommitGuard(deps) {
  current = createCommitGuard(deps);
  return current;
}
function getCommitGuard() {
  return current;
}

/**
 * Gancho de risco do `run_command`: `git … commit` com achados no stage → motivo de risco.
 * Devolve null (síncrono) para outros comandos; Promise<string|null> para commits.
 */
function commitCommandRisk(command, { cwd } = {}, { commitGuard = getCommitGuard() } = {}) {
  if (!commitGuard || typeof command !== 'string' || !COMMIT_RE.test(command)) return null;
  return commitGuard.check(cwd)
    .then((r) => (r.active && r.findings.length ? COMMIT_RISK_REASON : null))
    .catch(() => null);
}

module.exports = {
  createCommitGuard, configureCommitGuard, getCommitGuard, commitCommandRisk,
  SecretsDetectedError, COMMIT_RE, COMMIT_RISK_REASON, LOG_FILE,
};
