/**
 * ~/.ssh/config — leitura (lista de hosts), acréscimo de bloco Host e
 * validação de alvos SSH. Puro (sem Electron); I/O só em collectHosts, por
 * funções injetáveis.
 *
 * Segurança: tudo que vira argumento do `ssh` passa por parseTarget/isSafeAlias.
 * Nada pode começar com `-` (viraria opção, ex.: -oProxyCommand) nem conter
 * espaço, aspas, `;`, `|`, `$`, crase, quebra de linha etc.
 */

const path = require('path');

const MAX_INCLUDE_DEPTH = 8; // OpenSSH aceita 16; para listar hosts 8 basta
const ALIAS_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const HOSTNAME_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]{0,252})$/;
const IPV6_RE = /^[0-9A-Fa-f:.]{2,45}$/;

/** Divide os argumentos de uma linha (respeita aspas duplas). */
function splitArgs(rest) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(rest))) out.push(m[1] != null ? m[1] : m[2]);
  return out;
}

/** "Chave valor", "Chave=valor" ou "Chave = valor" → { key (minúscula), args }. */
function parseLine(raw) {
  const line = String(raw).trim();
  if (!line || line.startsWith('#')) return null;
  const m = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.*)$/.exec(line);
  if (!m) return null;
  let rest = m[2];
  // Comentário no fim da linha (fora de aspas).
  let inQuote = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '#' && !inQuote && (i === 0 || /\s/.test(rest[i - 1]))) { rest = rest.slice(0, i); break; }
  }
  return { key: m[1].toLowerCase(), args: splitArgs(rest.trim()) };
}

function hasWildcard(pattern) {
  return /[*?!]/.test(pattern);
}

function validPort(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/^[0-9]{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * Hosts declarados (sem curingas). Opções globais e blocos Match são ignorados.
 * Como no OpenSSH, dentro de um bloco a primeira ocorrência de cada chave vence.
 * → [{ host, hostName?, user?, port?, identityFile? }]
 */
function parseSshConfig(text) {
  if (typeof text !== 'string' || !text) return [];
  const hosts = [];
  const seen = new Set();
  let current = null; // entradas do bloco Host atual

  for (const raw of text.split(/\r?\n/)) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const { key, args } = parsed;
    if (key === 'host') {
      current = [];
      for (const pattern of args) {
        if (hasWildcard(pattern) || seen.has(pattern)) continue;
        seen.add(pattern);
        const entry = { host: pattern };
        hosts.push(entry);
        current.push(entry);
      }
      continue;
    }
    if (key === 'match') { current = null; continue; }
    if (!current || !current.length || !args.length) continue;
    const value = args[0];
    for (const entry of current) {
      if (key === 'hostname' && entry.hostName === undefined) entry.hostName = value;
      else if (key === 'user' && entry.user === undefined) entry.user = value;
      else if (key === 'identityfile' && entry.identityFile === undefined) entry.identityFile = value;
      // Pasta remota (1.2.0) não suporta saltos: só marca para avisar com clareza.
      else if ((key === 'proxyjump' || key === 'proxycommand') && entry._proxySeen === undefined) {
        entry._proxySeen = true;
        if (value.toLowerCase() !== 'none') entry.proxy = true;
      }
      else if (key === 'port' && !('port' in entry) && !entry._portSeen) {
        entry._portSeen = true;
        const port = validPort(value);
        if (port) entry.port = port;
      }
    }
  }
  for (const h of hosts) { delete h._portSeen; delete h._proxySeen; }
  return hosts;
}

/** Caminhos citados em linhas Include (na ordem). */
function listIncludes(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const parsed = parseLine(raw);
    if (parsed && parsed.key === 'include') out.push(...parsed.args);
  }
  return out;
}

/** Glob simples (`*` e `?`) só no último segmento. */
function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*').replace(/\?/g, '[^/\\\\]');
  return new RegExp(`^${esc}$`);
}

