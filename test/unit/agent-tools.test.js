const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createToolbox, ToolError, globToRegExp, LIMITS } = require('../../src/main/agent/tools');
const { createCheckpointStore } = require('../../src/main/agent/checkpoints');

let root;
let outside;
let box;
let cp;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-agent-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-out-')));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'const a = 1;\n');
  cp = createCheckpointStore({}).create({ root });
  box = createToolbox({ root, checkpoint: cp });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
const run = async (name, input, opts) => box.prepare(name, input).execute(opts);

test('caminhos fora da raiz são negados (relativo, absoluto, symlink)', () => {
  assert.throws(() => box.prepare('read_file', { path: '../x' }), ToolError);
  assert.throws(() => box.prepare('read_file', { path: path.join(outside, 'secret.txt') }), /fora da pasta/);
  fs.symlinkSync(outside, path.join(root, 'link'));
  assert.throws(() => box.prepare('read_file', { path: 'link/secret.txt' }), /fora da pasta/);
  assert.throws(() => box.prepare('write_file', { path: 'link/novo.txt', content: 'x' }), /fora da pasta/);
  assert.throws(() => box.prepare('run_command', { command: 'ls', cwd: '..' }), /fora da pasta/);
  assert.throws(() => box.prepare('delete_path', { path: '.' }), /raiz/);
  assert.throws(() => box.prepare('nao_existe', {}), /desconhecida/);
  assert.throws(() => box.prepare('read_file', { __invalid: '{' }), /JSON/);
});

test('list_dir: pastas primeiro, node_modules não expandido, profundidade', async () => {
  const r1 = await run('list_dir', { path: '.' });
  assert.equal(r1.result, 'node_modules/ (não expandido)\nsrc/');
  const r2 = await run('list_dir', { path: '.', depth: 2 });
  assert.match(r2.result, /src\/\n {2}app\.js \(\d+B\)/);
  assert.doesNotMatch(r2.result, /pkg/);
  assert.equal(box.prepare('list_dir', { path: '.' }).category, 'read');
});

test('read_file: números de linha, offset/limit e binário', async () => {
  const r = await run('read_file', { path: 'src/app.js' });
  assert.equal(r.result, '1\tconst a = 1;\n2\tconst b = 2;\n3\tconsole.log(a + b);');
  const part = await run('read_file', { path: 'src/app.js', offset: 2, limit: 1 });
  assert.equal(part.result, '2\tconst b = 2;\n[linhas 2–2 de 3; use offset/limit para o resto]');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([1, 0, 2]));
  await assert.rejects(run('read_file', { path: 'bin.dat' }), /binário/);
  const big = Array.from({ length: 2500 }, (_, i) => `l${i}`).join('\n');
  fs.writeFileSync(path.join(root, 'big.txt'), big);
  const rb = await run('read_file', { path: 'big.txt' });
  assert.equal(rb.result.split('\n').filter((l) => /^\d+\t/.test(l)).length, LIMITS.readLines);
  assert.match(rb.result, /linhas 1–2000 de 2500/);
});

test('search: ignora node_modules, glob, regex e limite', async () => {
  const r = await run('search', { query: 'CONST A' });
  assert.equal(r.result, 'src/app.js:1: const a = 1;');
  assert.equal((await run('search', { query: 'const', glob: '*.css' })).result, 'Nenhum resultado.');
  assert.match((await run('search', { query: 'const', glob: 'src/**/*.js' })).result, /src\/app\.js:1/);
  assert.equal((await run('search', { query: 'b\\s=\\s\\d', regex: true })).result, 'src/app.js:2: const b = 2;');
  assert.throws(() => box.prepare('search', { query: '(', regex: true }), /Regex inválida/);
  fs.writeFileSync(path.join(root, 'many.txt'), 'x\n'.repeat(300));
  const many = await run('search', { query: 'x', glob: 'many.txt' });
  assert.match(many.result, /truncados em 200/);
  assert.ok(globToRegExp('**/*.{js,ts}').test('a/b/c.ts'));
});

