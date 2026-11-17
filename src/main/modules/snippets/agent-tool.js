/**
 * Ferramentas do agente para os Snippets (biblioteca em userData/snippets.json, via runtime.js).
 *
 * list_snippets({ query?, category? }) · read  → { snippets: [{ id, name, category, language, tags }], categories }
 * insert_snippet({ id, path, line? }) · write  → insere o snippet (variáveis trocadas; HTML → JSX em
 *   .jsx/.tsx) antes da linha `line` (1-based; herda a indentação dela) ou no fim do arquivo.
 *   Cria o arquivo se não existir. Diff na aprovação; checkpoint antes de gravar; CRLF preservado.
 * save_snippet({ name, category, language, body, tags? }) · write → { id }
 */

const fs = require('node:fs');
const path = require('node:path');
const { getSnippetsRuntime } = require('./runtime');
const { renderSnippet } = require('./render');
const { isJsxPath } = require('./jsx');
const { cleanInput, LANGUAGES } = require('./store');

function runtime() {
  const rt = getSnippetsRuntime();
  if (!rt?.store) throw new Error('Snippets indisponíveis nesta janela');
  return rt;
}

const tool = (definition, kind, prepare) => ({
  definition: { ...definition, parameters: definition.input_schema },
  kind,
  prepare,
});

/* ----------------------------------------------------------- list_snippets */

const listSnippets = tool({
  name: 'list_snippets',
  description: 'Lista os snippets da biblioteca Agzos (componentes HTML + Tailwind, JSX e CSS prontos): id, nome, categoria, '
    + 'linguagem e tags, sem o código. Use o id com insert_snippet para inserir num arquivo.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Termos de busca (nome, categoria ou tags).' },
      category: { type: 'string', description: 'Categoria exata (ex.: Hero, CTA, Formulário).' },
    },
  },
}, 'read', (input) => {
  const { store } = runtime();
  return {
    title: 'Listar snippets',
    preview: {},
    run: async () => {
      const all = store.list();
      const snippets = store.list({ query: String(input.query || ''), category: String(input.category || '') })
        .map(({ id, name, category, language, tags }) => ({ id, name, category, language, tags }));
      const data = { snippets, categories: [...new Set(all.map((s) => s.category))] };
      return { summary: `${snippets.length} snippet(s)`, output: JSON.stringify(data, null, 2), meta: { count: snippets.length } };
    },
  };
});

/* ---------------------------------------------------------- insert_snippet */

function insertText(before, text, line) {
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const body = text.replace(/\r?\n$/, '');
  if (line !== undefined) {
    let offset = 0;
    let n = 1;
    while (n < line && offset < before.length) {
      const i = before.indexOf('\n', offset);
      if (i === -1) { offset = before.length; break; }
      offset = i + 1;
      n++;
    }
    if (n === line && offset < before.length) {
      const indent = /^[ \t]*/.exec(before.slice(offset))[0];
      const block = indent + body.replace(/\r?\n([^\r\n])/g, `\n${indent}$1`).replace(/\r?\n/g, eol) + eol;
      return before.slice(0, offset) + block + before.slice(offset);
    }
  }
  const sep = before && !before.endsWith('\n') ? eol : '';
  return before + sep + body.replace(/\r?\n/g, eol) + eol;
}

const insertSnippet = tool({
  name: 'insert_snippet',
  description: 'Insere um snippet da biblioteca num arquivo do projeto, com as variáveis da marca trocadas '
    + '(em .jsx/.tsx o HTML vira JSX). Sem `line`, vai para o fim do arquivo. Cria o arquivo se não existir. Pode ser desfeito.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id do snippet (veja list_snippets).' },
      path: { type: 'string', description: 'Arquivo relativo à raiz do projeto.' },
      line: { type: 'integer', minimum: 1, description: 'Linha (1-based) antes da qual inserir.' },
    },
    required: ['id', 'path'],
  },
}, 'write', (input, ctx) => {
  const { store, variables } = runtime();
  if (typeof input.id !== 'string' || !input.id) throw new Error('Parâmetro "id" obrigatório');
  if (typeof input.path !== 'string' || !input.path) throw new Error('Parâmetro "path" obrigatório');
  if (input.line !== undefined && !(Number.isInteger(input.line) && input.line >= 1)) {
    throw new Error('Parâmetro "line" deve ser um inteiro ≥ 1');
  }
  const snippet = store.get(input.id);
  if (!snippet) throw new Error(`Snippet não encontrado: ${input.id} (use list_snippets)`);
  const abs = ctx.resolvePath(input.path);
  let st = null;
  try { st = fs.statSync(abs); } catch {}
  if (st?.isDirectory()) throw new Error(`É uma pasta: ${input.path}`);
  const before = st ? ctx.readTextFile(abs) : '';
  const text = renderSnippet(snippet, variables(), { jsx: isJsxPath(abs) });
  const after = insertText(before, text, input.line);
  return {
    title: `Inserir "${snippet.name}" em ${ctx.rel(abs)}`,
    preview: { diff: { path: abs, before, after } },
    run: async () => {
      const current = fs.existsSync(abs) ? ctx.readTextFile(abs) : '';
      if (current !== before) throw new Error(`${ctx.rel(abs)} mudou desde a prévia; tente de novo`);
      ctx.checkpoint?.recordParents?.(abs);
      ctx.checkpoint?.record(abs);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, after, 'utf8');
      const lines = text.replace(/\r?\n$/, '').split(/\r?\n/).length;
      return {
        summary: `+${lines} linha(s)`,
        output: `Snippet "${snippet.name}" inserido em ${ctx.rel(abs)} (+${lines} linhas).`,
        meta: { path: abs, id: snippet.id, added: lines },
        changed: [abs],
      };
    },
  };
});

/* ------------------------------------------------------------ save_snippet */

const saveSnippet = tool({
  name: 'save_snippet',
  description: 'Salva um novo snippet na biblioteca do usuário (aparece no módulo Snippets). Use {{cor_primaria}}, '
    + '{{cor_fundo}}, {{cor_texto}}, {{cor_secundaria}}, {{fonte}}, {{nome_marca}}, {{url_site}} e {{email_contato}} para a marca.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome curto e descritivo.' },
      category: { type: 'string', description: 'Categoria (ex.: Hero, CTA, Formulário, Cards).' },
      language: { type: 'string', enum: LANGUAGES, description: 'html, jsx, css ou tailwind (HTML com classes Tailwind).' },
      body: { type: 'string', description: 'Código do snippet.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Palavras-chave para a busca.' },
    },
    required: ['name', 'category', 'language', 'body'],
  },
}, 'write', (input) => {
  const { store } = runtime();
  const clean = cleanInput(input); // valida já no preparo (entrada inválida → negado)
  return {
    title: `Salvar snippet "${clean.name}" (${clean.category})`,
    preview: {},
    run: async () => {
      const saved = store.save(clean);
      return {
        summary: `Snippet salvo: ${saved.name}`,
        output: `Snippet "${saved.name}" salvo na biblioteca com id ${saved.id}.`,
        meta: { id: saved.id, name: saved.name },
      };
    },
  };
});

module.exports = [listSnippets, insertSnippet, saveSnippet];
