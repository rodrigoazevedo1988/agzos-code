const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { register } = require('../../src/main/ipc/fs');
const { createPathGuard } = require('../../src/main/lib/path-guard');

function setup() {
  const handlers = {};
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-find-')));
  const guard = createPathGuard();
  guard.allow(root);
  register(ipcMain, { guard });
  return { handlers, root };
}

test('fs:findFiles limita maxResults a 5000 e trata valores inválidos', async () => {
  const { handlers, root } = setup();
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), '');
  assert.equal((await handlers['fs:findFiles'](null, root, 2)).length, 2);
  assert.equal((await handlers['fs:findFiles'](null, root, 'abc')).length, 5);
  assert.equal((await handlers['fs:findFiles'](null, root, Infinity)).length, 5);
});

test('fs:findFiles recusa caminho fora das raízes liberadas', async () => {
  const { handlers } = setup();
  await assert.rejects(handlers['fs:findFiles'](null, os.homedir() + '/../'), /Acesso negado/);
});

test('fs:findFiles varre o caminho real resolvido pelo guard', async () => {
  const { handlers, root } = setup();
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'a.js'), '');
  const results = await handlers['fs:findFiles'](null, path.join(root, 'sub', '..'));
  assert.deepEqual(results.map((r) => r.relativePath), ['sub/a.js']);
  assert.equal(results[0].path, path.join(root, 'sub', 'a.js'));
});
