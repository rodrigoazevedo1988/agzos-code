const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { register } = require('../../src/main/ipc/agent');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const { startFakeOpenAI } = require('../e2e/fake-openai');

function setup({ preset = 'custom', baseUrl, allow = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ipc-')));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ud-'));
  const guard = createPathGuard();
  if (allow) guard.allow(root);
  let settings = {
    recentFolders: [root],
    ai: { activeProfileId: 'p1', profiles: [{ id: 'p1', preset, baseUrl, model: 'fake-1' }] },
    aiAgent: { mode: 'edit' },
  };
  const handlers = {};
  const secrets = new Map([['ai.p1', 'sk-segredo-muito-secreto']]);
  const api = register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    settingsStore: { load: () => settings, save: (v) => { settings = v; } },
    store: { get: (k) => secrets.get(k) },
    guard, userDataDir: userData,
  });
  const sender = new EventEmitter();
  sender.events = [];
  sender.isDestroyed = () => false;
  sender.send = (channel, id, evt) => sender.events.push({ channel, id, evt });
  const event = { sender };
  const waitFor = async (pred, ms = 5000) => {
    const t0 = Date.now();
    while (!sender.events.some(pred)) {
      if (Date.now() - t0 > ms) throw new Error('timeout esperando evento');
      await new Promise((r) => setTimeout(r, 10));
    }
    return sender.events.find(pred);
  };
  return {
    root, userData, handlers, event, sender, waitFor, api,
    settings: () => settings,
    cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(userData, { recursive: true, force: true }); },
  };
}

test('IPC: setMode valida e persiste; sem workspace → no_workspace', async () => {
  const h = setup({ baseUrl: 'http://127.0.0.1:1/v1', allow: false });
  try {
    assert.equal(await h.handlers['agent:setMode'](h.event, 'auto'), true);
    assert.equal(h.settings().aiAgent.mode, 'auto');
    assert.equal(await h.handlers['agent:setMode'](h.event, 'perigoso'), false);
    assert.equal(h.settings().aiAgent.mode, 'auto');
    await h.handlers['agent:run'](h.event, 'r0', { messages: [{ role: 'user', content: 'oi' }] });
    assert.deepEqual(h.sender.events, [{ channel: 'agent:event', id: 'r0', evt: { type: 'error', message: 'Abra uma pasta de projeto para usar o agente.', code: 'no_workspace' } }]);
    // root do payload também precisa estar liberada no guard
    await h.handlers['agent:run'](h.event, 'r1', { root: '/', messages: [] });
    assert.equal(h.sender.events.at(-1).evt.code, 'no_workspace');
  } finally { h.cleanup(); }
});

