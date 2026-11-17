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

test('1.1.0: fitImageSize limita o maior lado a 1568 sem ampliar', async () => {
  const { fitImageSize } = await load();
  assert.deepEqual(fitImageSize(3136, 1000), { width: 1568, height: 500, scaled: true });
  assert.deepEqual(fitImageSize(800, 2000), { width: 627, height: 1568, scaled: true });
  assert.deepEqual(fitImageSize(100, 50), { width: 100, height: 50, scaled: false });
});

test('1.1.0: resolveSkill escolhe o modo salvo, senão Agente com pasta / Chat sem pasta', async () => {
  const { resolveSkill, FALLBACK_SKILLS, skillLabel } = await load();
  const skills = [...FALLBACK_SKILLS, { id: 'plan', label: 'Plan', kind: 'agent' }];
  assert.equal(resolveSkill(skills, 'plan', true).id, 'plan');
  assert.equal(resolveSkill(skills, null, true).id, 'agent');
  assert.equal(resolveSkill(skills, null, false).id, 'chat');
  assert.equal(resolveSkill(skills, 'sumiu', true).id, 'agent');
  assert.equal(resolveSkill([], null, false).id, 'chat');
  assert.equal(skillLabel(skills, 'plan'), 'Plan');
});

test('1.1.0: user_steer entra no turno e persiste no marcador', async () => {
  const { createAgentTurn, applyAgentEvent, encodeAgentContent, decodeAgentContent, agentTurnText } = await load();
  const turn = createAgentTurn('edit', 'plan');
  applyAgentEvent(turn, { type: 'text', delta: 'Antes.' });
  assert.equal(applyAgentEvent(turn, { type: 'user_steer', id: 's1', content: 'mude X' }).kind, 'steer');
  applyAgentEvent(turn, { type: 'text', delta: 'Depois.' });
  assert.deepEqual(turn.segments.map((s) => s.t), ['text', 'steer', 'text']);
  assert.match(agentTurnText(turn), /durante a execução:_ mude X/);
  const decoded = decodeAgentContent(encodeAgentContent(turn)).turn;
  assert.equal(decoded.skill, 'plan');
  assert.deepEqual(decoded.segments[1], { t: 'steer', text: 'mude X' });
});

test('1.1.0: payloadMessage leva só refs dos anexos', async () => {
  const { payloadMessage } = await load();
  const msg = { role: 'user', content: 'veja', attachments: [{ id: 'a'.repeat(32), name: 'x.png', kind: 'image', thumb: 'data:…', size: 9 }] };
  assert.deepEqual(payloadMessage(msg), { role: 'user', content: 'veja', attachments: [{ id: 'a'.repeat(32), name: 'x.png', kind: 'image' }] });
  assert.deepEqual(payloadMessage({ role: 'assistant', content: 'oi' }), { role: 'assistant', content: 'oi' });
});

/* ------------------------------------------------- compactar conversa (1.2.0) */

test('estimateTokens: chars/4 com marcador do agente fora e anexos contados', async () => {
  const { estimateTokens, encodeAgentContent, createAgentTurn, applyAgentEvent } = await load();
  assert.equal(estimateTokens([]), 0);
  assert.equal(estimateTokens([{ role: 'user', content: 'a'.repeat(400) }]), 100);
  const turn = createAgentTurn('edit');
  applyAgentEvent(turn, { type: 'text', delta: 'b'.repeat(40) });
  applyAgentEvent(turn, { type: 'tool_start', callId: 'c', tool: 'write_file', input: { path: 'a.js', content: 'x'.repeat(5000) } });
  const agent = estimateTokens([{ role: 'assistant', content: encodeAgentContent(turn) }]);
  assert.ok(agent < 200, `marcador JSON não conta (${agent})`);
  const withAtts = estimateTokens([{ role: 'user', content: '', attachments: [
    { id: 'a', kind: 'text', size: 8000 }, { id: 'b', kind: 'image', size: 999999 }, { id: 'c', kind: 'pdf', size: 40000 },
  ] }]);
  assert.equal(withAtts, 2000 + 1000 + 2500);
});

test('modelMessages: sem resumo vai tudo; com resumo, só o último resumo + posteriores', async () => {
  const { modelMessages, SUMMARY_PREFIX } = await load();
  const old = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
  assert.deepEqual(modelMessages(old), old);
  const conv = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'assistant', kind: 'summary', content: 'R1', compactedCount: 2 },
    { role: 'user', content: 'c' },
    { role: 'assistant', content: 'd' },
    { role: 'assistant', kind: 'summary', content: 'R2', compactedCount: 3 },
    { role: 'user', content: 'e', attachments: [{ id: 'x', kind: 'text', name: 'n', size: 1 }] },
  ];
  const out = modelMessages(conv);
  assert.equal(out.length, 2);
  assert.equal(out[0].role, 'user');
  assert.ok(out[0].content.startsWith(SUMMARY_PREFIX));
  assert.ok(out[0].content.endsWith('R2'));
  assert.equal(out[0].kind, undefined);
  assert.equal(out[1], conv[6]);
  assert.ok(!out.some((m) => m.content === 'c' || m.content === 'a'));
});

test('compactable / summaryMessage / isCompacted', async () => {
  const { compactableMessages, makeSummaryMessage, compactedBefore } = await load();
  const conv = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'assistant', kind: 'summary', content: 'R', compactedCount: 2 },
    { role: 'user', content: 'c' },
  ];
  assert.equal(compactableMessages(conv).length, 2, 'resumo anterior + c');
  assert.equal(compactableMessages(conv.slice(0, 2)).length, 2);
  assert.equal(compactableMessages(conv.slice(0, 3)).length, 1);
  assert.deepEqual(makeSummaryMessage('  R  ', 4, 123), { role: 'assistant', kind: 'summary', content: 'R', compactedCount: 4, createdAt: 123 });
  assert.equal(compactedBefore(conv), 2);
  assert.equal(compactedBefore(conv.slice(0, 2)), 0);
});

test('applyAgentEvent compacted: selo no turno, preservado ao salvar e fora do texto', async () => {
  const { createAgentTurn, applyAgentEvent, encodeAgentContent, decodeAgentContent, agentTurnText } = await load();
  const turn = createAgentTurn('edit');
  applyAgentEvent(turn, { type: 'text', delta: 'Lendo.' });
  assert.deepEqual(applyAgentEvent(turn, { type: 'compacted', removedChars: 12000 }), { kind: 'compacted' });
  applyAgentEvent(turn, { type: 'compacted', removedChars: 'x' });
  assert.deepEqual(turn.segments.slice(1), [{ t: 'compacted', removedChars: 12000 }, { t: 'compacted', removedChars: 0 }]);
  assert.equal(agentTurnText(turn), 'Lendo.');
  const back = decodeAgentContent(encodeAgentContent(turn)).turn;
  assert.deepEqual(back.segments[1], { t: 'compacted', removedChars: 12000 });
});
