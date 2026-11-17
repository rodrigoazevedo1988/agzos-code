const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAgent, needsApproval } = require('../../src/main/agent/loop');
const { createAgentSessions } = require('../../src/main/agent/session');
const { createCheckpointStore } = require('../../src/main/agent/checkpoints');
const { createToolbox } = require('../../src/main/agent/tools');

let root;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-loop-')));
  fs.writeFileSync(path.join(root, 'app.js'), 'let x = 1;\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Provider falso: cada chamada consome um turno { text?, calls?: [{name, input}] }. */
function fakeProvider(turns) {
  const seen = [];
  let i = 0;
  return {
    seen,
    async* chatTools({ messages, tools, signal }) {
      seen.push({ messages: structuredClone(messages), tools });
      const turn = turns[i++] || { text: 'fim' };
      if (turn.throw) throw turn.throw;
      if (turn.text) yield { type: 'text', delta: turn.text };
      for (const [k, c] of (turn.calls || []).entries()) {
        if (signal?.aborted) return;
        yield { type: 'tool_call', id: `c${i}_${k}`, name: c.name, input: c.input };
      }
      yield { type: 'stop', reason: turn.calls ? 'tool_calls' : 'stop' };
    },
  };
}

function harness({ turns, mode = 'edit', decide = () => 'allow', maxSteps } = {}) {
  const events = [];
  const provider = fakeProvider(turns);
  const store = createCheckpointStore({});
  const checkpoint = store.create({ root });
  const toolbox = createToolbox({ root, checkpoint });
  const controller = new AbortController();
  const approvals = [];
  const promise = runAgent({
    provider, model: 'm', history: [{ role: 'user', content: 'faça' }], mode, toolbox, checkpoint,
    emit: (e) => events.push(e), signal: controller.signal, systemPrompt: 'SYS',
    requestApproval: async (callId) => { approvals.push(callId); return decide(callId, events); },
    ...(maxSteps ? { maxSteps } : {}),
  });
  return { events, provider, promise, controller, approvals, store };
}

test('política de aprovação por modo', () => {
  const read = { category: 'read' };
  const write = { category: 'write', sessionKey: 'write_file' };
  const destructive = { category: 'destructive', sessionKey: 'delete_path' };
  const cmd = { category: 'command', sessionKey: 'run_command:ls' };
  const risky = { category: 'command', risky: true, sessionKey: 'run_command:git push -f' };
  const table = {
    ask: [false, true, true, true, true],
    edit: [false, false, true, true, true],
    auto: [false, false, false, false, true],
  };
  for (const [mode, expected] of Object.entries(table)) {
    assert.deepEqual([read, write, destructive, cmd, risky].map((p) => needsApproval(mode, p, new Set())), expected, mode);
  }
  assert.equal(needsApproval('ask', write, new Set(['write_file'])), false);
  assert.equal(needsApproval('edit', risky, new Set([risky.sessionKey])), true);
});

test('multi-passo: lê, edita, cria e termina com resumo/checkpoint', async () => {
  const h = harness({ turns: [
    { text: 'Vou ler. ', calls: [{ name: 'read_file', input: { path: 'app.js' } }] },
    { calls: [{ name: 'edit_file', input: { path: 'app.js', old_string: 'x = 1', new_string: 'x = 2' } }, { name: 'write_file', input: { path: 'b.js', content: 'b\n' } }] },
    { text: 'Pronto.' },
  ] });
  const done = await h.promise;
  assert.equal(done.type, 'done');
  assert.equal(done.steps, 3);
  assert.ok(done.checkpointId);
  assert.deepEqual(done.changes, [
    { path: path.join(root, 'app.js'), added: 1, removed: 1 },
    { path: path.join(root, 'b.js'), added: 1, removed: 0, created: true },
  ]);
  assert.deepEqual(h.approvals, []); // modo edit: edição livre
  const types = h.events.map((e) => e.type);
  assert.deepEqual(types, ['text', 'tool_start', 'tool_end', 'tool_start', 'tool_end', 'file_changed', 'tool_start', 'tool_end', 'file_changed', 'text', 'done']);
  assert.deepEqual(h.events[1], { type: 'tool_start', callId: 'c1_0', tool: 'read_file', input: { path: 'app.js' }, title: 'Ler app.js' });
  assert.deepEqual(h.events[4], { type: 'tool_end', callId: 'c2_0', ok: true, summary: '+1 −1', meta: { path: path.join(root, 'app.js'), added: 1, removed: 1 } });
  assert.deepEqual(h.events[5], { type: 'file_changed', path: path.join(root, 'app.js') });
  // histórico enviado ao modelo: system + user + assistant(toolCalls) + tool
  const third = h.provider.seen[2].messages;
  assert.equal(third[0].content, 'SYS');
  assert.equal(third.filter((m) => m.role === 'tool').length, 3);
  assert.match(third[3].content, /^1\tlet x = 1;/);
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'let x = 2;\n');
  assert.equal(h.provider.seen[0].tools.length, 9);
});

