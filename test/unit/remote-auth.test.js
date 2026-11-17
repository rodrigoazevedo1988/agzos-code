const { test } = require('node:test');
const assert = require('node:assert/strict');

const { authOrder, createAuthHandler, vaultKeyFor } = require('../../src/main/remote/auth');
const { generateKey } = require('../fixtures/ssh-server');

const home = '/home/u';
const exists = (set) => (p) => set.has(p);

test('authOrder: agente (SSH_AUTH_SOCK), IdentityFile, chaves padrão e por fim senha', () => {
  const order = authOrder({
    platform: 'linux',
    env: { SSH_AUTH_SOCK: '/tmp/agent.sock' },
    home,
    identityFiles: ['~/.ssh/trabalho'],
    exists: exists(new Set(['/home/u/.ssh/trabalho', '/home/u/.ssh/id_rsa', '/home/u/.ssh/id_ed25519'])),
  });
  assert.deepEqual(order, [
    { type: 'agent', agent: '/tmp/agent.sock' },
    { type: 'key', path: '/home/u/.ssh/trabalho' },
    { type: 'key', path: '/home/u/.ssh/id_ed25519' },
    { type: 'key', path: '/home/u/.ssh/id_rsa' },
    { type: 'password' },
  ]);
});

test('authOrder: sem agente e sem chaves → só senha; IdentityFile inexistente é ignorado', () => {
  const order = authOrder({ platform: 'linux', env: {}, home, identityFiles: ['/nao/existe'], exists: () => false });
  assert.deepEqual(order, [{ type: 'password' }]);
});

test('authOrder: Windows usa o pipe do OpenSSH e depois o Pageant', () => {
  const order = authOrder({ platform: 'win32', env: {}, home: 'C:\\Users\\u', exists: () => false });
  assert.deepEqual(order.slice(0, 2), [
    { type: 'agent', agent: '\\\\.\\pipe\\openssh-ssh-agent' },
    { type: 'agent', agent: 'pageant' },
  ]);
  assert.deepEqual(order.at(-1), { type: 'password' });
});

test('authOrder: IdentityFile repetido não duplica', () => {
  const order = authOrder({
    platform: 'linux', env: {}, home, identityFiles: ['~/.ssh/id_rsa'],
    exists: exists(new Set(['/home/u/.ssh/id_rsa'])),
  });
  assert.deepEqual(order, [{ type: 'key', path: '/home/u/.ssh/id_rsa' }, { type: 'password' }]);
});

test('vaultKeyFor: ssh.<user>@<host>:<porta>', () => {
  assert.equal(vaultKeyFor({ user: 'deploy', host: '10.0.0.5', port: 22 }), 'ssh.deploy@10.0.0.5:22');
});

function memoryVault(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    isAvailable: () => true,
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => map.set(k, v),
    delete: (k) => map.delete(k),
    map,
  };
}

// Simula o ssh2: chama o handler, recebe o próximo método e decide se aceitou.
function driveHandler(handler, accept) {
  return new Promise((resolve) => {
    const tried = [];
    const step = (methodsLeft) => {
      handler(methodsLeft, false, (next) => {
        if (next === false) return resolve({ ok: false, tried });
        tried.push(next);
        if (accept(next)) return resolve({ ok: true, tried });
        step(['publickey', 'password']);
      });
    };
    step(null);
  });
}

const resolved = { user: 'deploy', host: 'h', port: 22 };

test('senha salva errada é apagada do cofre e pedida de novo; "Lembrar" grava só após sucesso', async () => {
  const vault = memoryVault({ 'ssh.deploy@h:22': 'velha' });
  const asked = [];
  const handler = createAuthHandler({
    resolved,
    order: [{ type: 'password' }],
    secretStore: vault,
    askSecret: async (req) => { asked.push(req); return { value: 'nova', remember: true }; },
  });
  const res = await driveHandler(handler, (n) => n.type === 'password' && n.password === 'nova');
  assert.equal(res.ok, true);
  assert.deepEqual(res.tried.map((t) => t.password), ['velha', 'nova']);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].kind, 'password');
  assert.match(asked[0].message, /salva.*recusada|recusada/i);
  assert.equal(vault.get('ssh.deploy@h:22'), null, 'senha errada apagada');
  handler.onReady();
  assert.equal(vault.get('ssh.deploy@h:22'), 'nova');
});

