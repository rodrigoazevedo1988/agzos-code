const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/ai-chat-utils.js')).href);
const key = (k, mods = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...mods });

test('composerKeyAction: sendKey enter', async () => {
  const { composerKeyAction } = await load();
  assert.equal(composerKeyAction(key('Enter'), 'enter'), 'send');
  assert.equal(composerKeyAction(key('Enter', { shiftKey: true }), 'enter'), 'newline');
  assert.equal(composerKeyAction(key('Enter', { ctrlKey: true }), 'enter'), 'send');
  assert.equal(composerKeyAction(key('Enter', { isComposing: true }), 'enter'), null);
  assert.equal(composerKeyAction(key('a'), 'enter'), null);
  assert.equal(composerKeyAction(key('Enter')), 'send', 'padrão é enter');
});

test('composerKeyAction: sendKey ctrlEnter', async () => {
  const { composerKeyAction } = await load();
  assert.equal(composerKeyAction(key('Enter'), 'ctrlEnter'), null);
  assert.equal(composerKeyAction(key('Enter', { shiftKey: true }), 'ctrlEnter'), null);
  assert.equal(composerKeyAction(key('Enter', { ctrlKey: true }), 'ctrlEnter'), 'send');
  assert.equal(composerKeyAction(key('Enter', { metaKey: true }), 'ctrlEnter'), 'send');
});

test('sendHint muda com a tecla de envio', async () => {
  const { sendHint } = await load();
  assert.deepEqual(sendHint('enter')[0].keys, ['Enter']);
  assert.deepEqual(sendHint('ctrlEnter', true)[0].keys, ['⌘', 'Enter']);
  assert.deepEqual(sendHint('ctrlEnter', false)[0].keys, ['Ctrl', 'Enter']);
});

test('makeTitle do renderer segue a mesma regra do main', async () => {
  const { makeTitle } = await load();
  const main = require('../../src/main/ipc/chat-history');
  for (const text of ['', '  oi  ', '**x** `y`', '```\ncode\n``` depois', 'b'.repeat(80)]) {
    assert.equal(makeTitle(text), main.makeTitle(text));
  }
  const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/scripts/ai-chat-utils.js'), 'utf8');
  assert.ok(source.includes('MAX_CONVERSATIONS = 50') && source.includes('MAX_MESSAGES = 200'));
});

test('addConversation coloca no topo, ativa e respeita 50', async () => {
  const { addConversation } = await load();
  let store = { conversations: [], activeId: null };
  for (let i = 0; i < 55; i++) store = addConversation(store, { id: `c${i}`, title: '', updatedAt: i, messages: [] });
  assert.equal(store.conversations.length, 50);
  assert.equal(store.activeId, 'c54');
  assert.equal(store.conversations[0].id, 'c54');
  assert.ok(!store.conversations.some((c) => c.id === 'c0'));
});

test('relativeTime e baseName', async () => {
  const { relativeTime, baseName } = await load();
  const now = Date.UTC(2026, 10, 16, 12);
  assert.equal(relativeTime(now - 10_000, now), 'agora');
  assert.equal(relativeTime(now - 5 * 60_000, now), '5 min');
  assert.equal(relativeTime(now - 3 * 3_600_000, now), '3 h');
  assert.equal(relativeTime(now - 26 * 3_600_000, now), 'ontem');
  assert.equal(relativeTime(now - 3 * 86_400_000, now), '3 dias');
  assert.match(relativeTime(now - 30 * 86_400_000, now), /^\d{2}\/\d{2}$/);
  assert.equal(baseName('/a/b/c.js'), 'c.js');
  assert.equal(baseName('C:\\x\\y.ts'), 'y.ts');
  assert.equal(baseName(''), '');
});
