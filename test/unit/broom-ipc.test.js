const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { register, CHANNELS } = require('../../src/main/ipc/broom');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const { createWorkerHost } = require('../../src/main/modules/worker-host');

const script = path.join(__dirname, '..', '..', 'src', 'main', 'modules', 'worker.js');
function fork(file) {
  const child = childProcess.fork(file, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  return { postMessage: (m) => child.connected && child.send(m), on: (ev, fn) => child.on(ev, fn), kill: () => child.kill() };
}
const workerHost = createWorkerHost({ script, fork });
after(() => workerHost.dispose());

const DIRTY = "import { a, b } from './x';\n// comentário\nconsole.log(a);\nexport const n = 1;\n";
const CLEAN = 'export const n = 1;\n';

function setup({ broom = {} } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-broom-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-out-')));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ud-'));
  const guard = createPathGuard();
  guard.allow(root);
  const settings = { recentFolders: [root], modules: { broom } };
  const handlers = {};
  register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    guard, settingsStore: { load: () => settings }, userDataDir: userData, workerHost,
  });
  const sender = new EventEmitter();
  sender.events = [];
  sender.isDestroyed = () => false;
  sender.send = (channel, id, evt) => sender.events.push({ channel, id, evt });
  const event = { sender };
  const call = (name, ...args) => handlers[`broom:${name}`](event, ...args);
  const write = (rel, text) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    return abs;
  };
  return {
    root, outside, userData, call, write, sender, settings,
    cleanup: () => [root, outside, userData].forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
  };
}

test('registra todos os canais', () => {
  const h = setup();
  try {
    assert.deepEqual(CHANNELS, ['analyzeFile', 'cleanFile', 'scanWorkspace', 'cleanWorkspace', 'cancel', 'undo']);
  } finally { h.cleanup(); }
});

test('analyzeFile fora do workspace → erro de acesso', async () => {
  const h = setup();
  try {
    const f = path.join(h.outside, 'a.js');
    fs.writeFileSync(f, DIRTY);
    await assert.rejects(h.call('analyzeFile', f), /Acesso negado/);
    await assert.rejects(h.call('analyzeFile', path.join(h.root, '..', path.basename(h.outside), 'a.js')), /Acesso negado/);
  } finally { h.cleanup(); }
});

test('analyzeFile devolve count, byRule e edits', async () => {
  const h = setup();
  try {
    const f = h.write('src/a.ts', DIRTY);
    const r = await h.call('analyzeFile', f);
    assert.equal(r.count, 3);
    assert.deepEqual(r.byRule, { console: 1, comments: 1, unusedImports: 1, deadCode: 0 });
    assert.equal(r.edits.length, 3);
    const css = await h.call('analyzeFile', h.write('a.css', '/* x */'));
    assert.equal(css.count, 0);
  } finally { h.cleanup(); }
});

test('analyzeFile respeita as regras das Configurações', async () => {
  const h = setup({ broom: { rules: { console: false, comments: false } } });
  try {
    const r = await h.call('analyzeFile', h.write('a.ts', DIRTY));
    assert.deepEqual(r.byRule, { console: 0, comments: 0, unusedImports: 1, deadCode: 0 });
  } finally { h.cleanup(); }
});

test('módulo desabilitado → erro claro', async () => {
  const h = setup({ broom: { enabled: false } });
  try {
    await assert.rejects(h.call('analyzeFile', h.write('a.ts', DIRTY)), /desabilitada/);
  } finally { h.cleanup(); }
});

test('cleanFile aplica, avisa file_changed e undo restaura byte a byte', async () => {
  const h = setup();
  try {
    const original = `\uFEFF${DIRTY.replace(/\n/g, '\r\n')}`;
    const f = h.write('a.ts', original);
    const r = await h.call('cleanFile', f);
    assert.equal(r.removed, 3);
    assert.ok(r.checkpointId);
    assert.equal(fs.readFileSync(f, 'utf8'), `\uFEFF${CLEAN.replace(/\n/g, '\r\n')}`);
    assert.ok(h.sender.events.some((e) => e.channel === 'agent:event' && e.evt.type === 'file_changed' && e.evt.path === f));
    // Depois de limpar, a análise vê 0 (cache não devolve o resultado antigo).
    assert.equal((await h.call('analyzeFile', f)).count, 0);
    const u = await h.call('undo', r.checkpointId);
    assert.deepEqual(u.errors, []);
    assert.deepEqual(fs.readFileSync(f), Buffer.from(original, 'utf8'));
    assert.equal((await h.call('analyzeFile', f)).count, 3);
  } finally { h.cleanup(); }
});

