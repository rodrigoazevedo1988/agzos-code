'use strict';

/**
 * Ambiente "fresco" para terminais no Windows.
 *
 * Processos herdam o ambiente do momento em que foram criados. Se o usuário
 * altera/remove uma variável (Configurações do Windows, `setx`), o Agzos Code
 * aberto continua com o valor antigo e todo shell novo herda essa cópia velha.
 * O Windows Terminal resolve relendo o registro a cada aba; fazemos o mesmo:
 * guardamos o ambiente do registro no início do app, relemos ao criar cada
 * shell e aplicamos só a diferença sobre process.env — variáveis definidas
 * pelo próprio processo (não vindas do registro) são preservadas.
 */

const { execFileSync } = require('child_process');

const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
const USER_KEY = 'HKCU\\Environment';
const VOLATILE_KEY = 'HKCU\\Volatile Environment';

// Variáveis que o Windows gera para toda sessão (CreateEnvironmentBlock) e que
// não ficam nas chaves Environment do registro: mantidas do processo.
const SYSTEM_VARS = new Set([
  'allusersprofile', 'appdata', 'commonprogramfiles', 'commonprogramfiles(x86)', 'commonprogramw6432',
  'computername', 'comspec', 'driverdata', 'homedrive', 'homepath', 'homeshare', 'localappdata',
  'logonserver', 'number_of_processors', 'os', 'pathext', 'processor_architecture',
  'processor_identifier', 'processor_level', 'processor_revision', 'programdata', 'programfiles',
  'programfiles(x86)', 'programw6432', 'psmodulepath', 'public', 'sessionname', 'systemdrive',
  'systemroot', 'temp', 'tmp', 'userdomain', 'userdomain_roamingprofile', 'username', 'userprofile', 'windir',
]);

/** Interpreta a saída de `reg query <chave>` em { NOME: valor }. */
function parseRegQuery(stdout) {
  const vars = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^\s{2,}(.+?)\s{2,}(REG_SZ|REG_EXPAND_SZ)\s{2,}(.*)$/.exec(line);
    if (m) vars[m[1]] = m[3];
    else {
      const empty = /^\s{2,}(.+?)\s{2,}(REG_SZ|REG_EXPAND_SZ)\s*$/.exec(line);
      if (empty) vars[empty[1]] = '';
    }
  }
  return vars;
}

function findKey(obj, name) {
  const lower = name.toLowerCase();
  return Object.keys(obj).find((k) => k.toLowerCase() === lower);
}

function getVar(obj, name) {
  const key = findKey(obj, name);
  return key === undefined ? undefined : obj[key];
}

/** Expande %VAR% (case-insensitive) usando `env`; desconhecidas ficam como estão. */
function expandVars(value, env) {
  return String(value).replace(/%([^%;=]+)%/g, (whole, name) => {
    const v = getVar(env, name);
    return v === undefined ? whole : v;
  });
}

function joinPath(...parts) {
  return parts.filter((p) => p && p.trim()).join(';');
}

/**
 * Combina máquina + usuário como o Windows faz: usuário sobrescreve máquina,
 * exceto Path, que é concatenado (máquina;usuário). Valores são expandidos.
 */
function buildRegistryEnv(machine, user, baseEnv = {}) {
  const merged = {};
  for (const [k, v] of Object.entries(machine)) merged[k] = v;
  for (const [k, v] of Object.entries(user)) {
    const existing = findKey(merged, k);
    if (existing !== undefined && existing !== k) delete merged[existing];
    merged[k] = v;
  }
  const machinePath = getVar(machine, 'Path');
  const userPath = getVar(user, 'Path');
  const pathKey = findKey(merged, 'Path');
  if (pathKey !== undefined) delete merged[pathKey];
  if (machinePath !== undefined || userPath !== undefined) merged.Path = joinPath(machinePath, userPath);

  const scope = { ...baseEnv, ...merged };
  const out = {};
  for (const [k, v] of Object.entries(merged)) out[k] = expandVars(v, scope);
  return out;
}

function splitPath(value) {
  return String(value || '').split(';').map((s) => s.trim()).filter(Boolean);
}

