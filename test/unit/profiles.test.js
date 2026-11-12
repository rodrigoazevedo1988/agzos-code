const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS } = require('../../src/main/ai/presets');
const {
  upsertProfile,
  removeProfile,
  setActiveProfile,
  getActiveProfile,
  migrateLegacyAi,
  createProviderForProfile,
} = require('../../src/main/ai/profiles');

function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => data.set(key, value),
    delete: (key) => data.delete(key),
    has: (key) => data.has(key),
  };
}

test('primeiro perfil vira ativo sem alterar settings originais', () => {
  const settings = { theme: 'agzos-dark', ai: { profiles: [], activeProfileId: null } };
  const profile = { id: 'p1', preset: 'openai', label: 'Meu OpenAI', baseUrl: PRESETS.openai.baseUrl, model: null };
  const out = upsertProfile(settings, profile);

  assert.deepEqual(out.ai.profiles, [profile]);
  assert.equal(out.ai.activeProfileId, 'p1');
  assert.equal(settings.ai.profiles.length, 0);
});

test('remover o perfil ativo ativa o próximo', () => {
  const settings = { ai: { activeProfileId: 'p1', profiles: [
    { id: 'p1', preset: 'openai' }, { id: 'p2', preset: 'groq' },
  ] } };
  const out = removeProfile(settings, 'p1');
  assert.deepEqual(out.ai.profiles.map(({ id }) => id), ['p2']);
  assert.equal(out.ai.activeProfileId, 'p2');
});

test('remover o último perfil deixa ativo null', () => {
  const settings = { ai: { activeProfileId: 'p1', profiles: [{ id: 'p1' }] } };
  const out = removeProfile(settings, 'p1');
  assert.deepEqual(out.ai.profiles, []);
  assert.equal(out.ai.activeProfileId, null);
});

test('migrates aiProvider e ai.legacy para um perfil', () => {
  const store = fakeStore({ 'ai.legacy': 'sk-test' });
  const settings = { aiProvider: 'anthropic', ai: { activeProfileId: null, profiles: [] } };
  const out = migrateLegacyAi(settings, store);
  assert.equal(out.changed, true);
  assert.equal(out.settings.aiProvider, undefined);
  assert.equal(out.settings.ai.profiles.length, 1);
  assert.equal(out.settings.ai.profiles[0].preset, 'anthropic');
  assert.equal(out.settings.ai.profiles[0].baseUrl, PRESETS.anthropic.baseUrl);
  assert.equal(out.settings.ai.activeProfileId, out.settings.ai.profiles[0].id);
  assert.equal(store.get(`ai.${out.settings.ai.profiles[0].id}`), 'sk-test');
  assert.equal(store.has('ai.legacy'), false);
});

test('aguarda a chave legacy em settings ser migrada para o cofre', () => {
  const settings = { aiProvider: 'openai', aiApiKey: 'sk-test', ai: { activeProfileId: null, profiles: [] } };
  const out = migrateLegacyAi(settings, fakeStore());
  assert.equal(out.changed, false);
  assert.equal(out.settings.aiProvider, 'openai');
  assert.equal(out.settings.ai.profiles.length, 0);
});

test('fábrica escolhe provider Anthropic pelo preset', () => {
  const fetchImpl = async () => new Response(JSON.stringify({ data: [{ id: 'claude' }] }));
  const provider = createProviderForProfile({ id: 'p1', preset: 'anthropic', baseUrl: PRESETS.anthropic.baseUrl }, fakeStore({ 'ai.p1': 'key' }), { fetchImpl });
  assert.deepEqual(Object.keys(provider).sort(), ['chat', 'listModels', 'testConnection']);
  return provider.listModels().then((models) => assert.deepEqual(models, ['claude']));
});

test('setActiveProfile e getActiveProfile usam o id do perfil', () => {
  const settings = { ai: { activeProfileId: null, profiles: [{ id: 'p1', label: 'OpenAI' }] } };
  assert.equal(getActiveProfile(settings), null);
  const out = setActiveProfile(settings, 'p1');
  assert.equal(getActiveProfile(out).id, 'p1');
  assert.equal(settings.ai.activeProfileId, null);
});