test('cleanFile com editIds aplica só as escolhidas', async () => {
  const h = setup();
  try {
    const f = h.write('a.ts', DIRTY);
    const { edits } = await h.call('analyzeFile', f);
    const consoleEdit = edits.find((e) => e.rule === 'console');
    const r = await h.call('cleanFile', f, { editIds: [consoleEdit.id] });
    assert.equal(r.removed, 1);
    assert.equal(fs.readFileSync(f, 'utf8'), "import { a, b } from './x';\n// comentário\nexport const n = 1;\n");
  } finally { h.cleanup(); }
});

test('cleanFile sem nada a remover não cria checkpoint', async () => {
  const h = setup();
  try {
    const r = await h.call('cleanFile', h.write('a.ts', CLEAN));
    assert.deepEqual(r, { checkpointId: null, removed: 0 });
  } finally { h.cleanup(); }
});

test('cleanFile em arquivo com erro de sintaxe não altera', async () => {
  const h = setup();
  try {
    const f = h.write('a.js', 'console.log(1);\nfunction (');
    const r = await h.call('cleanFile', f);
    assert.equal(r.removed, 0);
    assert.ok(r.error);
    assert.equal(fs.readFileSync(f, 'utf8'), 'console.log(1);\nfunction (');
  } finally { h.cleanup(); }
});

test('scan respeita ignorados e 1 MB', async () => {
  const h = setup();
  try {
    h.write('src/a.ts', DIRTY);
    h.write('src/limpo.ts', CLEAN);
    h.write('src/b.css', '/* x */');
    for (const dir of ['node_modules/p', '.git', 'dist', 'build', '.next', 'coverage']) h.write(`${dir}/x.js`, DIRTY);
    h.write('grande.js', `console.log(1);\n${'x();\n'.repeat(300 * 1024)}`);
    const r = await h.call('scanWorkspace', 's1');
    const done = h.sender.events.find((e) => e.channel === 'broom:event' && e.id === 's1' && e.evt.type === 'done');
    assert.ok(done);
    assert.deepEqual(done.evt.files.map((f) => path.relative(h.root, f.path)), [path.join('src', 'a.ts')]);
    assert.equal(done.evt.files[0].count, 3);
    assert.deepEqual(done.evt.files[0].byRule, { console: 1, comments: 1, unusedImports: 1, deadCode: 0 });
    assert.equal(done.evt.truncated, false);
    assert.deepEqual(r.files, done.evt.files);
    const progress = h.sender.events.filter((e) => e.evt.type === 'progress');
    assert.ok(progress.length >= 1);
    assert.equal(progress.at(-1).evt.done, progress.at(-1).evt.total);
    assert.equal(progress.at(-1).evt.total, 2);
  } finally { h.cleanup(); }
});

test('scan com 5001 arquivos analisa no máximo 5000 e marca truncated', async () => {
  const h = setup();
  try {
    for (let i = 0; i < 5001; i++) h.write(`f/${String(i).padStart(4, '0')}.js`, i % 2 ? 'x();\n' : 'console.log(1);\n');
    const r = await h.call('scanWorkspace', 's2');
    assert.equal(r.truncated, true);
    const progress = h.sender.events.filter((e) => e.evt.type === 'progress');
    assert.equal(progress.at(-1).evt.total, 5000);
    assert.ok(r.files.length <= 5000);
    assert.ok(r.files.length >= 2400);
  } finally { h.cleanup(); }
});