/**
 * Aplica sobre `baseEnv` (process.env) as mudanças do registro desde `startup`.
 * - removida do registro e ainda com o valor de startup em baseEnv: remove;
 * - nova ou alterada no registro: aplica o valor atual;
 * - Path: valor atual do registro + entradas que o processo acrescentou.
 */
function refreshEnv(baseEnv, startup, current) {
  const env = { ...baseEnv };
  for (const [k, oldValue] of Object.entries(startup)) {
    if (k.toLowerCase() === 'path') continue;
    if (getVar(current, k) !== undefined) continue;
    const key = findKey(env, k);
    if (key !== undefined && env[key] === oldValue) delete env[key];
  }
  for (const [k, value] of Object.entries(current)) {
    if (k.toLowerCase() === 'path') continue;
    if (getVar(startup, k) === value && getVar(env, k) !== undefined) continue;
    const key = findKey(env, k);
    if (key !== undefined) delete env[key];
    env[key ?? k] = value;
  }
  const startupPath = getVar(startup, 'Path');
  const currentPath = getVar(current, 'Path');
  if (currentPath !== undefined) {
    const pathKey = findKey(env, 'Path') ?? 'Path';
    const startupSet = new Set(splitPath(startupPath).map((s) => s.toLowerCase()));
    const currentList = splitPath(currentPath);
    const currentSet = new Set(currentList.map((s) => s.toLowerCase()));
    const added = splitPath(env[pathKey]).filter((p) => !startupSet.has(p.toLowerCase()) && !currentSet.has(p.toLowerCase()));
    env[pathKey] = [...added, ...currentList].join(';');
  }
  return env;
}

function queryKey(key, exec = execFileSync) {
  try {
    const out = exec('reg', ['query', key], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    return parseRegQuery(out);
  } catch {
    return {};
  }
}

/** Lê o ambiente atual do registro (vazio fora do Windows ou em erro). */
function readRegistryEnv({ platform = process.platform, exec = execFileSync, baseEnv = process.env } = {}) {
  if (platform !== 'win32') return null;
  const machine = queryKey(MACHINE_KEY, exec);
  if (!Object.keys(machine).length) return null; // leitura falhou: não arriscar
  const user = { ...queryKey(VOLATILE_KEY, exec), ...queryKey(USER_KEY, exec) };
  return buildRegistryEnv(machine, user, baseEnv);
}

let startupSnapshot = null;

/** Chamar uma vez no início do app (antes de qualquer mudança). */
function captureStartupEnv(opts) {
  startupSnapshot = readRegistryEnv(opts);
  return startupSnapshot;
}

/**
 * Ambiente "limpo", como o Windows Terminal: só variáveis do sistema/sessão
 * e as do registro atual. Descarta o que o processo herdou de quem abriu o
 * app (ex.: ANTHROPIC_* de um terminal antigo ou de outro programa).
 */
function cleanEnv(baseEnv, current) {
  const env = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (SYSTEM_VARS.has(k.toLowerCase())) env[k] = v;
  }
  for (const [k, v] of Object.entries(current)) {
    const key = findKey(env, k);
    if (key !== undefined) delete env[key];
    env[k] = v;
  }
  return env;
}

/**
 * Ambiente para um shell novo no Windows. Padrão: limpo a partir do registro
 * (AGZOS_TERM_INHERIT_ENV=1 volta a herdar process.env + diferenças do registro).
 */
function freshEnv(opts = {}) {
  const baseEnv = opts.baseEnv || process.env;
  if ((opts.platform || process.platform) !== 'win32') return { ...baseEnv };
  const current = readRegistryEnv(opts);
  if (!current || getVar(current, 'Path') === undefined) return { ...baseEnv };
  if (getVar(baseEnv, 'AGZOS_TERM_INHERIT_ENV') !== '1') return cleanEnv(baseEnv, current);
  if (!startupSnapshot) return { ...baseEnv };
  return refreshEnv(baseEnv, startupSnapshot, current);
}

module.exports = {
  parseRegQuery,
  expandVars,
  buildRegistryEnv,
  refreshEnv,
  cleanEnv,
  readRegistryEnv,
  captureStartupEnv,
  freshEnv,
};