test('write_file: cria pastas pai, preview e meta', async () => {
  const p = box.prepare('write_file', { path: 'novo/dir/x.txt', content: 'a\nb\n' });
  assert.equal(p.category, 'write');
  assert.equal(p.title, 'Criar novo/dir/x.txt');
  assert.deepEqual(p.preview, { diff: { path: path.join(root, 'novo/dir/x.txt'), before: '', after: 'a\nb\n' } });
  const r = await p.execute();
  assert.deepEqual(r.meta, { path: path.join(root, 'novo/dir/x.txt'), added: 2, removed: 0, created: true });
  assert.deepEqual(r.changed, [path.join(root, 'novo/dir/x.txt')]);
  assert.equal(fs.readFileSync(path.join(root, 'novo/dir/x.txt'), 'utf8'), 'a\nb\n');
  const r2 = await run('write_file', { path: 'novo/dir/x.txt', content: 'a\nc\n' });
  assert.deepEqual(r2.meta, { path: path.join(root, 'novo/dir/x.txt'), added: 1, removed: 1 });
});

test('edit_file: único, replace_all, não encontrado, CRLF', async () => {
  fs.writeFileSync(path.join(root, 'd.txt'), 'x = 1\nx = 1\ny = 2\n');
  assert.throws(() => box.prepare('edit_file', { path: 'd.txt', old_string: 'x = 1', new_string: 'x = 3' }), /2 vezes/);
  assert.throws(() => box.prepare('edit_file', { path: 'd.txt', old_string: 'zzz', new_string: 'q' }), /não encontrado/);
  assert.throws(() => box.prepare('edit_file', { path: 'nao.txt', old_string: 'a', new_string: 'b' }), /não encontrado/);
  const p = box.prepare('edit_file', { path: 'd.txt', old_string: 'y = 2', new_string: 'y = $& 3' });
  assert.equal(p.preview.diff.after, 'x = 1\nx = 1\ny = $& 3\n');
  const r = await p.execute();
  assert.deepEqual(r.meta, { path: path.join(root, 'd.txt'), added: 1, removed: 1 });
  await run('edit_file', { path: 'd.txt', old_string: 'x = 1', new_string: 'x = 9', replace_all: true });
  assert.equal(fs.readFileSync(path.join(root, 'd.txt'), 'utf8'), 'x = 9\nx = 9\ny = $& 3\n');
  fs.writeFileSync(path.join(root, 'w.txt'), 'a\r\nb\r\n');
  await run('edit_file', { path: 'w.txt', old_string: 'a\nb', new_string: 'a\nB' });
  assert.equal(fs.readFileSync(path.join(root, 'w.txt'), 'utf8'), 'a\r\nB\r\n');
});

test('create_dir, move_path e delete_path', async () => {
  await run('create_dir', { path: 'a/b' });
  assert.ok(fs.statSync(path.join(root, 'a/b')).isDirectory());
  const mv = box.prepare('move_path', { from: 'src/app.js', to: 'lib/app.js' });
  assert.equal(mv.category, 'destructive');
  assert.equal(mv.preview.kind, 'move');
  await mv.execute();
  assert.ok(fs.existsSync(path.join(root, 'lib/app.js')));
  assert.throws(() => box.prepare('move_path', { from: 'lib/app.js', to: 'a' }), /Destino já existe/);
  assert.throws(() => box.prepare('move_path', { from: 'a', to: 'a/b/c' }), /dentro dela/);
  const del = box.prepare('delete_path', { path: 'lib' });
  assert.deepEqual(del.preview, { path: path.join(root, 'lib'), kind: 'delete', isDir: true });
  const r = await del.execute();
  assert.equal(r.meta.deleted, true);
  assert.ok(!fs.existsSync(path.join(root, 'lib')));
  assert.throws(() => box.prepare('delete_path', { path: 'lib' }), /Não encontrado/);
});

test('run_command: saída ao vivo, exit code, cwd, risco e redação de segredos', { skip: process.platform === 'win32' }, async () => {
  const secretBox = createToolbox({ root, secrets: ['segredo-super-123'], env: { ...process.env, MY_TOKEN: 'segredo-super-123' } });
  const p = secretBox.prepare('run_command', { command: 'echo oi; echo "$MY_TOKEN"; pwd; echo err 1>&2; exit 3', cwd: 'src' });
  assert.equal(p.category, 'command');
  assert.equal(p.risky, false);
  const chunks = [];
  const r = await p.execute({ onOutput: (c) => chunks.push(c) });
  assert.equal(r.ok, false);
  assert.equal(r.meta.exitCode, 3);
  assert.ok(r.meta.durationMs >= 0);
  assert.match(r.result, /^exit code: 3/);
  assert.match(r.result, /oi\n\[redigido\]\n.*\/src\nerr/s);
  assert.doesNotMatch(r.result + chunks.join(''), /segredo-super/);
  assert.match(chunks.join(''), /oi/);
  assert.equal(secretBox.prepare('run_command', { command: 'git push --force' }).risky, true);
});

