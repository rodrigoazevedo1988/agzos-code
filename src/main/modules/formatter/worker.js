/**
 * Agzos Formatador — formatação com o `prettier` (v3) embutido no app. Roda no processo
 * utilitário dos módulos (handler 'formatter.format' em ../worker.js), nunca no main.
 *
 * format({ text, filepath?, languageId?, options? }) → { text, parser }
 *   Opções passam por sanitizeOptions (lista branca; `plugins` nunca passa) e o parser é
 *   sempre um dos embutidos, escolhido pela extensão ou pela linguagem do editor.
 *   Nunca lê configuração do disco nem carrega o prettier/plugins do projeto.
 */

const path = require('path');
const { sanitizeOptions } = require('./config');

const MAX_TEXT = 4 * 1024 * 1024;

const BY_LANGUAGE = {
  javascript: 'babel', typescript: 'typescript', json: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'html', markdown: 'markdown', yaml: 'yaml',
};
const BY_EXT = {
  '.js': 'babel', '.mjs': 'babel', '.cjs': 'babel', '.jsx': 'babel',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
  '.json': 'json', '.jsonc': 'jsonc', '.json5': 'json5',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'html', '.htm': 'html', '.vue': 'vue',
  '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'mdx',
  '.yml': 'yaml', '.yaml': 'yaml',
};

function parserFor(languageId, filepath) {
  if (filepath) {
    const byExt = BY_EXT[path.extname(String(filepath)).toLowerCase()];
    if (byExt) return byExt;
  }
  return BY_LANGUAGE[languageId] || null;
}

let prettier = null;

async function format({ text, filepath, languageId, options } = {}) {
  if (typeof text !== 'string') throw new Error('Texto inválido');
  if (text.length > MAX_TEXT) throw new Error('Arquivo grande demais para formatar');
  const safe = sanitizeOptions(options);
  const parser = safe.parser || parserFor(languageId, filepath);
  if (!parser) throw new Error('Linguagem não suportada pelo Agzos Formatador');
  if (!prettier) prettier = require('prettier');
  const opts = { ...safe, parser };
  if (typeof filepath === 'string' && filepath) opts.filepath = filepath;
  const out = await prettier.format(text, opts);
  return { text: out, parser };
}

module.exports = { format, parserFor };
