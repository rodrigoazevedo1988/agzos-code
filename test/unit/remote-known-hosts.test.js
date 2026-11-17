const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const kh = require('../../src/main/remote/known-hosts');
const { generateKey, publicBlob } = require('../fixtures/ssh-server');

const keyA = publicBlob(generateKey().private);
const keyB = publicBlob(generateKey().private);
const rsa = publicBlob(generateKey('rsa', { bits: 2048 }).private);

function hashed(pattern, salt = crypto.randomBytes(20)) {
  const hash = crypto.createHmac('sha1', salt).update(pattern).digest();
  return `|1|${salt.toString('base64')}|${hash.toString('base64')}`;
}

const line = (hosts, blob) => `${hosts} ${kh.keyTypeOf(blob)} ${blob.toString('base64')}`;

test('keyTypeOf lê o tipo do blob', () => {
  assert.equal(kh.keyTypeOf(keyA), 'ssh-ed25519');
  assert.equal(kh.keyTypeOf(rsa), 'ssh-rsa');
  assert.equal(kh.keyTypeOf(Buffer.alloc(2)), null);
});

test('parseKnownHosts: hosts, hash |1|, marcadores, comentários e linhas inválidas', () => {
  const text = [
    '# comentário',
    '',
    line('example.com,10.0.0.1', keyA),
    line(hashed('[srv.local]:2222'), keyB),
    `@cert-authority *.corp ${kh.keyTypeOf(keyA)} ${keyA.toString('base64')}`,
    'lixo sem chave',
    `host ssh-ed25519 !!!naobase64`,
  ].join('\n');
  const entries = kh.parseKnownHosts(text);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0].hosts, ['example.com', '10.0.0.1']);
  assert.equal(entries[0].keyType, 'ssh-ed25519');
  assert.ok(entries[1].hosts.hashed);
  assert.equal(entries[2].marker, '@cert-authority');
});

test('checkHostKey: match, unknown e mismatch (porta padrão e [host]:porta)', () => {
  const entries = kh.parseKnownHosts([line('example.com', keyA), line('[example.com]:2222', keyB)].join('\n'));
  assert.equal(kh.checkHostKey(entries, 'example.com', 22, keyA), 'match');
  assert.equal(kh.checkHostKey(entries, 'example.com', 22, keyB), 'mismatch');
  assert.equal(kh.checkHostKey(entries, 'example.com', 2222, keyB), 'match');
  assert.equal(kh.checkHostKey(entries, 'example.com', 2222, keyA), 'mismatch');
  assert.equal(kh.checkHostKey(entries, 'outro.com', 22, keyA), 'unknown');
  // Outro tipo de chave para um host já registrado: divergente (o MITM não vira "host desconhecido").
  assert.equal(kh.checkHostKey(entries, 'example.com', 22, rsa), 'mismatch');
  assert.equal(kh.checkHostKey(entries, 'outro.com', 22, rsa), 'unknown');
});