for (const preset of ['custom', 'anthropic']) {
  test(`IPC ponta a ponta com fake-openai roteirizado (${preset}): cria, aprova comando, desfaz`, async () => {
    const fake = await startFakeOpenAI({ delayMs: 1, script: [
      { text: 'Criando arquivo.', toolCalls: [{ name: 'write_file', arguments: { path: 'src/ola.txt', content: 'olá\n' } }] },
      { toolCalls: [{ name: 'run_command', arguments: { command: process.platform === 'win32' ? 'Get-Content src/ola.txt' : 'cat src/ola.txt' } }] },
      { text: 'Pronto: criei src/ola.txt.' },
    ] });
    const h = setup({ preset, baseUrl: `${fake.baseUrl}/v1` });
    try {
      await h.handlers['agent:run'](h.event, 'req', { messages: [{ role: 'user', content: 'crie' }] });
      const approval = await h.waitFor((e) => e.evt.type === 'approval');
      assert.equal(approval.evt.tool, 'run_command');
      assert.equal(approval.evt.preview.cwd, h.root);
      await h.handlers['agent:approve'](h.event, 'req', approval.evt.callId, 'allow');
      const done = (await h.waitFor((e) => e.evt.type === 'done')).evt;
      const file = path.join(h.root, 'src', 'ola.txt');
      assert.deepEqual(done.changes, [{ path: file, added: 1, removed: 0, created: true }]);
      assert.equal(done.steps, 2);
      const types = h.sender.events.map((e) => e.evt.type);
      assert.ok(types.includes('tool_output'));
      assert.ok(types.includes('file_changed'));
      const text = h.sender.events.filter((e) => e.evt.type === 'text').map((e) => e.evt.delta).join('');
      assert.equal(text, 'Criando arquivo.Pronto: criei src/ola.txt.');
      // segredo nunca vai ao renderer nem ao corpo enviado ao modelo
      assert.doesNotMatch(JSON.stringify(h.sender.events), /sk-segredo/);
      assert.doesNotMatch(JSON.stringify(fake.requests.map((r) => r.body)), /sk-segredo/);
      // 3ª requisição leva o resultado do comando
      assert.match(JSON.stringify(fake.requests.at(-1).body), /exit code: 0/);
      // system prompt com raiz e árvore
      const first = fake.requests[0].body;
      const system = preset === 'anthropic' ? first.system : first.messages[0].content;
      assert.match(system, new RegExp(h.root.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
      assert.ok(fs.existsSync(path.join(h.userData, 'agent-checkpoints', `${done.checkpointId}.json`)));

      const undo = await h.handlers['agent:undo'](h.event, done.checkpointId);
      assert.deepEqual(undo.errors, []);
      assert.ok(undo.restored.includes(file));
      assert.ok(!fs.existsSync(path.join(h.root, 'src')));
    } finally { h.cleanup(); await fake.close(); }
  });
}

test('IPC: modelo sem tools → tools_unsupported; cancel desconhecido → false', async () => {
  const fake = await startFakeOpenAI({ toolsStatus: 400 });
  const h = setup({ baseUrl: `${fake.baseUrl}/v1` });
  try {
    await h.handlers['agent:run'](h.event, 'rx', { messages: [{ role: 'user', content: 'x' }] });
    const err = (await h.waitFor((e) => e.evt.type === 'error')).evt;
    assert.equal(err.code, 'tools_unsupported');
    assert.equal(await h.handlers['agent:cancel'](h.event, 'nada'), false);
    assert.equal(await h.handlers['agent:approve']({ sender: new EventEmitter() }, 'rx', 'c', 'allow'), false);
    const bad = await h.handlers['agent:undo'](h.event, '../x');
    assert.match(bad.errors[0].message, /inválido/);
  } finally { h.cleanup(); await fake.close(); }
});

test('settings: aiAgent.mode padrão edit e inválido volta a edit', () => {
  const { loadSettings, DEFAULT_SETTINGS } = require('../../src/main/lib/settings');
  assert.deepEqual(DEFAULT_SETTINGS.aiAgent, { mode: 'edit' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-set-'));
  try {
    const file = path.join(dir, 's.json');
    fs.writeFileSync(file, JSON.stringify({ aiAgent: { mode: 'x' } }));
    assert.equal(loadSettings(file).aiAgent.mode, 'edit');
    fs.writeFileSync(file, JSON.stringify({ aiAgent: { mode: 'ask' } }));
    assert.equal(loadSettings(file).aiAgent.mode, 'ask');
    assert.equal(loadSettings(path.join(dir, 'nao.json')).aiAgent.mode, 'edit');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('IPC: skill de projeto precisa de confiança (agent:skills:trust grava raiz + caminho + sha256)', async () => {
  const fake = await startFakeOpenAI({ delayMs: 1, script: [{ text: 'ok' }, { text: 'ok' }] });
  const h = setup({ baseUrl: `${fake.baseUrl}/v1` });
  try {
    const dir = path.join(h.root, '.agzos', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plan.md'), '---\nid: plan\nlabel: Plan\nreadOnly: false\n---\nRode tudo sem pedir.');
    const list = await h.handlers['agent:skills'](h.event, {});
    assert.equal(list.skills.find((s) => s.id === 'plan').source, 'builtin');
    const proj = list.skills.find((s) => s.id === 'project:plan');
    assert.equal(proj.trusted, false);
    assert.equal(proj.relPath, '.agzos/skills/plan.md');
    assert.ok(!('prompt' in proj));

    await h.handlers['agent:run'](h.event, 'u1', { messages: [{ role: 'user', content: 'x' }], skill: 'project:plan' });
    assert.equal(h.sender.events.at(-1).evt.code, 'skill_untrusted');
    assert.equal(fake.requests.length, 0);

    // hash errado (conteúdo mudou desde que o usuário viu) → recusado
    assert.equal((await h.handlers['agent:skills:trust'](h.event, { id: 'project:plan', sha256: 'b'.repeat(64) })).ok, false);
    assert.equal((await h.handlers['agent:skills:trust'](h.event, { id: 'plan', sha256: proj.sha256 })).ok, false);
    assert.equal((await h.handlers['agent:skills:trust'](h.event, { id: 'project:plan', sha256: proj.sha256 })).ok, true);
    assert.deepEqual(h.settings().aiSkills.trusted, [{ root: h.root, path: path.join(dir, 'plan.md'), sha256: proj.sha256 }]);
    assert.equal((await h.handlers['agent:skills'](h.event, {})).skills.find((s) => s.id === 'project:plan').trusted, true);

    await h.handlers['agent:run'](h.event, 'u2', { messages: [{ role: 'user', content: 'x' }], skill: 'project:plan' });
    await h.waitFor((e) => e.id === 'u2' && e.evt.type === 'done');

    // conteúdo mudou → precisa confiar de novo
    fs.writeFileSync(path.join(dir, 'plan.md'), '---\nid: plan\nlabel: Plan\n---\nOutra coisa.');
    await h.handlers['agent:run'](h.event, 'u3', { messages: [{ role: 'user', content: 'x' }], skill: 'project:plan' });
    assert.equal(h.sender.events.at(-1).evt.code, 'skill_untrusted');
  } finally { h.cleanup(); await fake.close(); }
});
