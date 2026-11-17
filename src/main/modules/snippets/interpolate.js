/**
 * Variáveis da marca nos snippets: `{{nome}}` → valor. Variável desconhecida fica como está.
 * Variáveis vêm de settings.modules.snippets.variables ([{ name, value }]) ou de um objeto.
 * O valor entra literal (sem padrões de replace) e não é interpolado de novo.
 */

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** [{ name, value }] | { nome: valor } → objeto sem protótipo (última definição vence). */
function variablesMap(variables) {
  const out = Object.create(null);
  const put = (name, value) => {
    if (typeof name === 'string' && NAME_RE.test(name) && typeof value === 'string') out[name] = value;
  };
  if (Array.isArray(variables)) {
    for (const v of variables) if (v && typeof v === 'object') put(v.name, v.value);
  } else if (variables && typeof variables === 'object') {
    for (const [k, v] of Object.entries(variables)) put(k, v);
  }
  return out;
}

function interpolate(body, variables) {
  if (typeof body !== 'string') return '';
  const map = variablesMap(variables);
  return body.replace(TOKEN_RE, (whole, name) => (Object.hasOwn(map, name) ? map[name] : whole));
}

module.exports = { interpolate, variablesMap, NAME_RE };