test('run_command: timeout mata o processo e saída grande é truncada', { skip: process.platform === 'win32' }, async () => {
  const t = await run('run_command', { command: 'sleep 5', timeout_s: 1 });
  assert.equal(t.ok, false);
  assert.match(t.result, /tempo esgotado/);
  assert.ok(t.meta.durationMs < 4000);
  const big = await run('run_command', { command: 'head -c 100000 /dev/zero | tr "\\0" "a"' });
  assert.ok(big.result.length < 32 * 1024);
  assert.match(big.result, /caracteres omitidos/);
});

test('run_command: cancelamento mata a árvore de processos', { skip: process.platform === 'win32' }, async () => {
  const controller = new AbortController();
  const marker = path.join(root, 'filho-vivo');
  const p = run('run_command', { command: `(sleep 1.5; touch ${marker}) & sleep 10` }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 300);
  const r = await p;
  assert.match(r.result, /cancelado/);
  assert.ok(r.meta.durationMs < 3000);
  await new Promise((res) => setTimeout(res, 1700));
  assert.ok(!fs.existsSync(marker), 'processo neto deveria ter sido morto');
});

// ------------------------------------------------- ferramentas extras (módulos)
function extraTool(overrides = {}) {
  return {
    definition: {
      name: 'mod_tool',
      description: 'ferramenta de teste',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    kind: 'write',
    prepare(input, ctx) {
      const abs = ctx.resolvePath(input.path);
      return {
        title: `Mexer em ${ctx.rel(abs)}`,
        preview: { path: abs },
        run: async () => {
          ctx.checkpoint?.record(abs);
          fs.writeFileSync(abs, 'mexido');
          return { summary: 'mexeu', meta: { path: abs }, output: 'mexeu em 1 arquivo', changed: [abs] };
        },
      };
    },
    ...overrides,
  };
}

test('extraTools aparecem em definitions', () => {
  const b = createToolbox({ root, extraTools: [extraTool()] });
  const names = b.definitions.map((d) => d.name);
  assert.ok(names.includes('read_file'));
  assert.ok(names.includes('mod_tool'));
  assert.equal(b.definitions.find((d) => d.name === 'mod_tool').description, 'ferramenta de teste');
  // sem extras, a lista é a padrão
  assert.ok(!createToolbox({ root }).definitions.some((d) => d.name === 'mod_tool'));
  // nome repetido de ferramenta embutida é ignorado
  const dup = createToolbox({ root, extraTools: [extraTool({ definition: { name: 'read_file', description: 'x', input_schema: {} } })] });
  assert.equal(dup.definitions.filter((d) => d.name === 'read_file').length, 1);
});

test('prepare de extra recebe ctx com resolvePath que nega fora da raiz', async () => {
  let seenCtx;
  const tool = extraTool({
    prepare(input, ctx) {
      seenCtx = ctx;
      return extraTool().prepare(input, ctx);
    },
  });
  const b = createToolbox({ root, checkpoint: cp, extraTools: [tool] });
  assert.throws(() => b.prepare('mod_tool', { path: path.join(outside, 'secret.txt') }), /fora da pasta/);
  assert.equal(seenCtx.root, root);
  assert.equal(typeof seenCtx.readTextFile, 'function');
  assert.equal(seenCtx.checkpoint, cp);
  assert.equal(seenCtx.rel(path.join(root, 'src', 'app.js')), 'src/app.js');
  assert.equal(seenCtx.readTextFile(path.join(root, 'src', 'app.js')).split('\n')[0], 'const a = 1;');

  const prepared = b.prepare('mod_tool', { path: 'src/app.js' });
  assert.equal(prepared.title, 'Mexer em src/app.js');
  assert.equal(prepared.category, 'write');
  assert.equal(prepared.risky, false);
  const res = await prepared.execute({});
  assert.equal(res.ok, true);
  assert.equal(res.summary, 'mexeu');
  assert.equal(res.result, 'mexeu em 1 arquivo');
  assert.deepEqual(res.changed, [path.join(root, 'src', 'app.js')]);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8'), 'mexido');
  // checkpoint da conversa desfaz
  assert.ok(cp.finalize());
});

test('extra: kind inválido vira command; prepare assíncrono é aceito', async () => {
  const b = createToolbox({
    root,
    extraTools: [
      extraTool({ kind: 'qualquer' }),
      extraTool({
        definition: { name: 'async_tool', description: 'x', input_schema: { type: 'object' } },
        kind: 'read',
        prepare: async () => ({ title: 'async', run: async () => ({ summary: 'ok' }) }),
      }),
    ],
  });
  assert.equal(b.prepare('mod_tool', { path: 'src/app.js' }).category, 'command');
  const p = await b.prepare('async_tool', {});
  assert.equal(p.category, 'read');
  const r = await p.execute({});
  assert.equal(r.result, 'ok');
});

test('getModuleTools ignora módulo desabilitado e stub null', () => {
  const { getModuleTools } = require('../../src/main/modules/agent-tools');
  const { DEFAULT_SETTINGS } = require('../../src/main/lib/settings');
  // registro real: clean_code, env_check e file_history, cada um só com o módulo habilitado
  const realNames = (s) => getModuleTools(s).map((t) => t.definition.name);
  assert.deepEqual(realNames(DEFAULT_SETTINGS).sort(), ['clean_code', 'env_check', 'file_history', 'insert_snippet', 'list_snippets', 'project_tree', 'save_snippet']);
  assert.ok(!realNames({ modules: { envVault: { enabled: false } } }).includes('env_check'));
  assert.ok(!realNames({ modules: { broom: { enabled: false } } }).includes('clean_code'));
  const a = extraTool({ definition: { name: 'a_tool', description: 'a', input_schema: {} } });
  const b = extraTool({ definition: { name: 'b_tool', description: 'b', input_schema: {} } });
  const registry = [
    { module: 'broom', load: () => a },
    { module: 'envVault', load: () => [b] },
    { module: 'broom', load: () => null },
  ];
  const names = (s) => getModuleTools(s, { registry }).map((t) => t.definition.name);
  assert.deepEqual(names(DEFAULT_SETTINGS), ['a_tool', 'b_tool']);
  assert.deepEqual(names({ modules: { broom: { enabled: false } } }), ['b_tool']);
  assert.deepEqual(names({ modules: { envVault: { enabled: false } } }), ['a_tool']);
  assert.deepEqual(names(undefined), ['a_tool', 'b_tool']);
});

test('extra: gancho commandRisk marca run_command como risco (síncrono ou assíncrono)', async () => {
  const mk = (commandRisk) => ({
    definition: { name: 'hook_tool', description: 'x', input_schema: { type: 'object', properties: {} } },
    kind: 'read',
    prepare: () => ({ title: 'x', run: async () => ({ summary: 'ok' }) }),
    commandRisk,
  });
  const seen = [];
  const syncBox = createToolbox({ root, checkpoint: cp, extraTools: [mk((c, ctx) => { seen.push(ctx.cwd); return c.includes('perigo') ? 'motivo x' : null; })] });
  const p = syncBox.prepare('run_command', { command: 'echo perigo' });
  assert.equal(p.risky, true);
  assert.equal(p.riskReason, 'motivo x');
  assert.equal(p.preview.reason, 'motivo x');
  assert.equal(syncBox.prepare('run_command', { command: 'echo ok' }).risky, false);
  assert.deepEqual(seen, [root, root]);

  const asyncBox = createToolbox({ root, checkpoint: cp, extraTools: [mk(async () => 'motivo y')] });
  const a = await asyncBox.prepare('run_command', { command: 'echo 1' });
  assert.equal(a.riskReason, 'motivo y');

  const brokenBox = createToolbox({ root, checkpoint: cp, extraTools: [mk(() => { throw new Error('x'); })] });
  assert.equal(brokenBox.prepare('run_command', { command: 'echo 1' }).risky, false);
});

test('extraTools com input_schema chegam aos providers como parameters', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-schema-')));
  const schema = { type: 'object', properties: { x: { type: 'string' } } };
  const box = createToolbox({
    root,
    checkpoint: { record() {} },
    extraTools: [{ definition: { name: 'x_tool', description: 'd', input_schema: schema }, kind: 'read', prepare: () => ({ title: 't', run: async () => ({ summary: 'ok' }) }) }],
  });
  const def = box.definitions.find((d) => d.name === 'x_tool');
  assert.deepEqual(def.parameters, schema);
  assert.equal(def.input_schema, undefined);
});