test('cancel interrompe scan em < 1 s', async () => {
  const h = setup();
  try {
    const big = 'console.log(1);\n'.repeat(3000);
    for (let i = 0; i < 300; i++) h.write(`f/${i}.js`, big);
    const p = h.call('scanWorkspace', 's3');
    await new Promise((r) => setTimeout(r, 300)); // já analisando o primeiro lote
    const t0 = Date.now();
    assert.equal(await h.call('cancel', 's3'), true);
    const r = await p;
    assert.ok(Date.now() - t0 < 1000, `demorou ${Date.now() - t0} ms`);
    assert.equal(r.cancelled, true);
    assert.ok(h.sender.events.some((e) => e.id === 's3' && e.evt.type === 'done' && e.evt.cancelled));
    assert.equal(await h.call('cancel', 'nao-existe'), false);
  } finally { h.cleanup(); }
});

test('cleanWorkspace cria um único checkpoint e undo restaura tudo', async () => {
  const h = setup();
  try {
    const a = h.write('a.ts', DIRTY);
    const b = h.write('sub/b.js', '// x\nfoo();\n');
    const c = h.write('c.js', CLEAN);
    const r = await h.call('cleanWorkspace', 'w1', [a, b, c]);
    assert.equal(r.files, 2);
    assert.equal(r.removed, 4);
    assert.ok(r.checkpointId);
    assert.equal(fs.readFileSync(a, 'utf8'), CLEAN);
    assert.equal(fs.readFileSync(b, 'utf8'), 'foo();\n');
    const cps = fs.readdirSync(path.join(h.userData, 'broom-checkpoints'));
    assert.equal(cps.length, 1);
    const changed = h.sender.events.filter((e) => e.evt.type === 'file_changed').map((e) => e.evt.path).sort();
    assert.deepEqual(changed, [a, b].sort());
    await h.call('undo', r.checkpointId);
    assert.equal(fs.readFileSync(a, 'utf8'), DIRTY);
    assert.equal(fs.readFileSync(b, 'utf8'), '// x\nfoo();\n');
  } finally { h.cleanup(); }
});

test('cleanWorkspace com caminho fora do workspace não altera nada', async () => {
  const h = setup();
  try {
    const a = h.write('a.ts', DIRTY);
    const out = path.join(h.outside, 'b.js');
    fs.writeFileSync(out, DIRTY);
    await assert.rejects(h.call('cleanWorkspace', 'w2', [a, out]), /Acesso negado/);
    assert.equal(fs.readFileSync(a, 'utf8'), DIRTY);
    assert.equal(fs.readFileSync(out, 'utf8'), DIRTY);
  } finally { h.cleanup(); }
});

test('undo com id inválido devolve erro', async () => {
  const h = setup();
  try {
    const r = await h.call('undo', '../../etc');
    assert.equal(r.restored.length, 0);
    assert.ok(r.errors.length);
  } finally { h.cleanup(); }
});

test('broom:undo de outra janela é recusado; a dona desfaz', async () => {
  const { createWindowGuards } = require('../../src/main/lib/window-guards');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-broom-own-')));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ud-'));
  const guards = createWindowGuards();
  const mk = (id) => Object.assign(new EventEmitter(), { id, isDestroyed: () => false, send: () => {} });
  const a = mk(21);
  const b = mk(22);
  guards.guardFor(a).allow(root);
  guards.guardFor(b).allow(root);
  const handlers = {};
  register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    guardFor: guards.guardFor, settingsStore: { load: () => ({ recentFolders: [root], modules: { broom: {} } }) }, userDataDir: userData, workerHost,
  });
  try {
    const f = path.join(root, 'a.ts');
    fs.writeFileSync(f, DIRTY);
    const r = await handlers['broom:cleanFile']({ sender: a }, f);
    assert.ok(r.checkpointId);
    const denied = await handlers['broom:undo']({ sender: b }, r.checkpointId);
    assert.deepEqual(denied.restored, []);
    assert.match(denied.errors[0].message, /outra janela/);
    assert.equal(fs.readFileSync(f, 'utf8'), CLEAN);
    const ok = await handlers['broom:undo']({ sender: a }, r.checkpointId);
    assert.deepEqual(ok.errors, []);
    assert.equal(fs.readFileSync(f, 'utf8'), DIRTY);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