test('senha sem "Lembrar" não vai ao cofre; cancelar encerra com cancelled', async () => {
  const vault = memoryVault();
  let n = 0;
  const handler = createAuthHandler({
    resolved, order: [{ type: 'password' }], secretStore: vault,
    askSecret: async () => (++n === 1 ? { value: 'errada', remember: false } : null),
  });
  const res = await driveHandler(handler, () => false);
  assert.equal(res.ok, false);
  assert.equal(handler.cancelled(), true);
  handler.onReady();
  assert.equal(vault.map.size, 0);
});

test('chave com passphrase: pede a passphrase; chave recusada passa para a próxima', async () => {
  const enc = generateKey('ed25519', { passphrase: 'segredo', cipher: 'aes256-ctr' });
  const plain = generateKey();
  const files = { '/k/enc': enc.private, '/k/plain': plain.private };
  const asked = [];
  const handler = createAuthHandler({
    resolved,
    order: [{ type: 'key', path: '/k/enc' }, { type: 'key', path: '/k/plain' }, { type: 'password' }],
    readFile: (p) => Buffer.from(files[p]),
    secretStore: memoryVault(),
    askSecret: async (req) => { asked.push(req); return { value: 'segredo', remember: false }; },
  });
  // Servidor recusa a chave cifrada e aceita a outra.
  const res = await driveHandler(handler, (n) => n.type === 'publickey' && n.keyPath === '/k/plain');
  assert.equal(res.ok, true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].kind, 'passphrase');
  assert.equal(asked[0].keyPath, '/k/enc');
  assert.equal(res.tried[0].passphrase, 'segredo');
});

test('agente vem antes das chaves', async () => {
  const handler = createAuthHandler({
    resolved,
    order: [{ type: 'agent', agent: '/tmp/a.sock' }, { type: 'password' }],
    secretStore: memoryVault(),
    askSecret: async () => null,
  });
  const res = await driveHandler(handler, (n) => n.type === 'agent');
  assert.equal(res.tried[0].agent, '/tmp/a.sock');
  assert.equal(res.tried[0].username, 'deploy');
});

test('senha pulada quando o servidor não aceita password nem keyboard-interactive', async () => {
  let asked = 0;
  const handler = createAuthHandler({
    resolved, order: [{ type: 'password' }], secretStore: memoryVault(),
    askSecret: async () => { asked++; return { value: 'x' }; },
  });
  const res = await new Promise((resolve) => {
    handler(['publickey'], false, (next) => resolve(next));
  });
  assert.equal(res, false);
  assert.equal(asked, 0);
});

// keyboard-interactive: o servidor manda rodadas de prompts; o handler responde por finish().
function kiRound(attempt, prompts, { name = '', instructions = '' } = {}) {
  return new Promise((resolve) => attempt.prompt(name, instructions, '', prompts, resolve));
}
function nextFrom(handler, methodsLeft) {
  return new Promise((resolve) => handler(methodsLeft, false, resolve));
}
const KI_ONLY = ['keyboard-interactive'];

test('keyboard-interactive: 1 prompt de senha (echo=false) usa a senha do cofre sem perguntar', async () => {
  const vault = memoryVault({ 'ssh.deploy@h:22': 'salva' });
  let asked = 0;
  const handler = createAuthHandler({
    resolved, order: [{ type: 'password' }], secretStore: vault,
    askSecret: async () => { asked++; return null; },
  });
  const att = await nextFrom(handler, KI_ONLY);
  assert.equal(att.type, 'keyboard-interactive');
  assert.deepEqual(await kiRound(att, [{ prompt: 'Password: ', echo: false }]), ['salva']);
  assert.equal(asked, 0);
});

