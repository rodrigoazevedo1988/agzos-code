const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const fsIpc = require('../../src/main/ipc/fs');

function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-fsv-')));
  const ws = path.join(base, 'ws');
  fs.mkdirSync(ws);
  const handlers = {};
  const calls = [];
  const shell = {
    openPath: async (p) => { calls.push(['openPath', p]); return ''; },
    showItemInFolder: (p) => { calls.push(['showItemInFolder', p]); },
  };
  const guard = createPathGuard();
  guard.allow(ws);
  fsIpc.register({ handle: (ch, fn) => { handlers[ch] = fn; } }, { guard, shell });
  const call = (ch, ...args) => handlers[ch]({}, ...args);
  return { base, ws, call, calls, guard };
}

test('fs:readFile com detectBinary sinaliza binário sem ler como texto', async () => {
  const { ws, call, base } = setup();
  const bin = path.join(ws, 'x.dat');
  fs.writeFileSync(bin, Buffer.from([1, 2, 0, 3, 4]));
  const res = await call('fs:readFile', bin, { detectBinary: true });
  assert.equal(res.binary, true);
  assert.equal(res.size, 5);
  assert.equal(res.content, undefined);
  const txt = path.join(ws, 'a.txt');
  fs.writeFileSync(txt, 'olá');
  const r2 = await call('fs:readFile', txt, { detectBinary: true });
  assert.equal(r2.binary, false);
  assert.equal(r2.content, 'olá');
  fs.rmSync(base, { recursive: true, force: true });
});

test('fs:readFile com detectBinary detecta binário grande antes do limite de 5MB', async () => {
  const { ws, call, base } = setup();
  const big = path.join(ws, 'big.bin');
  const buf = Buffer.alloc(6 * 1024 * 1024, 0);
  fs.writeFileSync(big, buf);
  const res = await call('fs:readFile', big, { detectBinary: true });
  assert.equal(res.binary, true);
  fs.rmSync(base, { recursive: true, force: true });
});

test('fs:openPath e fs:reveal passam pelo guard', async () => {
  const { ws, base, call, calls } = setup();
  const f = path.join(ws, 'a.heic');
  fs.writeFileSync(f, 'x');
  assert.equal(await call('fs:openPath', f), true);
  await call('fs:reveal', f);
  assert.deepEqual(calls, [['openPath', f], ['showItemInFolder', f]]);
  fs.writeFileSync(path.join(base, 'fora.txt'), 'x');
  await assert.rejects(() => call('fs:openPath', path.join(base, 'fora.txt')), /Acesso negado/);
  await assert.rejects(() => call('fs:reveal', path.join(base, 'fora.txt')), /Acesso negado/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('fs:allowDropped libera só arquivos existentes', async () => {
  const { base, call, guard } = setup();
  const f = path.join(base, 'solto.png');
  fs.writeFileSync(f, 'x');
  assert.equal(guard.isAllowed(f), false);
  assert.deepEqual(await call('fs:allowDropped', f), { path: f, isFile: true });
  assert.equal(guard.isAllowed(f), true);
  // Pasta não é liberada (soltar pasta não abre workspace por esse caminho)
  const dir = path.join(base, 'pasta');
  fs.mkdirSync(dir);
  assert.equal(await call('fs:allowDropped', dir), null);
  assert.equal(guard.isAllowed(dir), false);
  assert.equal(await call('fs:allowDropped', path.join(base, 'nao-existe')), null);
  assert.equal(await call('fs:allowDropped', 42), null);
  fs.rmSync(base, { recursive: true, force: true });
});
