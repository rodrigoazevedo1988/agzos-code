/**
 * Ferramentas de leitura que dependem do editor (renderer): read_terminal e get_problems.
 * Formato de ferramenta extra (ver src/main/agent/tools.js), kind 'read' — nunca pedem OK.
 *
 * query(what, args) → Promise com a resposta do renderer (ver ipc/agent.js, canal agent:query).
 */

const MAX_CHARS = 30 * 1024;

function clip(text, max = MAX_CHARS) {
  const s = String(text ?? '');
  return s.length > max ? `…(cortado)\n${s.slice(-max)}` : s;
}

function formatProblems(list, root) {
  if (!Array.isArray(list) || !list.length) return 'Nenhum problema no editor.';
  const rel = (p) => (root && typeof p === 'string' && p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, '') : p);
  return list.slice(0, 300).map((p) => `${rel(p.path)}:${p.line}:${p.column ?? 1} [${p.severity}] ${p.message}${p.source ? ` (${p.source})` : ''}`).join('\n');
}

function createRendererTools(query) {
  if (typeof query !== 'function') return [];
  return [
    {
      definition: {
        name: 'read_terminal',
        description: 'Lê a saída recente do terminal integrado do editor (o que o usuário rodou e viu). Use para ver erros de build/teste/execução.',
        parameters: {
          type: 'object',
          properties: { lines: { type: 'integer', minimum: 10, maximum: 1000, description: 'Quantas linhas finais (padrão 200).' } },
        },
      },
      kind: 'read',
      prepare(input) {
        const lines = Number.isInteger(input.lines) ? Math.min(1000, Math.max(10, input.lines)) : 200;
        return {
          title: 'Ler terminal',
          async run() {
            const out = await query('terminal', { lines });
            const text = clip(typeof out === 'string' ? out : '');
            return { summary: text ? `${text.split('\n').length} linhas` : 'terminal vazio', output: text || '(terminal vazio)' };
          },
        };
      },
    },
    {
      definition: {
        name: 'get_problems',
        description: 'Lista os Problemas do editor (erros e avisos de linguagem/lint dos arquivos abertos): arquivo:linha:coluna [severidade] mensagem.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Filtra por um arquivo (relativo à raiz). Opcional.' } },
        },
      },
      kind: 'read',
      prepare(input, ctx) {
        const filter = typeof input.path === 'string' && input.path ? ctx.resolvePath(input.path) : null;
        return {
          title: filter ? `Problemas em ${input.path}` : 'Problemas do editor',
          async run() {
            const list = await query('problems', { path: filter });
            const items = Array.isArray(list) ? list.filter((p) => !filter || p.path === filter) : [];
            return { summary: `${items.length} ${items.length === 1 ? 'problema' : 'problemas'}`, output: formatProblems(items, ctx.root) };
          },
        };
      },
    },
  ];
}

module.exports = { createRendererTools, formatProblems };
