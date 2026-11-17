/**
 * Tarefas — lógica pura (sem DOM), testável em Node.
 *  - runFileCommand: comando para executar o arquivo ativo no terminal
 *  - parseScripts / npmRunCommand: scripts do package.json da raiz
 *
 * Aspas por shell (o caminho/nome vem do projeto e pode ser hostil):
 *  - POSIX (bash/zsh/sh/fish/WSL/Git Bash): aspas simples, ' vira '\''
 *  - PowerShell: aspas simples, ' (e aspas tipográficas) dobradas, comando com prefixo `& `
 *  - cmd: aspas duplas; caminho com % ^ & | " é recusado (não há escape seguro)
 * Caracteres de controle (quebra de linha etc.) são recusados em qualquer shell.
 * Recusas lançam TaskCommandError com mensagem para o usuário (toast).
 */

export class TaskCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TaskCommandError';
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const CMD_UNSAFE = /[%^&|"]/;
const NPM_SCRIPT = /^[\w:.@/+-]+$/;

/** Tipo de shell pelo caminho/nome: 'posix' | 'powershell' | 'cmd'. */
export function shellKind(shell, platform = 'linux') {
  const base = String(shell || '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  if (base === 'pwsh' || base === 'powershell') return 'powershell';
  if (base === 'cmd') return 'cmd';
  if (!base) return platform === 'win32' ? 'powershell' : 'posix';
  return 'posix';
}

function quote(p, kind) {
  const s = String(p);
  if (CONTROL.test(s)) throw new TaskCommandError('O caminho tem caracteres de controle (ex.: quebra de linha); renomeie o arquivo para executar.');
  if (kind === 'cmd') {
    if (CMD_UNSAFE.test(s)) throw new TaskCommandError('O caminho tem caracteres que o cmd não deixa escapar com segurança (% ^ & | "). Renomeie o arquivo ou use um terminal PowerShell/bash.');
    return `"${s}"`;
  }
  if (kind === 'powershell') return `'${s.replace(/['‘’‚‛]/g, '$&$&')}'`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function extOf(p) {
  const name = String(p || '').split(/[\\/]/).pop();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Comando para rodar `filePath` no terminal (`shell` = caminho/nome do shell da sessão;
 * vazio = padrão do SO), ou null se a extensão não é suportada.
 * Lança TaskCommandError se o caminho não pode ser passado com segurança.
 */
export function runFileCommand(filePath, platform = 'linux', shell = null) {
  const win = platform === 'win32';
  const kind = shellKind(shell, platform);
  let head;
  switch (extOf(filePath)) {
    case 'js': case 'mjs': case 'cjs': head = 'node'; break;
    case 'ts': case 'mts': case 'cts': head = 'npx tsx'; break;
    case 'py': head = win ? 'python' : 'python3'; break;
    case 'sh': head = 'bash'; break;
    case 'ps1': if (!win) return null; head = 'powershell -NoProfile -ExecutionPolicy Bypass -File'; break;
    default: return null;
  }
  const cmd = `${head} ${quote(filePath, kind)}`;
  return kind === 'powershell' ? `& ${cmd}` : cmd;
}

/** A extensão tem interpretador conhecido? (sem montar o comando) */
export function isRunnableFile(filePath, platform = 'linux') {
  const ext = extOf(filePath);
  if (ext === 'ps1') return platform === 'win32';
  return ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'py', 'sh'].includes(ext);
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

/** `npm run <nome>` só para nomes simples; o resto é recusado (TaskCommandError). */
export function npmRunCommand(name) {
  if (typeof name !== 'string' || !NPM_SCRIPT.test(name)) {
    throw new TaskCommandError(`O script "${String(name).slice(0, 60)}" tem caracteres não permitidos; use letras, números e : . @ / + - _ no nome.`);
  }
  return `npm run ${name}`;
}
