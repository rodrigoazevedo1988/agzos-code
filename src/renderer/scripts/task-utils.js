/**
 * Tarefas — lógica pura (sem DOM), testável em Node.
 *  - runFileCommand: comando para executar o arquivo ativo no terminal
 *  - parseScripts / npmRunCommand: scripts do package.json da raiz
 */

function quote(p, platform) {
  if (platform === 'win32') return `"${p}"`;
  // Dentro de aspas duplas no sh/bash/zsh: escapa \ " $ `
  return `"${String(p).replace(/[\\"$`]/g, '\\$&')}"`;
}

function extOf(p) {
  const name = String(p || '').split(/[\\/]/).pop();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Comando para rodar `filePath` no terminal, ou null se a extensão não é suportada. */
export function runFileCommand(filePath, platform = 'linux') {
  const win = platform === 'win32';
  const q = quote(filePath, platform);
  switch (extOf(filePath)) {
    case 'js': case 'mjs': case 'cjs': return `node ${q}`;
    case 'ts': case 'mts': case 'cts': return `npx tsx ${q}`;
    case 'py': return `${win ? 'python' : 'python3'} ${q}`;
    case 'sh': return `bash ${q}`;
    case 'ps1': return win ? `powershell -NoProfile -ExecutionPolicy Bypass -File ${q}` : null;
    default: return null;
  }
}

/** Extensões aceitas por runFileCommand (para a mensagem de erro). */
export const RUNNABLE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.ps1 (Windows)'];

/**
 * Scripts do package.json: [{ name, command }]. JSON inválido → null.
 */
export function parseScripts(text) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return null;
  }
  const scripts = pkg && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts) ? pkg.scripts : {};
  return Object.entries(scripts)
    .filter(([, cmd]) => typeof cmd === 'string')
    .map(([name, command]) => ({ name, command }));
}

export function npmRunCommand(name) {
  return /^[\w:.@/-]+$/.test(name) ? `npm run ${name}` : `npm run "${String(name).replace(/"/g, '\\"')}"`;
}
