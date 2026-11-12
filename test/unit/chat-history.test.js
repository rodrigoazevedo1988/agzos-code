const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { register } = require('../../src/main/ipc/chat-history');

test('histórico por workspace é limitado e salva escritas na ordem', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agzos-chat-'));
  try {
    const handlers = {};
    register({ handle: (name, handler) => { handlers[name] = handler; } }, { app: { getPath: () => dir } });
    const load = (root) => handlers['chat:history:load'](null, root);
    const save = (root, messages) => handlers['chat:history:save'](null, root, messages);
    const messages = Array.from({ length: 205 }, (_, i) => ({ role: 'user', content: String(i) }));
    await Promise.all([save('/a', [{ role: 'user', content: 'antiga' }]), save('/a', messages)]);
    const loaded = await load('/a');
    assert.equal(loaded.length, 200);
    assert.equal(loaded[0].content, '5');
    assert.deepEqual(await load('/b'), []);
    assert.deepEqual(await load(null), []);
    assert.equal((await fs.readdir(path.join(dir, 'chats'))).length, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