test('aprovação: negar devolve recusa ao modelo e não executa', async () => {
  const h = harness({ mode: 'ask', decide: () => 'deny', turns: [
    { calls: [{ name: 'write_file', input: { path: 'n.txt', content: 'x' } }] },
    { text: 'Ok, não criei.' },
  ] });
  const done = await h.promise;
  assert.equal(fs.existsSync(path.join(root, 'n.txt')), false);
  const approval = h.events.find((e) => e.type === 'approval');
  assert.deepEqual(approval, { type: 'approval', callId: 'c1_0', tool: 'write_file', input: { path: 'n.txt', content: 'x' }, preview: { diff: { path: path.join(root, 'n.txt'), before: '', after: 'x' } } });
  assert.deepEqual(h.events.find((e) => e.type === 'tool_end'), { type: 'tool_end', callId: 'c1_0', ok: false, summary: 'Negado pelo usuário', meta: { denied: true } });
  assert.match(h.provider.seen[1].messages.at(-1).content, /negou/);
  assert.equal(done.checkpointId, null);
  assert.deepEqual(done.changes, []);
});

test('aprovação: allow_session libera a mesma ferramenta depois; risco sempre pergunta', async () => {
  const decide = (callId, events) => (events.find((e) => e.type === 'approval' && e.callId === callId).tool === 'run_command' ? 'deny' : 'allow_session');
  const h = harness({ mode: 'ask', decide, turns: [
    { calls: [{ name: 'write_file', input: { path: 'a.txt', content: '1' } }] },
    { calls: [{ name: 'write_file', input: { path: 'b.txt', content: '2' } }, { name: 'run_command', input: { command: 'git push --force' } }] },
  ] });
  await h.promise;
  const approvals = h.events.filter((e) => e.type === 'approval');
  assert.equal(approvals.length, 2); // a.txt + comando de risco (b.txt liberado pela sessão)
  assert.equal(approvals[1].tool, 'run_command');
  assert.equal(approvals[1].risky, true);
  assert.equal(approvals[1].reason, 'git push --force');
  assert.deepEqual(approvals[1].preview, { command: 'git push --force', cwd: root, risky: true, reason: 'git push --force' });
  assert.ok(fs.existsSync(path.join(root, 'b.txt')));
  // mesmo em auto, risco pede OK
  const auto = harness({ mode: 'auto', decide: () => 'deny', turns: [{ calls: [{ name: 'run_command', input: { command: 'rm -rf /' } }] }] });
  await auto.promise;
  assert.equal(auto.approvals.length, 1);
});

test('modo edit pede OK para apagar; auto não pede', async () => {
  const del = { calls: [{ name: 'delete_path', input: { path: 'app.js' } }] };
  const edit = harness({ mode: 'edit', decide: () => 'deny', turns: [del] });
  await edit.promise;
  assert.equal(edit.approvals.length, 1);
  assert.ok(fs.existsSync(path.join(root, 'app.js')));
  const auto = harness({ mode: 'auto', turns: [del] });
  const done = await auto.promise;
  assert.equal(auto.approvals.length, 0);
  assert.equal(done.changes[0].deleted, true);
});

test('erro de ferramenta vira tool_end ok:false e resultado de erro para o modelo', async () => {
  const h = harness({ turns: [
    { calls: [{ name: 'read_file', input: { path: '../fora' } }, { name: 'inexistente', input: {} }] },
    { text: 'ok' },
  ] });
  await h.promise;
  const ends = h.events.filter((e) => e.type === 'tool_end');
  assert.equal(ends.length, 2);
  assert.ok(ends.every((e) => e.ok === false));
  assert.match(h.provider.seen[1].messages.at(-2).content, /^Erro: Acesso negado/);
});

test('limite de passos encerra com done.stopped = step_limit', async () => {
  const loopTurn = { calls: [{ name: 'list_dir', input: { path: '.' } }, { name: 'list_dir', input: { path: '.' } }] };
  const h = harness({ maxSteps: 3, turns: Array(10).fill(loopTurn) });
  const done = await h.promise;
  assert.equal(done.steps, 3);
  assert.equal(done.stopped, 'step_limit');
  assert.equal(h.provider.seen.length, 2);
});

