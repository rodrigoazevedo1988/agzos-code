const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { register, normalizeHistory, makeTitle } = require('../../src/main/ipc/chat-history');

async function withHandlers(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agzos-chat-'));
  try {
    const handlers = {};
    register({ handle: (name, handler) => { handlers[name] = handler; } }, { app: { getPath: () => dir } });
    await fn({
      dir,
      load: (root) => handlers['chat:history:load'](null, root),
      save: (root, data) => handlers['chat:history:save'](null, root, data),
    });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('histórico por workspace é limitado e salva escritas na ordem', async () => {
  await withHandlers(async ({ dir, load, save }) => {
    const messages = Array.from({ length: 205 }, (_, i) => ({ role: 'user', content: String(i) }));
    const first = { conversations: [{ id: 'c1', title: 'antiga', updatedAt: 1, messages: [{ role: 'user', content: 'antiga' }] }], activeId: 'c1' };
    const second = { conversations: [{ id: 'c1', title: 'nova', updatedAt: 2, messages }], activeId: 'c1' };
    await Promise.all([save('/a', first), save('/a', second)]);
    const loaded = await load('/a');
    assert.equal(loaded.activeId, 'c1');
    assert.equal(loaded.conversations[0].messages.length, 200);
    assert.equal(loaded.conversations[0].messages[0].content, '5');
    assert.deepEqual(await load('/b'), { conversations: [], activeId: null });
    assert.deepEqual(await load(null), { conversations: [], activeId: null });
    assert.equal((await fs.readdir(path.join(dir, 'chats'))).length, 1);
  });
});

test('arquivo no formato antigo (array) vira uma conversa ao carregar', async () => {
  await withHandlers(async ({ dir, load, save }) => {
    await save('/x', { conversations: [], activeId: null });
    const [file] = await fs.readdir(path.join(dir, 'chats'));
    await fs.writeFile(path.join(dir, 'chats', file), JSON.stringify([
      { role: 'user', content: 'Explique   o\n arquivo' }, { role: 'assistant', content: 'ok' }, { role: 'system', content: 'x' },
    ]));
    const loaded = await load('/x');
    assert.equal(loaded.conversations.length, 1);
    assert.equal(loaded.activeId, loaded.conversations[0].id);
    assert.equal(loaded.conversations[0].title, 'Explique o arquivo');
    assert.deepEqual(loaded.conversations[0].messages.map((m) => m.role), ['user', 'assistant']);
  });
});

test('salvar rejeita dados que não são objeto', async () => {
  await withHandlers(async ({ save }) => {
    await assert.rejects(() => save('/a', 'lixo'), TypeError);
  });
});

test('normalizeHistory: limite de 50 conversas, mais recentes primeiro, activeId válido', () => {
  const conversations = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, title: `T${i}`, updatedAt: i + 1, messages: [] }));
  const out = normalizeHistory({ conversations, activeId: 'c2' });
  assert.equal(out.conversations.length, 50);
  assert.equal(out.conversations[0].id, 'c59');
  assert.equal(out.activeId, 'c59', 'activeId descartado cai na mais recente');
  assert.equal(normalizeHistory({ conversations, activeId: 'c40' }).activeId, 'c40');
});

test('normalizeHistory: descarta lixo, ids inválidos/duplicados e campos extras', () => {
  const out = normalizeHistory({
    conversations: [
      null,
      { id: '../../etc', title: '', updatedAt: 'x', messages: [{ role: 'user', content: 'oi', extra: 1 }, { role: 'tool', content: 'n' }] },
      { id: 'a', title: 'A', updatedAt: 5, messages: 'nada' },
      { id: 'a', title: 'dup', updatedAt: 4, messages: [] },
    ],
    activeId: 'a',
  }, 100);
  assert.equal(out.conversations.length, 2);
  const bad = out.conversations.find((c) => c.id !== 'a');
  assert.match(bad.id, /^[\w-]+$/);
  assert.equal(bad.title, 'oi');
  assert.equal(bad.updatedAt, 100);
  assert.deepEqual(bad.messages, [{ role: 'user', content: 'oi' }]);
  assert.deepEqual(out.conversations.find((c) => c.id === 'a').messages, []);
  assert.deepEqual(normalizeHistory(42), { conversations: [], activeId: null });
  assert.deepEqual(normalizeHistory([]), { conversations: [], activeId: null });
});

test('makeTitle: limpa markdown/código e corta em 60 caracteres', () => {
  assert.equal(makeTitle(''), 'Nova conversa');
  assert.equal(makeTitle('```js\nconst a = 1;\n```'), 'Nova conversa');
  assert.equal(makeTitle('**Refatore** `soma`  agora'), 'Refatore soma agora');
  const long = makeTitle('a'.repeat(100));
  assert.equal(long.length, 60);
  assert.ok(long.endsWith('…'));
});
