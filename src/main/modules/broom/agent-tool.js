/**
 * Ferramenta `clean_code` do agente (Vassoura de Produção), kind 'write'.
 *
 * clean_code({ path, rules? }): analisa e limpa um arquivo ou uma pasta (até 200 arquivos
 * analisáveis, com os mesmos ignorados e o limite de 1 MB do scan). O prepare calcula tudo e
 * mostra o diff na aprovação; o run registra cada arquivo no checkpoint da conversa antes de
 * gravar e devolve { files, removed, byRule } em meta. A análise roda no worker dos módulos
 * (motor registrado por ipc/broom.js).
 */

const fs = require('fs');
const {
  getDefaultEngine, getDefaultSettings, optionsFromSettings, countByRule, isSupported,
} = require('./engine');

const MAX_FILES = 200;
const PREVIEW_MAX_CHARS = 400 * 1024;
const RULE_LABELS = { console: 'console', comments: 'comentários', unusedImports: 'imports', deadCode: 'código morto' };

const schema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Arquivo ou pasta relativo à raiz do projeto.' },
    rules: {
      type: 'object',
      description: 'Regras a aplicar (padrão: as das Configurações). false desliga a regra nesta chamada.',
      properties: {
        console: { type: 'boolean', description: 'Remove chamadas console.* soltas (exceto as mantidas nas Configurações, ex.: error/warn).' },
        comments: { type: 'boolean', description: 'Remove comentários comuns (mantém JSDoc, diretivas, licenças e shebang).' },
        unusedImports: { type: 'boolean', description: 'Remove imports não usados.' },
        deadCode: { type: 'boolean', description: 'Remove código após return/throw/break/continue e blocos if (false).' },
      },
    },
  },
  required: ['path'],
};

const definition = {
  name: 'clean_code',
  description: 'Limpa código para produção num arquivo ou pasta (.ts .tsx .js .jsx .mjs .cjs; pasta: até 200 arquivos, ignora node_modules/dist/build): remove console.*, comentários comuns, imports não usados e código morto. Só remove trechos; nunca reescreve o resto do código. Pode ser desfeito.',
  input_schema: schema,
  // Os providers (openai-compatible/anthropic) leem `parameters`.
  parameters: schema,
};

function statOrNull(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function describe(byRule) {
  return Object.entries(byRule).filter(([, n]) => n > 0).map(([r, n]) => `${RULE_LABELS[r]} ${n}`).join(', ');
}

async function prepare(input, ctx) {
  const abs = ctx.resolvePath(input.path);
  const engine = getDefaultEngine();
  if (!engine) throw new Error('Vassoura de Produção indisponível');
  const settings = getDefaultSettings() || {};
  const options = optionsFromSettings(settings, input.rules);
  const st = statOrNull(abs);
  if (!st) throw new Error(`Não encontrado: ${input.path}`);

  let targets;
  const isDir = st.isDirectory();
  if (isDir) {
    const listed = await engine.listFiles(abs);
    if (listed.files.length > MAX_FILES) {
      throw new Error(`A pasta ${ctx.rel(abs)} tem mais de ${MAX_FILES} arquivos analisáveis (${listed.truncated ? 'muitos' : listed.files.length}); escolha uma subpasta.`);
    }
    targets = listed.files.map((f) => f.path);
  } else {
    if (!isSupported(abs)) throw new Error(`A Vassoura só analisa arquivos .ts, .tsx, .js, .jsx, .mjs e .cjs: ${ctx.rel(abs)}`);
    targets = [abs];
  }

  const plans = [];
  const errors = [];
  for (const file of targets) {
    const p = await engine.plan(file, options);
    if (p.error) errors.push({ path: file, error: p.error });
    if (p.edits.length) plans.push({ path: file, ...p, byRule: countByRule(p.edits) });
  }

  // O cartão de aprovação do agente (agent-ui.js) só sabe mostrar diff/comando/caminho:
  // sem diff ele trataria a ação como "apagar". Por isso há sempre um diff, mesmo vazio.
  let preview;
  if (!isDir) {
    const only = plans[0];
    const text = only ? only.text : (statOrNull(abs) ? fs.readFileSync(abs, 'utf8') : '');
    preview = { diff: { path: abs, before: text, after: only ? only.after : text } };
  } else {
    // Diff combinado (com cabeçalho por arquivo) para o cartão de aprovação + lista por arquivo.
    let before = '';
    let after = '';
    for (const p of plans) {
      if (before.length + p.text.length > PREVIEW_MAX_CHARS) {
        before += `// … ${plural(plans.length, 'arquivo', 'arquivos')} no total; diff truncado\n`;
        after += `// … ${plural(plans.length, 'arquivo', 'arquivos')} no total; diff truncado\n`;
        break;
      }
      const head = `// ===== ${ctx.rel(p.path)} =====\n`;
      before += head + p.text + (p.text.endsWith('\n') ? '' : '\n');
      after += head + p.after + (p.after.endsWith('\n') ? '' : '\n');
    }
    preview = {
      files: plans.map((p) => ({ path: p.path, count: p.edits.length, byRule: p.byRule })),
      diff: plans.length
        ? { path: abs, before, after }
        : { path: abs, before: `// Nada para limpar em ${ctx.rel(abs)}\n`, after: `// Nada para limpar em ${ctx.rel(abs)}\n` },
    };
  }

  const title = isDir ? `Limpar ${ctx.rel(abs)} (${plural(plans.length, 'arquivo', 'arquivos')})` : `Limpar ${ctx.rel(abs)}`;

  return {
    title,
    preview,
    async run() {
      const changed = [];
      const byRule = { console: 0, comments: 0, unusedImports: 0, deadCode: 0 };
      let removed = 0;
      const lines = [];
      for (const p of plans) {
        ctx.checkpoint?.record(p.path);
        await engine.write(p.path, p.text, p.after);
        changed.push(p.path);
        removed += p.edits.length;
        for (const [r, n] of Object.entries(p.byRule)) byRule[r] += n;
        lines.push(`${ctx.rel(p.path)}: −${p.edits.length} (${describe(p.byRule)})`);
      }
      for (const e of errors) lines.push(`${ctx.rel(e.path)}: não alterado (${e.error})`);
      const summary = removed
        ? `Limpou ${plural(removed, 'item', 'itens')} em ${plural(changed.length, 'arquivo', 'arquivos')}`
        : 'Nada para limpar';
      return {
        summary,
        output: [summary + '.', ...lines].join('\n'),
        meta: { files: changed.length, removed, byRule },
        changed,
      };
    },
  };
}

module.exports = { definition, kind: 'write', prepare };
