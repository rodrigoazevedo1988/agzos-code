const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeFilesExclude, isExcludedName, DEFAULT_FILES_EXCLUDE } = require('../../src/main/lib/files-exclude');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const fsIpc = require('../../src/main/ipc/fs');

test('padrão oculta só .git, .DS_Store e afins', () => {
  assert.ok(isExcludedName('.git'));
  assert.ok(isExcludedName('.ds_store'));
  for (const n of ['.gitignore', '.env', '.github', '.vscode', '.prettierrc', '.editorconfig']) assert.equal(isExcludedName(n), false, n);
});

test('normalização: lista inválida volta ao padrão; nomes com barra são descartados', () => {
  assert.deepEqual(normalizeFilesExclude('x'), DEFAULT_FILES_EXCLUDE);
  assert.deepEqual(normalizeFilesExclude(['node_modules', 'a/b', '', 3, 'node_modules']), ['node_modules']);
});

test('fs:readDir mostra arquivos com ponto e respeita files.exclude', async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-hidden-')));
  for (const n of ['.gitignore', '.env', '.prettierrc', 'a.js']) fs.writeFileSync(path.join(ws, n), 'x');
  for (const d of ['.git', '.github', 'node_modules']) fs.mkdirSync(path.join(ws, d));
  const handlers = {};
  const guard = createPathGuard();
  guard.allow(ws);
  let exclude = DEFAULT_FILES_EXCLUDE;
  fsIpc.register({ handle: (ch, fn) => { handlers[ch] = fn; } }, { guard, shell: {}, getFilesExclude: () => exclude });
  const names = async () => (await handlers['fs:readDir']({}, ws)).map((e) => e.name).sort();
  assert.deepEqual(await names(), ['.env', '.github', '.gitignore', '.prettierrc', 'a.js', 'node_modules']);
  exclude = ['.git', 'node_modules', '.env'];
  assert.deepEqual(await names(), ['.github', '.gitignore', '.prettierrc', 'a.js']);
  fs.rmSync(ws, { recursive: true, force: true });
});