test('knownKeyTypes e hostKeyAlgorithms: restringem o handshake aos tipos registrados para o host', () => {
  const entries = kh.parseKnownHosts([
    line('example.com', keyA),
    line('[example.com]:2222', rsa),
    line(hashed('hash.io'), rsa),
    `@revoked example.com ${kh.keyTypeOf(keyB)} ${keyB.toString('base64')}`,
  ].join('\n'));
  assert.deepEqual(kh.knownKeyTypes(entries, 'example.com', 22), ['ssh-ed25519']);
  assert.deepEqual(kh.knownKeyTypes(entries, 'EXAMPLE.com', 2222), ['ssh-rsa']);
  assert.deepEqual(kh.knownKeyTypes(entries, 'Hash.IO', 22), ['ssh-rsa']);
  assert.deepEqual(kh.knownKeyTypes(entries, 'outro.com', 22), []);
  assert.deepEqual(kh.hostKeyAlgorithms(['ssh-ed25519']), ['ssh-ed25519']);
  assert.deepEqual(kh.hostKeyAlgorithms(['ssh-rsa']), ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa']);
  assert.deepEqual(kh.hostKeyAlgorithms(['ecdsa-sha2-nistp256', 'ssh-ed25519']), ['ecdsa-sha2-nistp256', 'ssh-ed25519']);
  assert.equal(kh.hostKeyAlgorithms([]), null);
  assert.equal(kh.hostKeyAlgorithms(['tipo-desconhecido']), null);
});

test('host com maiúsculas casa com entrada em minúsculas (texto e hash |1|)', () => {
  const entries = kh.parseKnownHosts([line(hashed('example.com'), keyA), line(hashed('[srv.io]:2200'), keyA), line('plain.io', keyB)].join('\n'));
  assert.equal(kh.checkHostKey(entries, 'Example.COM', 22, keyA), 'match');
  assert.equal(kh.checkHostKey(entries, 'SRV.io', 2200, keyA), 'match');
  assert.equal(kh.checkHostKey(entries, 'Plain.IO', 22, keyB), 'match');
  assert.equal(kh.checkHostKey(entries, 'Example.COM', 22, keyB), 'mismatch');
  assert.match(kh.formatEntry('Example.COM', 22, keyA), /^example\.com ssh-ed25519 /);
});

test('checkHostKey: hash |1| (inclusive com porta) e mismatch em hash', () => {
  const entries = kh.parseKnownHosts([line(hashed('10.1.1.1'), keyA), line(hashed('[10.1.1.1]:2200'), keyA)].join('\n'));
  assert.equal(kh.checkHostKey(entries, '10.1.1.1', 22, keyA), 'match');
  assert.equal(kh.checkHostKey(entries, '10.1.1.1', 2200, keyA), 'match');
  assert.equal(kh.checkHostKey(entries, '10.1.1.1', 22, keyB), 'mismatch');
  assert.equal(kh.checkHostKey(entries, '10.1.1.2', 22, keyA), 'unknown');
});

test('checkHostKey: curingas, negação e @revoked', () => {
  const entries = kh.parseKnownHosts([
    line('*.example.com,!bad.example.com', keyA),
    `@revoked * ${kh.keyTypeOf(keyB)} ${keyB.toString('base64')}`,
  ].join('\n'));
  assert.equal(kh.checkHostKey(entries, 'a.example.com', 22, keyA), 'match');
  assert.equal(kh.checkHostKey(entries, 'bad.example.com', 22, keyA), 'unknown');
  // Chave revogada nunca passa.
  assert.equal(kh.checkHostKey(entries, 'qualquer', 22, keyB), 'mismatch');
});

test('fingerprint SHA256 como o ssh-keygen (base64 sem =)', () => {
  const fp = kh.fingerprint(keyA);
  const expected = `SHA256:${crypto.createHash('sha256').update(keyA).digest('base64').replace(/=+$/, '')}`;
  assert.equal(fp, expected);
});

test('formatEntry gera linha que o parser reconhece', () => {
  const l1 = kh.formatEntry('example.com', 22, keyA);
  const l2 = kh.formatEntry('::1', 2222, keyA);
  assert.match(l1, /^example\.com ssh-ed25519 /);
  assert.match(l2, /^\[::1\]:2222 ssh-ed25519 /);
  const entries = kh.parseKnownHosts(l1 + l2);
  assert.equal(kh.checkHostKey(entries, 'example.com', 22, keyA), 'match');
  assert.equal(kh.checkHostKey(entries, '::1', 2222, keyA), 'match');
});

test('hostPattern rejeita host com espaço ou quebra de linha (não injeta linha no known_hosts)', () => {
  assert.throws(() => kh.formatEntry('a b', 22, keyA), /Host inválido/);
  assert.throws(() => kh.formatEntry('a\nb', 22, keyA), /Host inválido/);
});
