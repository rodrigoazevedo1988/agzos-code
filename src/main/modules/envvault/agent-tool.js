/**
 * Ferramenta `env_check` do agente (Cofre .env), kind 'read'.
 *
 * Devolve { files: [{ path, keys, missing, extra, empty, secrets: [{ key, rule }] }], stagedFindings }
 * — NUNCA valores (nem o preview mascarado dos achados vai para o modelo).
 *
 * Também expõe `commandRisk` (gancho do run_command em agent/tools.js): `git … commit` com
 * possíveis segredos no stage vira comando de risco (sempre pede OK).
 */

const path = require('node:path');
const { runGit } = require('../../git/run');
const { listVault } = require('./vault');
const { scanStaged } = require('./staged');
const { getCommitGuard, commitCommandRisk } = require('./commit-guard');

function detectOptions() {
  const o = getCommitGuard()?.options?.();
  return o ? { extraPatterns: o.extraPatterns, allowlist: o.allowlist } : {};
}

async function stagedFindings(root, opts) {
  let repo;
  try {
    const { stdout } = await runGit(root, ['rev-parse', '--show-toplevel']);
    repo = path.resolve(stdout.trim());
  } catch {
    return [];
  }
  const { findings, envFiles } = await scanStaged(repo, opts);
  return [
    ...envFiles.map((file) => ({ file, line: 0, rule: 'env-file' })),
    ...findings.map(({ file, line, rule }) => ({ file, line, rule })),
  ];
}

/** Resumo para o modelo, só com nomes de chaves e regras. */
async function envCheck(root) {
  const opts = detectOptions();
  const vault = listVault(root, { detectOptions: opts });
  const files = vault.files.map((f) => {
    const real = f.entries.filter((e) => !e.flags.missing);
    return {
      path: f.rel,
      ...(f.isExample ? { example: true } : {}),
      ...(f.error ? { error: f.error } : {}),
      keys: [...new Set(real.map((e) => e.key))],
      missing: f.compare?.missing || [],
      extra: f.compare?.extra || [],
      empty: real.filter((e) => e.flags.empty).map((e) => e.key),
      secrets: real.filter((e) => e.flags.secret).map((e) => ({ key: e.key, rule: e.rule })),
    };
  });
  return { files, stagedFindings: await stagedFindings(root, opts) };
}

const definition = {
  name: 'env_check',
  description: 'Verifica os arquivos .env* do projeto (Cofre .env): chaves de cada arquivo, chaves faltando/sobrando/vazias '
    + 'em relação ao .env.example, possíveis segredos (só chave e regra) e achados no stage do git. Nunca devolve valores.',
  input_schema: { type: 'object', properties: {} },
};

module.exports = {
  definition,
  kind: 'read',
  prepare(_input, ctx) {
    return {
      title: 'Verificar arquivos .env',
      preview: {},
      run: async () => {
        const data = await envCheck(ctx.root);
        const secrets = data.files.reduce((n, f) => n + f.secrets.length, 0);
        const missing = data.files.reduce((n, f) => n + f.missing.length, 0);
        return {
          summary: `${data.files.length} arquivo(s) · ${secrets} segredo(s) · ${missing} faltando · ${data.stagedFindings.length} no stage`,
          output: JSON.stringify(data, null, 2),
          meta: { files: data.files.length, secrets, missing, staged: data.stagedFindings.length },
        };
      },
    };
  },
  commandRisk: (command, ctx) => commitCommandRisk(command, ctx),
  _envCheck: envCheck,
};