test('keyboard-interactive com 2FA: cada prompt é perguntado ao usuário (sem "Lembrar"); a senha não vai como OTP', async () => {
  const vault = memoryVault({ 'ssh.deploy@h:22': 'salva' });
  const asked = [];
  const answers = { 'Password: ': 'pw-digitada', 'Verification code: ': '123456' };
  const handler = createAuthHandler({
    resolved, order: [{ type: 'password' }], secretStore: vault,
    askSecret: async (req) => { asked.push(req); return { value: answers[req.title], remember: true }; },
  });
  const att = await nextFrom(handler, KI_ONLY);
  const res = await kiRound(att, [{ prompt: 'Password: ', echo: false }, { prompt: 'Verification code: ', echo: false }], { instructions: '2FA' });
  assert.deepEqual(res, ['pw-digitada', '123456']);
  assert.equal(asked.length, 2);
  for (const r of asked) {
    assert.equal(r.kind, 'keyboard-interactive');
    assert.equal(r.canRemember, false);
  }
  assert.deepEqual(asked.map((r) => r.title), ['Password: ', 'Verification code: ']);
  // Prompt único que não é senha (OTP na 2ª rodada) também é perguntado.
  const otp = await kiRound(att, [{ prompt: 'Verification code: ', echo: false }]);
  assert.deepEqual(otp, ['123456']);
  assert.equal(asked.length, 3);
  handler.onReady();
  assert.equal(vault.get('ssh.deploy@h:22'), 'salva', '"Lembrar" não grava respostas de keyboard-interactive');
});

test('keyboard-interactive: falha num fluxo com OTP não apaga a senha do cofre; falha só com a senha apaga', async () => {
  const vault = memoryVault({ 'ssh.deploy@h:22': 'salva' });
  const asked = [];
  const handler = createAuthHandler({
    resolved, order: [{ type: 'password' }], secretStore: vault,
    askSecret: async (req) => { asked.push(req); return { value: req.kind === 'password' ? 'nova' : '000000', remember: false }; },
  });
  // Rodada 1: senha (do cofre); rodada 2: OTP errado → servidor recusa.
  let att = await nextFrom(handler, KI_ONLY);
  assert.deepEqual(await kiRound(att, [{ prompt: 'Password:', echo: false }]), ['salva']);
  assert.deepEqual(await kiRound(att, [{ prompt: 'Verification code:', echo: false }]), ['000000']);
  att = await nextFrom(handler, KI_ONLY);
  assert.equal(vault.get('ssh.deploy@h:22'), 'salva', 'senha do cofre mantida');
  // Nova tentativa: a senha do cofre continua valendo; agora só a senha e o servidor recusa.
  assert.deepEqual(await kiRound(att, [{ prompt: 'Password:', echo: false }]), ['salva']);
  att = await nextFrom(handler, KI_ONLY);
  assert.equal(vault.get('ssh.deploy@h:22'), null, 'senha recusada sozinha é apagada');
  assert.deepEqual(await kiRound(att, [{ prompt: 'Password:', echo: false }]), ['nova']);
  assert.equal(asked.filter((r) => r.kind === 'password').length, 1);
});

test('keyboard-interactive: cancelar um prompt encerra com cancelled', async () => {
  const handler = createAuthHandler({
    resolved, order: [{ type: 'password' }], secretStore: memoryVault(),
    askSecret: async () => null,
  });
  const att = await nextFrom(handler, KI_ONLY);
  assert.deepEqual(await kiRound(att, [{ prompt: 'Token:', echo: true }]), []);
  assert.equal(handler.cancelled(), true);
  assert.equal(await nextFrom(handler, KI_ONLY), false);
});