test('tools_unsupported e erro do provider', async () => {
  const err = Object.assign(new Error('Erro do provider (400): does not support tools'), { code: 'tools_unsupported', userMessage: 'Erro do provider (400): does not support tools' });
  const h = harness({ turns: [{ throw: err }] });
  const out = await h.promise;
  assert.equal(out.type, 'error');
  assert.equal(out.code, 'tools_unsupported');
  assert.equal(h.events.at(-1).code, 'tools_unsupported');
  const other = harness({ turns: [{ throw: Object.assign(new Error('x'), { userMessage: 'Chave inválida ou sem permissão (401)' }) }] });
  assert.deepEqual(await other.promise, { type: 'error', message: 'Chave inválida ou sem permissão (401)', code: 'provider_error', steps: 0 });
  const events = [];
  await runAgent({ provider: {}, toolbox: createToolbox({ root }), emit: (e) => events.push(e), systemPrompt: '' });
  assert.equal(events[0].code, 'tools_unsupported');
});

// ------------------------------------------------------------- sessões (IPC sem Electron)
function sessions({ turns, mode, getRoot = () => root, runCommand } = {}) {
  const sent = [];
  const provider = fakeProvider(turns);
  const s = createAgentSessions({
    getRoot,
    getProvider: () => ({ provider, model: 'm', apiKey: 'chave-secreta-123' }),
    getMode: () => mode,
    checkpoints: createCheckpointStore({}),
    send: (id, evt) => sent.push([id, evt]),
    getEnv: () => ({ ...process.env }),
    runCommand,
  });
  return { s, sent, provider };
}

test('sessão: sem workspace → error no_workspace', () => {
  const { s, sent } = sessions({ getRoot: () => null });
  assert.equal(s.run('r1', { messages: [] }), false);
  assert.deepEqual(sent, [['r1', { type: 'error', message: 'Abra uma pasta de projeto para usar o agente.', code: 'no_workspace' }]]);
});

test('sessão: approve allow/deny pelo id e modo padrão das settings', async () => {
  const { s, sent } = sessions({ mode: 'ask', turns: [
    { calls: [{ name: 'write_file', input: { path: 'z.txt', content: 'z' } }] },
    { text: 'feito' },
  ] });
  s.run('r2', { messages: [{ role: 'user', content: 'cria z' }] });
  await new Promise((r) => setTimeout(r, 20));
  const approval = sent.find(([, e]) => e.type === 'approval')[1];
  assert.equal(s.approve('r2', 'outro', 'allow'), false);
  assert.equal(s.approve('r2', approval.callId, 'allow'), true);
  await s.wait('r2');
  assert.equal(fs.readFileSync(path.join(root, 'z.txt'), 'utf8'), 'z');
  assert.equal(sent.at(-1)[1].type, 'done');
  assert.ok(sent.every(([id]) => id === 'r2'));
});

test('sessão: cancelar com aprovação pendente', async () => {
  const { s, sent } = sessions({ mode: 'ask', turns: [{ calls: [{ name: 'write_file', input: { path: 'q.txt', content: 'q' } }] }] });
  s.run('r3', { messages: [{ role: 'user', content: 'x' }] });
  await new Promise((r) => setTimeout(r, 20));
  const p = s.wait('r3');
  assert.equal(s.cancel('r3'), true);
  await p;
  const last = sent.at(-1)[1];
  assert.deepEqual(last, { type: 'error', message: 'Interrompido', code: 'cancelled', steps: 1 });
  assert.equal(sent.at(-2)[1].summary, 'Cancelado');
  assert.ok(!fs.existsSync(path.join(root, 'q.txt')));
  assert.equal(s.isActive('r3'), false);
});

test('sessão: cancelar no meio de um comando mata o processo e oferece checkpoint', { skip: process.platform === 'win32' }, async () => {
  const { s, sent } = sessions({ mode: 'auto', turns: [
    { calls: [{ name: 'write_file', input: { path: 'w.txt', content: 'w' } }, { name: 'run_command', input: { command: 'echo inicio; sleep 20' } }] },
  ] });
  const t0 = Date.now();
  s.run('r4', { messages: [{ role: 'user', content: 'x' }] });
  for (let i = 0; i < 100 && !sent.some(([, e]) => e.type === 'tool_output'); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.find(([, e]) => e.type === 'tool_output')[1].chunk, 'inicio\n');
  s.cancel('r4');
  await s.wait('r4');
  assert.ok(Date.now() - t0 < 5000);
  const last = sent.at(-1)[1];
  assert.equal(last.code, 'cancelled');
  assert.ok(last.checkpointId);
  assert.equal(last.changes[0].created, true);
  const end = sent.filter(([, e]) => e.type === 'tool_end').at(-1)[1];
  assert.equal(end.ok, false);
});

