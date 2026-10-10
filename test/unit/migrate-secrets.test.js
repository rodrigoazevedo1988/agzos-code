const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrateLegacySecrets } = require('../../src/main/lib/settings');

function fakeStore() {
  const data = new Map();
  return {
    set: (k, v) => data.set(k, v),
    get: (k) => (data.has(k) ? data.get(k) : null),
    has: (k) => data.has(k),
    delete: (k) => data.delete(k),
  };
}

test('migra aiApiKey e token do onboarding para o cofre', () => {
  const store = fakeStore();
  const settings = {
    aiApiKey: 'sk-1',
    onboardingAnswers: { theme: 'agzos-dark', github: { type: 'pat', token: 'ghp_1' } },
  };
  const out = migrateLegacySecrets(settings, store);

  assert.equal(store.get('ai.legacy'), 'sk-1');
  assert.equal(store.get('github.onboarding'), 'ghp_1');
  assert.equal(out.settings.aiApiKey, undefined);
  assert.deepEqual(out.settings.onboardingAnswers.github, { type: 'pat' });
  assert.equal(out.changed, true);
});

test('sem segredos antigos não altera nada', () => {
  const store = fakeStore();
  const out = migrateLegacySecrets({ theme: 'agzos-dark' }, store);
  assert.equal(out.changed, false);
  assert.equal(store.has('ai.legacy'), false);
});

test('cofre indisponível mantém aiApiKey e não marca como migrado', () => {
  const store = { set: () => { throw new Error('Cofre do sistema indisponível'); }, has: () => false };
  const out = migrateLegacySecrets({ aiApiKey: 'sk-1' }, store);
  assert.equal(out.settings.aiApiKey, 'sk-1');
  assert.equal(out.changed, false);
});
