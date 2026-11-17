/**
 * Corpo final de um snippet para inserir: variáveis trocadas e, em destino JSX, HTML → JSX
 * (só para snippets html/tailwind; jsx e css entram como estão).
 */

const { interpolate } = require('./interpolate');
const { htmlToJsx } = require('./jsx');

function renderSnippet(snippet, variables, { jsx = false } = {}) {
  const text = interpolate(snippet.body, variables);
  const convert = jsx && (snippet.language === 'html' || snippet.language === 'tailwind');
  return convert ? htmlToJsx(text) : text;
}

module.exports = { renderSnippet };
