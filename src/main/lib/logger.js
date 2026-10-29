/**
 * Logger simples do main process, com rotação e redação de segredos.
 * Sem dependência do Electron: recebe o caminho do arquivo.
 */

const fs = require('fs');
const path = require('path');

function sanitize(text) {
  return String(text)
    .replace(/\b(sk-|ghp_|github_pat_|xox[bap]-)[A-Za-z0-9_-]+/g, '$1***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/("(?:api_?key|token|password|secret)"\s*:\s*")[^"]+(")/gi, '$1***$2');
}

function formatArg(arg) {
  if (arg instanceof Error) return sanitize(arg.stack || arg.message);
  if (typeof arg === 'string') return sanitize(arg);
  try {
    return sanitize(JSON.stringify(arg));
  } catch {
    return sanitize(String(arg));
  }
}

function createLogger({ filePath, maxBytes = 1_000_000, maxFiles = 5, now = () => new Date() } = {}) {
  if (!filePath) throw new Error('createLogger: filePath obrigatório');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  function rotate() {
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch { return; }
    if (size < maxBytes) return;
    for (let i = maxFiles - 1; i >= 1; i--) {
      const from = `${filePath}.${i}`;
      const to = `${filePath}.${i + 1}`;
      try { fs.renameSync(from, to); } catch {}
    }
    try { fs.renameSync(filePath, `${filePath}.1`); } catch {}
  }

  function write(level, args) {
    const line = `[${now().toISOString()}] ${level} ${args.map(formatArg).join(' ')}\n`;
    try {
      rotate();
      fs.appendFileSync(filePath, line, 'utf-8');
    } catch (e) {
      console.error('logger write error', e.message);
    }
  }

  return {
    filePath,
    info: (...args) => write('INFO', args),
    warn: (...args) => write('WARN', args),
    error: (...args) => write('ERROR', args),
  };
}

module.exports = { createLogger, sanitize };
