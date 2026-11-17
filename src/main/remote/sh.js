/**
 * Comandos remotos com aspas POSIX seguras. Todo comando que vai para o host
 * passa por aqui: cada argumento vira uma string entre aspas simples
 * (`'` → `'\''`), então espaço, aspas, `$()`, crase, `;`, `|`, `&` e quebras de
 * linha chegam literais. Nada é concatenado cru.
 */

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shQuote(s) {
  const str = String(s);
  if (str.includes('\0')) throw new Error('Argumento com NUL não é permitido.');
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

/**
 * Linha de comando completa: `cd <cwd> && env K=V … <cmd> <args…>`.
 * cmd e args sempre entre aspas; env só com nomes válidos.
 */
function buildCommand(cmd, args = [], { cwd, env } = {}) {
  if (typeof cmd !== 'string' || !cmd) throw new Error('Comando remoto inválido.');
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string' && typeof a !== 'number')) {
    throw new Error('Argumentos do comando remoto inválidos.');
  }
  const parts = [];
  if (cwd) parts.push(`cd ${shQuote(cwd)} &&`);
  const envEntries = Object.entries(env || {});
  if (envEntries.length) {
    parts.push('env');
    for (const [k, v] of envEntries) {
      if (!ENV_NAME_RE.test(k)) throw new Error(`Variável de ambiente inválida: ${k}`);
      parts.push(`${k}=${shQuote(v)}`);
    }
  }
  parts.push(shQuote(cmd), ...args.map((a) => shQuote(a)));
  return parts.join(' ');
}

module.exports = { shQuote, buildCommand };
