const { test } = require('node:test');
const assert = require('node:assert/strict');
const { register } = require('../../src/main/ipc/ai');

test('IPC salva perfil sem chave em settings e testa rascunho sem salvar', async () => {
  const handlers = {};
  const secrets = new Map();
  let settings = {};
  const requests = [];
  const store = { get: (key) => secrets.get(key), set: (key, value) => secrets.set(key, value), delete: (key) => secrets.delete(key) };
  register({ handle: (channel, handler) => { handlers[channel] = handler; } }, {
    store, settingsStore: { load: () => settings, save: (value) => { settings = value; } },
    fetchImpl: async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify({ data: [{ id: 'm' }] })); },
  });
  const draft = { preset: 'custom', baseUrl: 'http://localhost:1234/v1', label: 'Teste', apiKey: 'não persistir' };
  const result = await handlers['ai:test'](null, draft, 'temporária');
  assert.deepEqual(result, { ok: true, models: 1 });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer temporária');
  assert.deepEqual(settings, {});
  assert.equal(secrets.size, 0);
  const profile = handlers['ai:profile:save'](null, draft, 'segredo');
  assert.equal(secrets.get(`ai.${profile.id}`), 'segredo');
  assert.ok(!JSON.stringify(settings).includes('segredo'));
  assert.ok(!JSON.stringify(settings).includes('não persistir'));
  assert.equal(handlers['ai:profiles']().activeProfileId, profile.id);
  handlers['ai:profile:remove'](null, profile.id);
  assert.equal(secrets.size, 0);
  assert.equal(handlers['ai:profiles']().activeProfileId, null);
});

test('chat com skill de projeto não confiada → ai:error, sem chamar o provedor', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createPathGuard } = require('../../src/main/lib/path-guard');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-chat-skill-')));
  fs.mkdirSync(path.join(root, '.agzos', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agzos', 'skills', 'c.md'), '---\nid: c\nlabel: C\nkind: chat\n---\nMal.');
  const guard = createPathGuard();
  guard.allow(root);
  const handlers = {};
  const requests = [];
  const settings = { ai: { activeProfileId: 'p', profiles: [{ id: 'p', preset: 'custom', baseUrl: 'http://x/v1', model: 'm' }] } };
  register({ handle: (channel, handler) => { handlers[channel] = handler; } }, {
    store: { get: () => 'k' }, settingsStore: { load: () => settings, save: () => {} }, guard,
    fetchImpl: async (url) => { requests.push(url); return new Response('{}'); },
  });
  const sent = [];
  const sender = { isDestroyed: () => false, send: (...args) => sent.push(args), once: () => {} };
  await handlers['ai:chat']({ sender }, 'r1', { messages: [{ role: 'user', content: 'oi' }], skill: 'project:c', root });
  assert.equal(sent[0][0], 'ai:error');
  assert.equal(sent[0][1], 'r1');
  assert.match(sent[0][2], /confiável/);
  assert.equal(requests.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

function summarizeSetup(fake) {
  const handlers = {};
  const settings = { ai: { activeProfileId: 'p', profiles: [{ id: 'p', preset: 'custom', baseUrl: `${fake.baseUrl}/v1`, model: 'm1' }] } };
  register({ handle: (channel, handler) => { handlers[channel] = handler; } }, {
    store: { get: () => 'k' }, settingsStore: { load: () => settings, save: () => {} },
  });
  return handlers;
}

test('ai:summarize: chama o modelo com o prompt de resumo e devolve o texto', async () => {
  const { startFakeOpenAI } = require('../e2e/fake-openai');
  const { SUMMARY_PROMPT } = require('../../src/main/ai/compact');
  const fake = await startFakeOpenAI({ reply: '## Objetivo\nTestar.', delayMs: 1 });
  try {
    const handlers = summarizeSetup(fake);
    const out = await handlers['ai:summarize']({ sender: {} }, 's1', {
      profileId: 'p', model: 'm2',
      messages: [{ role: 'system', content: 'ctx' }, { role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }],
    });
    assert.deepEqual(out, { ok: true, summary: '## Objetivo\nTestar.' });
    const body = fake.requests.find((r) => r.path === '/v1/chat/completions').body;
    assert.equal(body.model, 'm2');
    assert.equal(body.messages[0].content, SUMMARY_PROMPT);
    assert.deepEqual(body.messages.slice(1, 3).map((m) => m.content), ['oi', 'olá']);
    assert.match(body.messages.at(-1).content, /Resuma/);
  } finally { await fake.close(); }
});

test('ai:summarize: erro do provedor → { ok: false, error } claro', async () => {
  const { startFakeOpenAI } = require('../e2e/fake-openai');
  const fake = await startFakeOpenAI({ status: 500 });
  try {
    const handlers = summarizeSetup(fake);
    const out = await handlers['ai:summarize']({ sender: {} }, 's2', { messages: [{ role: 'user', content: 'oi' }] });
    assert.equal(out.ok, false);
    assert.match(out.error, /resumir|compactar/i);
    const empty = await handlers['ai:summarize']({ sender: {} }, 's3', { messages: [] });
    assert.equal(empty.ok, false);
  } finally { await fake.close(); }
});
