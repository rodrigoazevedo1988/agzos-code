const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSecretStore } = require('../../src/main/lib/secrets');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('enc:' + s),
    decryptString: (b) => b.toString().slice(4),
  };
}

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-secrets-'));
  return path.join(dir, 'secrets.json');
}

test('set, get, has e delete', () => {
  const store = createSecretStore({ filePath: tmpFile(), safeStorage: fakeSafeStorage() });
  assert.equal(store.has('ai.x'), false);
  store.set('ai.x', 'sk-123');
  assert.equal(store.has('ai.x'), true);
  assert.equal(store.get('ai.x'), 'sk-123');
  store.delete('ai.x');
  assert.equal(store.has('ai.x'), false);
  assert.equal(store.get('ai.x'), null);
});

test('arquivo não contém o valor em texto puro', () => {
  const f = tmpFile();
  const store = createSecretStore({ filePath: f, safeStorage: fakeSafeStorage() });
  store.set('ai.x', 'sk-123');
  const conteudo = fs.readFileSync(f, 'utf-8');
  assert.ok(!conteudo.includes('sk-123'));
});

test('set lança quando cofre indisponível', () => {
  const store = createSecretStore({ filePath: tmpFile(), safeStorage: fakeSafeStorage(false) });
  assert.throws(() => store.set('ai.x', 'sk-1'), /Cofre do sistema indisponível/);
  assert.equal(store.has('ai.x'), false);
});
