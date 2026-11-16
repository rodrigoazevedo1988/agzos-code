/**
 * IPC: portas TCP em escuta (ports:list).
 *
 * Windows: `netstat -ano -p tcp` + `tasklist /fo csv /nh` (nomes dos processos).
 * Linux:   `ss -ltnpH` (fallback `netstat -ltnp`).
 * macOS:   `lsof -nP -iTCP -sTCP:LISTEN`.
 *
 * Sempre execFile sem shell, timeout de 5s. Parsers puros exportados para teste.
 */

const { execFile } = require('child_process');

const TIMEOUT_MS = 5000;
const MAX_BUFFER = 8 * 1024 * 1024;

/** Separa "endereço:porta" (IPv4, [IPv6], IPv6 sem colchetes, *). */
function splitHostPort(value) {
  const s = String(value || '').trim();
  const idx = s.lastIndexOf(':');
  if (idx <= 0 && !s.startsWith(':')) return null;
  const port = Number(s.slice(idx + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  let address = s.slice(0, idx);
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  address = address.replace(/%[^%]*$/, ''); // zona/interface: 127.0.0.53%lo, fe80::1%eth0
  if (!address) return null;
  return { address, port };
}

function toPid(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `netstat -ano -p tcp` (Windows). Estado pode vir traduzido: usa também o remoto :0. */
function parseNetstatWindows(stdout) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || !/^TCP(v6)?$/i.test(cols[0])) continue;
    const local = splitHostPort(cols[1]);
    const remote = cols[2];
    const hasState = cols.length >= 5;
    const state = hasState ? cols[3] : '';
    const pid = toPid(cols[cols.length - 1]);
    const listening = /^LISTEN/i.test(state) || /^(0\.0\.0\.0|\[::\]|\*):(0|\*)$/.test(remote);
    if (!local || !listening) continue;
    out.push({ port: local.port, address: local.address, pid, process: null });
  }
  return out;
}

/** Divide uma linha CSV simples (campos entre aspas, "" escapado). */
function splitCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

/** `tasklist /fo csv /nh` → Map<pid, nome>. */
function parseTasklistCsv(stdout) {
  const map = new Map();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = splitCsvLine(line.trim());
    const pid = toPid(f[1]);
    if (f[0] && pid) map.set(pid, f[0]);
  }
  return map;
}

/** `ss -ltnpH` (Linux). Tolera cabeçalho. */
function parseSs(stdout) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0] !== 'LISTEN') continue;
    const local = splitHostPort(cols[3]);
    if (!local) continue;
    const rest = cols.slice(5).join(' ');
    const m = /\(\("((?:[^"\\]|\\.)*)",pid=(\d+)/.exec(rest);
    out.push({ port: local.port, address: local.address, pid: m ? toPid(m[2]) : null, process: m ? m[1] : null });
  }
  return out;
}

/** `netstat -ltnp` (Linux, fallback). */
function parseNetstatLinux(stdout) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6 || !/^tcp6?$/.test(cols[0]) || cols[5] !== 'LISTEN') continue;
    const local = splitHostPort(cols[3]);
    if (!local) continue;
    const m = /^(\d+)\/(.+)$/.exec(cols.slice(6).join(' '));
    out.push({ port: local.port, address: local.address, pid: m ? toPid(m[1]) : null, process: m ? m[2].trim() : null });
  }
  return out;
}

/** `lsof -nP -iTCP -sTCP:LISTEN` (macOS). */
function parseLsof(stdout) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /\bTCP\s+(\S+)\s+\(LISTEN\)\s*$/.exec(line);
    if (!m) continue;
    const cols = line.trim().split(/\s+/);
    const local = splitHostPort(m[1]);
    if (!local) continue;
    const name = cols[0].replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    out.push({ port: local.port, address: local.address, pid: toPid(cols[1]), process: name || null });
  }
  return out;
}

/** Remove duplicados (porta+endereço, mantém o primeiro com pid) e ordena. */
function normalizePorts(list) {
  const byKey = new Map();
  for (const p of list) {
    const key = `${p.port}|${p.address}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { ...p });
    else {
      if (prev.pid == null && p.pid != null) prev.pid = p.pid;
      if (!prev.process && p.process) prev.process = p.process;
    }
  }
  return [...byKey.values()].sort((a, b) => a.port - b.port || String(a.address).localeCompare(String(b.address)));
}

function defaultRun(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_BUFFER, shell: false }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else resolve(String(stdout));
    });
  });
}

function errMessage(err) {
  return (err && (err.code === 'ENOENT' ? `${err.path || 'comando'} não encontrado` : err.message)) || String(err);
}

/** Lista portas TCP em LISTEN. Injetável: { platform, run(cmd, args) → Promise<stdout> }. */
async function listPorts({ platform = process.platform, run = defaultRun } = {}) {
  try {
    if (platform === 'win32') {
      const ports = parseNetstatWindows(await run('netstat', ['-ano', '-p', 'tcp']));
      try {
        const names = parseTasklistCsv(await run('tasklist', ['/fo', 'csv', '/nh']));
        for (const p of ports) if (p.pid != null && names.has(p.pid)) p.process = names.get(p.pid);
      } catch {} // sem nomes, só PIDs
      return { ports: normalizePorts(ports) };
    }
    if (platform === 'darwin') {
      let stdout;
      try {
        stdout = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
      } catch (err) {
        // lsof sai com 1 quando não há resultados.
        if (err && err.code === 1 && !String(err.stderr || '').trim()) stdout = String(err.stdout || '');
        else throw err;
      }
      return { ports: normalizePorts(parseLsof(stdout)) };
    }
    try {
      return { ports: normalizePorts(parseSs(await run('ss', ['-ltnpH']))) };
    } catch (ssErr) {
      try {
        return { ports: normalizePorts(parseNetstatLinux(await run('netstat', ['-ltnp']))) };
      } catch {
        throw ssErr;
      }
    }
  } catch (err) {
    return { ports: [], error: errMessage(err) };
  }
}

function register(ipcMain) {
  ipcMain.handle('ports:list', () => listPorts());
}

module.exports = {
  register,
  listPorts,
  // exportados para testes
  splitHostPort,
  parseNetstatWindows,
  parseTasklistCsv,
  parseSs,
  parseNetstatLinux,
  parseLsof,
  normalizePorts,
};
