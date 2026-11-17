const { test } = require('node:test');
const assert = require('node:assert/strict');

const ports = require('../../src/main/ipc/ports');

const { parseNetstatWindows, parseTasklistCsv, parseSs, parseNetstatLinux, parseLsof, normalizePorts, splitHostPort, listPorts } = ports;

const NETSTAT_WIN = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1092
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       8420
  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       3312
  TCP    192.168.0.10:52011     140.82.112.25:443      ESTABLISHED     9001
  TCP    [::]:3000              [::]:0                 LISTENING       8420
  TCP    [::1]:9222             [::]:0                 LISTENING       7777
  TCP    [::1]:49800            [::1]:9222             ESTABLISHED     7777
`;

const NETSTAT_WIN_PT = `
  Proto  Endereço local         Endereço externo       Estado          PID
  TCP    0.0.0.0:8080           0.0.0.0:0              ESCUTANDO       4321
  TCP    10.0.0.2:50000         1.2.3.4:443            ESTABELECIDA    4321
`;

const TASKLIST = `"System Idle Process","0","Services","0","8 K"
"svchost.exe","1092","Services","0","12.345 K"
"node.exe","8420","Console","1","80.120 K"
"postgres.exe","3312","Services","0","9.000 K"
"Google ""Chrome"".exe","7777","Console","1","1 K"
`;

const SS = `LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*
LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=1234,fd=6),("nginx",pid=1235,fd=6))
LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=1235,fd=6))
LISTEN 0      4096            [::]:3000          [::]:*    users:(("node",pid=99,fd=20))
LISTEN 0      128        127.0.0.1:5432       0.0.0.0:*
LISTEN 0      511                *:8080             *:*    users:(("python3",pid=55,fd=3))
`;

const NETSTAT_LINUX = `Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      812/sshd: /usr/sbin
tcp        0      0 127.0.0.1:5432          0.0.0.0:*               LISTEN      -
tcp6       0      0 :::3000                 :::*                    LISTEN      99/node
`;

const LSOF = `COMMAND     PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
rapportd    456 rod    4u  IPv4 0x1a2b3c4d5e6f7a8b      0t0  TCP *:49152 (LISTEN)
node      12345 rod   23u  IPv6 0x1a2b3c4d5e6f7a8c      0t0  TCP *:3000 (LISTEN)
node      12345 rod   24u  IPv4 0x1a2b3c4d5e6f7a8d      0t0  TCP 127.0.0.1:9229 (LISTEN)
Google\\x20  789 rod   50u  IPv6 0x1a2b3c4d5e6f7a8e      0t0  TCP [::1]:9222 (LISTEN)
postgres    300 rod    7u  IPv4 0x1a2b3c4d5e6f7a8f      0t0  TCP 0.0.0.0:5432 (LISTEN)
`;

test('splitHostPort: formatos comuns', () => {
  assert.deepEqual(splitHostPort('0.0.0.0:80'), { address: '0.0.0.0', port: 80 });
  assert.deepEqual(splitHostPort('[::]:3000'), { address: '::', port: 3000 });
  assert.deepEqual(splitHostPort(':::3000'), { address: '::', port: 3000 });
  assert.deepEqual(splitHostPort('*:8080'), { address: '*', port: 8080 });
  assert.deepEqual(splitHostPort('127.0.0.53%lo:53'), { address: '127.0.0.53', port: 53 });
  assert.equal(splitHostPort('garbage'), null);
  assert.equal(splitHostPort('1.2.3.4:x'), null);
});

test('parseNetstatWindows: só LISTENING, IPv4 e IPv6', () => {
  const r = parseNetstatWindows(NETSTAT_WIN);
  assert.deepEqual(r, [
    { port: 135, address: '0.0.0.0', pid: 1092, process: null },
    { port: 3000, address: '0.0.0.0', pid: 8420, process: null },
    { port: 5432, address: '127.0.0.1', pid: 3312, process: null },
    { port: 3000, address: '::', pid: 8420, process: null },
    { port: 9222, address: '::1', pid: 7777, process: null },
  ]);
});

test('parseNetstatWindows: estado traduzido usa o remoto :0', () => {
  assert.deepEqual(parseNetstatWindows(NETSTAT_WIN_PT), [{ port: 8080, address: '0.0.0.0', pid: 4321, process: null }]);
});

test('parseTasklistCsv: pid → nome, aspas escapadas', () => {
  const m = parseTasklistCsv(TASKLIST);
  assert.equal(m.get(8420), 'node.exe');
  assert.equal(m.get(7777), 'Google "Chrome".exe');
  assert.equal(m.has(0), false);
});

test('parseSs: processo, sem processo, IPv6, *', () => {
  const r = parseSs(SS);
  assert.deepEqual(r[0], { port: 53, address: '127.0.0.53', pid: null, process: null });
  assert.deepEqual(r[1], { port: 80, address: '0.0.0.0', pid: 1234, process: 'nginx' });
  assert.deepEqual(r[3], { port: 3000, address: '::', pid: 99, process: 'node' });
  assert.deepEqual(r[5], { port: 8080, address: '*', pid: 55, process: 'python3' });
  assert.equal(parseSs('State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n').length, 0);
});

test('parseNetstatLinux: fallback', () => {
  assert.deepEqual(parseNetstatLinux(NETSTAT_LINUX), [
    { port: 22, address: '0.0.0.0', pid: 812, process: 'sshd: /usr/sbin' },
    { port: 5432, address: '127.0.0.1', pid: null, process: null },
    { port: 3000, address: '::', pid: 99, process: 'node' },
  ]);
});

test('parseLsof: macOS', () => {
  const r = parseLsof(LSOF);
  assert.equal(r.length, 5);
  assert.deepEqual(r[1], { port: 3000, address: '*', pid: 12345, process: 'node' });
  assert.deepEqual(r[3], { port: 9222, address: '::1', pid: 789, process: 'Google ' });
  assert.deepEqual(r[4], { port: 5432, address: '0.0.0.0', pid: 300, process: 'postgres' });
});

test('normalizePorts: dedup porta+endereço e ordena', () => {
  const r = normalizePorts(parseSs(SS));
  assert.deepEqual(r.map((p) => `${p.port}@${p.address}`), ['53@127.0.0.53', '80@0.0.0.0', '3000@::', '5432@127.0.0.1', '8080@*']);
  assert.equal(r[1].pid, 1234);
});

test('listPorts: Windows junta netstat + tasklist', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    return cmd === 'netstat' ? NETSTAT_WIN : TASKLIST;
  };
  const { ports: list, error } = await listPorts({ platform: 'win32', run });
  assert.equal(error, undefined);
  assert.deepEqual(calls, ['netstat -ano -p tcp', 'tasklist /fo csv /nh']);
  assert.deepEqual(list.find((p) => p.port === 3000 && p.address === '0.0.0.0'), { port: 3000, address: '0.0.0.0', pid: 8420, process: 'node.exe' });
  assert.deepEqual(list.map((p) => p.port), [135, 3000, 3000, 5432, 9222]);
});

test('listPorts: Windows sem tasklist ainda lista PIDs', async () => {
  const run = async (cmd) => { if (cmd === 'tasklist') throw new Error('x'); return NETSTAT_WIN; };
  const { ports: list } = await listPorts({ platform: 'win32', run });
  assert.equal(list[0].process, null);
  assert.equal(list[0].pid, 1092);
});

test('listPorts: Linux cai para netstat quando ss falha', async () => {
  const calls = [];
  const run = async (cmd) => {
    calls.push(cmd);
    if (cmd === 'ss') { const e = new Error('spawn ss ENOENT'); e.code = 'ENOENT'; throw e; }
    return NETSTAT_LINUX;
  };
  const { ports: list } = await listPorts({ platform: 'linux', run });
  assert.deepEqual(calls, ['ss', 'netstat']);
  assert.deepEqual(list.map((p) => p.port), [22, 3000, 5432]);
});

test('listPorts: erro em tudo devolve lista vazia + error', async () => {
  const run = async () => { const e = new Error('nope'); e.code = 'ENOENT'; e.path = 'ss'; throw e; };
  const r = await listPorts({ platform: 'linux', run });
  assert.deepEqual(r.ports, []);
  assert.match(r.error, /ss/);
});

test('listPorts: macOS lsof sem resultados (exit 1) é lista vazia', async () => {
  const run = async () => { const e = new Error('exit 1'); e.code = 1; e.stdout = ''; e.stderr = ''; throw e; };
  assert.deepEqual(await listPorts({ platform: 'darwin', run }), { ports: [] });
  const ok = await listPorts({ platform: 'darwin', run: async () => LSOF });
  assert.equal(ok.ports[0].port, 3000);
});
