/**
 * Ferramenta `file_history` do agente (Agzos Git Slider), kind 'read'.
 *
 * Lista as versões de um arquivo — commits do git (`git log --follow`) e versões do
 * histórico local — SEM conteúdo, da mais recente para a mais antiga.
 */

const { buildTimeline } = require('./timeline');
const { runGitFor } = require('./io');
const history = require('./index');

const definition = {
  name: 'file_history',
  description: 'Lista as versões de um arquivo do projeto (Agzos Git Slider): commits do git que o alteraram '
    + '(autor, data, mensagem) e cópias do histórico local (salvamentos e antes de alterações do agente, da '
    + 'Vassoura e do Cofre), da mais recente para a mais antiga. Não devolve o conteúdo das versões.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Caminho do arquivo, relativo à raiz do projeto.' } },
    required: ['path'],
  },
};

function describe(item) {
  const base = { version: item.versionId, kind: item.kind, date: new Date(item.ts).toISOString() };
  if (item.kind === 'commit') return { ...base, sha: item.sha.slice(0, 12), author: item.author, message: item.message };
  return { ...base, origin: item.origin, size: item.size };
}

module.exports = {
  definition,
  kind: 'read',
  remote: true, // git no host + histórico local (agent/remote-tools.js)
  prepare(input, ctx) {
    const abs = ctx.resolvePath(input?.path);
    const rel = ctx.rel(abs);
    return {
      title: `Histórico de ${rel}`,
      preview: { path: abs },
      run: async () => {
        const tl = await buildTimeline(abs, {
          store: history.getHistoryStore(), runGitFor, maxCommits: history.sliderOptions().maxCommits,
        });
        const versions = [...tl.items].reverse().map(describe);
        const commits = versions.filter((v) => v.kind === 'commit').length;
        const local = versions.length - commits;
        const data = { path: rel, git: tl.git, truncated: tl.truncated, versions };
        return {
          summary: `${commits} commit(s) · ${local} versão local${local === 1 ? '' : '(is)'}`,
          output: JSON.stringify(data, null, 2),
          meta: { commits, local },
        };
      },
    };
  },
};