function expandInclude(spec, { home, readDir }) {
  const sshDir = path.join(home, '.ssh');
  let p = spec;
  if (p === '~' || p.startsWith('~/')) p = path.join(home, p.slice(2));
  else if (!path.isAbsolute(p)) p = path.join(sshDir, p);
  const dir = path.dirname(p);
  const base = path.basename(p);
  if (/[*?[]/.test(dir)) return []; // curinga em diretório: não suportado
  if (!/[*?]/.test(base)) return [p];
  let names;
  try { names = readDir(dir); } catch { return []; }
  const re = globToRegExp(base);
  return names.filter((n) => re.test(n)).sort().map((n) => path.join(dir, n));
}

/**
 * Hosts de ~/.ssh/config, seguindo Include (recursivo, sem ciclos). Os hosts
 * de um arquivo incluído entram na posição da linha Include.
 * fs: { readFile(path) → string (lança se não existir), readDir(dir) → string[] }
 */
function collectHosts({ home, fs: fsx, configPath = path.join(home, '.ssh', 'config') }) {
  const visited = new Set();
  const all = [];

  function walk(file, depth) {
    if (depth > MAX_INCLUDE_DEPTH || visited.has(file)) return;
    visited.add(file);
    let text;
    try { text = fsx.readFile(file); } catch { return; }
    if (typeof text !== 'string') return;
    // Percorre em ordem, intercalando Include e blocos.
    let chunk = [];
    const flush = () => {
      for (const h of parseSshConfig(chunk.join('\n'))) {
        const prev = all.find((x) => x.host === h.host);
        if (!prev) { all.push(h); continue; }
        // Mesmo bloco retomado depois de um Include: completa o que faltava.
        for (const [k, v] of Object.entries(h)) if (prev[k] === undefined) prev[k] = v;
      }
      chunk = [];
    };
    for (const raw of text.split(/\r?\n/)) {
      const parsed = parseLine(raw);
      if (parsed && parsed.key === 'include') {
        // O bloco Host atual continua depois do Include: guarda o cabeçalho.
        const lastHost = [...chunk].reverse().find((l) => { const p = parseLine(l); return p && (p.key === 'host' || p.key === 'match'); });
        flush();
        for (const spec of parsed.args) {
          for (const f of expandInclude(spec, { home, readDir: fsx.readDir })) walk(f, depth + 1);
        }
        if (lastHost) chunk.push(lastHost);
        continue;
      }
      chunk.push(raw);
    }
    flush();
  }

  walk(configPath, 0);
  return all;
}

function isSafeAlias(alias) {
  return typeof alias === 'string' && ALIAS_RE.test(alias);
}

function isSafeUser(user) {
  return typeof user === 'string' && USER_RE.test(user);
}

function isSafeHost(host) {
  if (typeof host !== 'string' || !host) return false;
  if (host.includes(':')) return IPV6_RE.test(host) && (host.match(/:/g) || []).length >= 2;
  return HOSTNAME_RE.test(host);
}

/**
 * "usuario@host[:porta]" (usuário opcional; IPv6 entre colchetes) →
 * { user, host, port } ou null se inválido/inseguro.
 */
function parseTarget(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > 300) return null;
  const m = /^(?:([^@]+)@)?(\[[^\]]*\]|[^:@[\]]+)(?::([^:]*))?$/.exec(s);
  if (!m) return null;
  const user = m[1] != null ? m[1] : null;
  let host = m[2];
  if (host.startsWith('[')) {
    host = host.slice(1, -1);
    if (!host.includes(':') || !isSafeHost(host)) return null;
  } else if (!HOSTNAME_RE.test(host)) {
    return null;
  }
  if (user != null && !isSafeUser(user)) return null;
  let port = null;
  if (m[3] !== undefined) {
    port = validPort(m[3]);
    if (!port) return null;
  }
  return { user, host, port };
}

/**
 * Argumentos do `ssh` (sem shell): alias do config → [alias];
 * alvo → ['-p', porta, 'user@host'] (porta e usuário opcionais).
 * Lança "Alvo SSH inválido" se algo não passar na validação.
 */
function buildSshArgs(target) {
  const fail = () => { throw new Error('Alvo SSH inválido.'); };
  if (typeof target === 'string') {
    if (isSafeAlias(target)) return [target];
    const t = parseTarget(target);
    if (!t) fail();
    return buildSshArgs(t);
  }
  if (!target || typeof target !== 'object') fail();
  if (target.alias != null) {
    if (!isSafeAlias(target.alias)) fail();
    return [target.alias];
  }
  const { user, host } = target;
  if (!isSafeHost(host)) fail();
  if (user != null && user !== '' && !isSafeUser(user)) fail();
  const args = [];
  if (target.port != null && target.port !== '') {
    const port = validPort(target.port);
    if (!port) fail();
    args.push('-p', String(port));
  }
  args.push(user ? `${user}@${host}` : host);
  return args;
}

/**
 * Acrescenta um bloco Host ao fim do texto, sem tocar no resto (o texto
 * original é prefixo exato do resultado). Usa o fim de linha do arquivo.
 */
function appendHost(text, { alias, hostName, user, port } = {}) {
  const before = typeof text === 'string' ? text : '';
  if (!isSafeAlias(alias)) throw new Error('Apelido inválido: use letras, números, ".", "_" ou "-" (sem espaços nem curingas).');
  if (!isSafeHost(hostName)) throw new Error('Host inválido.');
  if (user != null && user !== '' && !isSafeUser(user)) throw new Error('Usuário inválido.');
  let portNum = null;
  if (port != null && port !== '') {
    portNum = validPort(port);
    if (!portNum) throw new Error('Porta inválida (1–65535).');
  }
  if (parseSshConfig(before).some((h) => h.host === alias)) throw new Error(`O host "${alias}" já existe no config.`);

  const eol = /\r\n/.test(before) ? '\r\n' : '\n';
  const lines = [`Host ${alias}`, `  HostName ${hostName}`];
  if (user) lines.push(`  User ${user}`);
  if (portNum) lines.push(`  Port ${portNum}`);
  const block = lines.join(eol) + eol;
  if (!before) return block;
  const sep = before.endsWith('\n') ? eol : eol + eol;
  return before + sep + block;
}

module.exports = {
  parseSshConfig,
  listIncludes,
  collectHosts,
  appendHost,
  parseTarget,
  buildSshArgs,
  isSafeAlias,
  isSafeUser,
  isSafeHost,
  validPort,
};
