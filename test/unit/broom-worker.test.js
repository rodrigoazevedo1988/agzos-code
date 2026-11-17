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
  const big = 'console.log(1);\n'.repeat(4000);
  const files = Array.from({ length: 400 }, (_, i) => ({ path: `/w/f${i}.js`, text: big }));
  const ac = new AbortController();
  const t0 = Date.now();
  const p = host.call('broom.analyzeMany', { files, options: {} }, { signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(p, { name: 'AbortError' });
  // O worker para de verdade: a próxima chamada responde logo (sem esperar os 400 arquivos).
  const r = await host.call('broom.analyze', { path: '/w/a.js', text: 'x();\n', options: {} });
  assert.deepEqual(r.edits, []);
  assert.ok(Date.now() - t0 < 1000, `demorou ${Date.now() - t0} ms`);
});
