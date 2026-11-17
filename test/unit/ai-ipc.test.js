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
