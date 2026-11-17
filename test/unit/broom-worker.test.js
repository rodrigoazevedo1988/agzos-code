const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const childProcess = require('node:child_process');
const { createWorkerHost } = require('../../src/main/modules/worker-host');

const script = path.join(__dirname, '..', '..', 'src', 'main', 'modules', 'worker.js');
function fork(file) {
  const child = childProcess.fork(file, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  return { postMessage: (m) => child.connected && child.send(m), on: (ev, fn) => child.on(ev, fn), kill: () => child.kill() };
}
const host = createWorkerHost({ script, fork });
after(() => host.dispose());

test('broom.analyze devolve as edições do arquivo', async () => {
  const r = await host.call('broom.analyze', { path: '/w/a.js', text: 'console.log(1);\nfoo();\n', options: {} });
  assert.equal(r.edits.length, 1);
  assert.equal(r.edits[0].rule, 'console');
});

test('broom.analyze respeita as regras e a extensão', async () => {
  const off = await host.call('broom.analyze', { path: '/w/a.js', text: 'console.log(1);\n', options: { rules: { console: false } } });
  assert.equal(off.edits.length, 0);
  const css = await host.call('broom.analyze', { path: '/w/a.css', text: '/* x */', options: {} });
  assert.deepEqual(css.edits, []);
});

test('broom.analyzeMany analisa vários arquivos na ordem', async () => {
  const r = await host.call('broom.analyzeMany', {
    files: [{ path: '/w/a.ts', text: '// c\nx();\n' }, { path: '/w/b.js', text: 'function (' }],
    options: {},
  });
  assert.equal(r.length, 2);
  assert.equal(r[0].path, '/w/a.ts');
  assert.equal(r[0].edits.length, 1);
  assert.equal(r[1].edits.length, 0);
  assert.ok(r[1].error);
});

test('broom.analyzeMany é cancelável entre arquivos', async () => {
  // Sem cancelamento, 2000 arquivos de 1000 linhas ocupariam o worker por dezenas de segundos.
  const big = 'console.log(1);\n'.repeat(1000);
  const files = Array.from({ length: 2000 }, (_, i) => ({ path: `/w/f${i}.js`, text: big }));
  const ac = new AbortController();
  const p = host.call('broom.analyzeMany', { files, options: {} }, { signal: ac.signal });
  await new Promise((r) => setTimeout(r, 300));
  const t0 = Date.now();
  ac.abort();
  await assert.rejects(p, { name: 'AbortError' });
  // O worker para de verdade: a próxima chamada responde logo.
  const r = await host.call('broom.analyze', { path: '/w/a.js', text: 'x();\n', options: {} });
  assert.deepEqual(r.edits, []);
  // Margem folgada: sem cancelamento levaria dezenas de segundos; 3 s tolera máquina carregada.
  assert.ok(Date.now() - t0 < 3000, `demorou ${Date.now() - t0} ms`);
});

test('broom.listFiles ignora pastas, extensões, 1 MB e links; respeita maxFiles', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-list-')));
  try {
    const w = (rel, text = 'x();\n') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
    w('a.js'); w('src/b.tsx'); w('src/c.css'); w('node_modules/p/d.js'); w('grande.js', 'x'.repeat(2048));
    fs.symlinkSync(path.join(root, 'a.js'), path.join(root, 'link.js'));
    const params = { root, ignoredDirs: ['node_modules'], extensions: ['.js', '.tsx'], maxBytes: 1024 };
    const r = await host.call('broom.listFiles', params);
    assert.deepEqual(r.files.map((f) => path.relative(root, f.path)), ['a.js', path.join('src', 'b.tsx')]);
    assert.equal(typeof r.files[0].mtimeMs, 'number');
    assert.equal(r.truncated, false);
    const lim = await host.call('broom.listFiles', { ...params, maxFiles: 1 });
    assert.equal(lim.files.length, 1);
    assert.equal(lim.truncated, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('broom.analyzeMany sem text lê o arquivo no worker', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-am-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), 'console.log(1);\n');
    fs.writeFileSync(path.join(dir, 'b.js'), 'x'.repeat(2048));
    const r = await host.call('broom.analyzeMany', { files: [{ path: path.join(dir, 'a.js') }, { path: path.join(dir, 'b.js') }], options: {}, maxBytes: 1024 });
    assert.equal(r[0].edits.length, 1);
    assert.equal(typeof r[0].mtimeMs, 'number');
    assert.equal(r[1].skipped, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