test('sessão: allow_session vale para a conversa (conversationId) entre pedidos', async () => {
  const turns = [
    { calls: [{ name: 'write_file', input: { path: 'a.txt', content: 'a' } }] }, { text: 'ok' },
    { calls: [{ name: 'write_file', input: { path: 'b.txt', content: 'b' } }] }, { text: 'ok' },
  ];
  const { s, sent } = sessions({ mode: 'ask', turns });
  s.run('r5', { conversationId: 'conv', messages: [{ role: 'user', content: 'x' }] });
  await new Promise((r) => setTimeout(r, 20));
  s.approve('r5', sent.find(([, e]) => e.type === 'approval')[1].callId, 'allow_session');
  await s.wait('r5');
  s.run('r6', { conversationId: 'conv', messages: [{ role: 'user', content: 'y' }] });
  await s.wait('r6');
  assert.equal(sent.filter(([id, e]) => id === 'r6' && e.type === 'approval').length, 0);
  assert.ok(fs.existsSync(path.join(root, 'b.txt')));
});

// ------------------------------------------------- ferramentas extras (módulos)
function modTool({ kind = 'write', risk } = {}) {
  return {
    definition: { name: 'mod_tool', description: 'teste', input_schema: { type: 'object' } },
    kind,
    prepare(input, ctx) {
      const abs = ctx.resolvePath(input.path || 'app.js');
      return {
        title: 'mod',
        preview: risk ? { path: abs, risk } : { path: abs },
        run: async () => {
          ctx.checkpoint?.record(abs);
          fs.writeFileSync(abs, 'mod\n');
          return { summary: 'ok', changed: [abs] };
        },
      };
    },
  };
}

function modHarness({ mode, tool, decide = () => 'allow' }) {
  const events = [];
  const provider = fakeProvider([{ calls: [{ name: 'mod_tool', input: { path: 'app.js' } }] }, { text: 'fim' }]);
  const checkpoint = createCheckpointStore({}).create({ root });
  const toolbox = createToolbox({ root, checkpoint, extraTools: [tool] });
  const approvals = [];
  const promise = runAgent({
    provider, model: 'm', history: [{ role: 'user', content: 'x' }], mode, toolbox, checkpoint,
    emit: (e) => events.push(e), systemPrompt: 'S',
    requestApproval: async (id) => { approvals.push(id); return decide(); },
  });
  return { events, approvals, promise, provider };
}

test('extra: kind write pede OK no modo ask e não no modo edit', async () => {
  const ask = modHarness({ mode: 'ask', tool: modTool() });
  await ask.promise;
  assert.equal(ask.approvals.length, 1);
  assert.ok(ask.provider.seen[0].tools.some((t) => t.name === 'mod_tool'));
  const edit = modHarness({ mode: 'edit', tool: modTool() });
  await edit.promise;
  assert.equal(edit.approvals.length, 0);
  assert.ok(edit.events.some((e) => e.type === 'file_changed' && e.path === path.join(root, 'app.js')));
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'mod\n');
  // read nunca pede; command segue a regra de comando (edit pede)
  const read = modHarness({ mode: 'ask', tool: modTool({ kind: 'read' }) });
  await read.promise;
  assert.equal(read.approvals.length, 0);
  const cmd = modHarness({ mode: 'edit', tool: modTool({ kind: 'command' }) });
  await cmd.promise;
  assert.equal(cmd.approvals.length, 1);
});

test('extra: preview.risk força aprovação no modo auto', async () => {
  const h = modHarness({ mode: 'auto', tool: modTool({ risk: 'commit com possíveis segredos' }), decide: () => 'deny' });
  await h.promise;
  assert.equal(h.approvals.length, 1);
  const approval = h.events.find((e) => e.type === 'approval');
  assert.equal(approval.risky, true);
  assert.equal(approval.reason, 'commit com possíveis segredos');
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'let x = 1;\n');
  // risco vale mesmo para kind read
  const r = modHarness({ mode: 'auto', tool: modTool({ kind: 'read', risk: 'x' }), decide: () => 'deny' });
  await r.promise;
  assert.equal(r.approvals.length, 1);
});

test('sessão: getExtraTools passa ferramentas de módulos ao toolbox', async () => {
  const provider = fakeProvider([{ calls: [{ name: 'mod_tool', input: { path: 'app.js' } }] }, { text: 'fim' }]);
  const sent = [];
  const s = createAgentSessions({
    getRoot: () => root,
    getProvider: () => ({ provider, model: 'm' }),
    getMode: () => 'edit',
    checkpoints: createCheckpointStore({}),
    send: (id, evt) => sent.push([id, evt]),
    getEnv: () => ({ ...process.env }),
    getExtraTools: () => [modTool()],
  });
  s.run('rx', { messages: [{ role: 'user', content: 'x' }] });
  await s.wait('rx');
  assert.ok(provider.seen[0].tools.some((t) => t.name === 'mod_tool'));
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'mod\n');
  assert.equal(sent.at(-1)[1].type, 'done');
});
