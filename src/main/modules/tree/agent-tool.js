/**
 * Ferramenta `project_tree` do agente (Agzos Árvore), kind 'read'.
 * Árvore em texto de uma pasta do projeto (respeita .gitignore, sem ocultos).
 * Leitura via `generateTree` (fonte local; na pasta remota, trocar a fonte pelo provider).
 */

const { generateTree } = require('./generate');

const definition = {
  name: 'project_tree',
  description: 'Mostra a estrutura de pastas e arquivos do projeto em árvore (├──, └──), respeitando o .gitignore '
    + 'e sem arquivos ocultos. Use para ter uma visão geral da organização do projeto.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Pasta relativa à raiz do projeto (padrão ".")' },
      depth: { type: 'integer', description: 'Níveis abaixo da pasta (1 a 20, padrão 3)' },
    },
  },
};

module.exports = {
  definition,
  kind: 'read',
  prepare(input, ctx) {
    const abs = ctx.resolvePath(input.path ?? '.');
    const depth = Number.parseInt(input.depth, 10);
    return {
      title: `Árvore de ${ctx.rel(abs)}`,
      preview: {},
      run: async () => {
        const r = await generateTree(abs, { depth: Number.isInteger(depth) ? depth : undefined });
        return {
          summary: `${r.count} entrada(s)${r.truncated ? ' (truncado)' : ''}`,
          output: r.text,
          meta: { count: r.count, truncated: r.truncated },
        };
      },
    };
  },
};
