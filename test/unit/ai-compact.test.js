const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateTokens, compactToolOutputs, buildSummaryMessages, SUMMARY_PROMPT, KEEP_TOOL_OUTPUTS,
} = require('../../src/main/ai/compact');
const { toAnthropicMessages } = require('../../src/main/ai/providers/anthropic');
const { toOpenAIMessages } = require('../../src/main/ai/providers/openai-compatible');

test('estimateTokens: chars/4 de texto, partes, tool calls e saídas de ferramenta', () => {
  assert.equal(estimateTokens([]), 0);
  assert.equal(estimateTokens([{ role: 'user', content: 'a'.repeat(400) }]), 100);
  // partes de texto contam; imagem conta um valor fixo
  const parts = estimateTokens([{ role: 'user', content: [{ type: 'text', text: 'b'.repeat(40) }, { type: 'image', data: 'x'.repeat(99999) }] }]);
  assert.ok(parts > 10 && parts < 2000, `imagem não conta os bytes base64 (${parts})`);
  // saída de ferramenta e argumentos de tool call contam
  const withTools = estimateTokens([
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'x'.repeat(80) } }] },
    { role: 'tool', toolCallId: 'c1', content: 'z'.repeat(4000) },
  ]);
  assert.ok(withTools >= 1000 + 20);
  assert.equal(estimateTokens(null), 0);
});

function longRun(n, size = 2000) {
  const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'faça' }];
  for (let i = 0; i < n; i++) {
    messages.push({ role: 'assistant', content: i % 2 ? `passo ${i}` : '', toolCalls: [{ id: `c${i}`, name: 'read_file', input: { path: `f${i}.js` } }] });
    messages.push({ role: 'tool', toolCallId: `c${i}`, name: 'read_file', content: `linha um do ${i}\n${'x'.repeat(size)}`, isError: i === 3 });
  }
  return messages;
}

test('compactToolOutputs: só as saídas antigas (todas menos as últimas 10) viram marcador', () => {
  const messages = longRun(15);
  const before = structuredClone(messages);
  const { messages: out, removedChars } = compactToolOutputs(messages);
  assert.equal(KEEP_TOOL_OUTPUTS, 10);
  assert.equal(out.length, messages.length, 'mesma quantidade e ordem');
  assert.deepEqual(messages, before, 'não muta a entrada');
  const tools = out.filter((m) => m.role === 'tool');
  for (const [i, m] of tools.entries()) {
    if (i < 5) {
      assert.match(m.content, /^\[saída compactada: linha um do \d+… \(\d+ caracteres\)\]$/);
      assert.equal(m.content.includes(`(${before.filter((b) => b.role === 'tool')[i].content.length} caracteres)`), true);
    } else {
      assert.equal(m.content, before.filter((b) => b.role === 'tool')[i].content, 'últimas 10 intactas');
    }
  }
  assert.ok(removedChars > 5 * 1900);
  // pares preservados: ids, nomes, isError e assistentes intactos
  out.forEach((m, i) => {
    assert.equal(m.role, before[i].role);
    if (m.role === 'tool') { assert.equal(m.toolCallId, before[i].toolCallId); assert.equal(m.isError, before[i].isError); }
    else assert.deepEqual(m, before[i]);
  });
  // idempotente: segunda passada não remove mais nada
  assert.equal(compactToolOutputs(out).removedChars, 0);
});

test('compactToolOutputs: até 10 saídas → nada muda; keep configurável', () => {
  const messages = longRun(10);
  const { messages: out, removedChars } = compactToolOutputs(messages);
  assert.equal(removedChars, 0);
  assert.deepEqual(out, messages);
  assert.equal(compactToolOutputs(longRun(4), { keep: 1 }).messages.filter((m) => /^\[saída compactada/.test(m.content)).length, 3);
  // saída curta (marcador não economiza) fica como está
  const short = longRun(12, 0);
  short.forEach((m) => { if (m.role === 'tool') m.content = 'ok'; });
  assert.equal(compactToolOutputs(short).removedChars, 0);
});

test('compactToolOutputs: pares tool_call/tool_result continuam válidos para OpenAI e Anthropic', () => {
  const { messages: out } = compactToolOutputs(longRun(14));
  const openai = toOpenAIMessages(out);
  const callIds = new Set(openai.filter((m) => m.tool_calls).flatMap((m) => m.tool_calls.map((c) => c.id)));
  const resultIds = openai.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  assert.equal(resultIds.length, 14);
  for (const id of resultIds) assert.ok(callIds.has(id));
  openai.forEach((m, i) => { if (m.role === 'tool') assert.ok(openai[i - 1].tool_calls || openai[i - 1].role === 'tool'); });

  const { messages: anth } = toAnthropicMessages(out);
  for (let i = 0; i < anth.length; i++) {
    const m = anth[i];
    if (i) assert.notEqual(m.role, anth[i - 1].role, 'papéis alternam');
    const results = Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : [];
    if (results.length) {
      const prevUses = anth[i - 1].content.filter((b) => b.type === 'tool_use').map((b) => b.id);
      assert.deepEqual(results.map((b) => b.tool_use_id), prevUses);
    }
  }
  assert.ok(anth.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result' && b.is_error)));
});

test('buildSummaryMessages: instruções em pt-BR, conversa e pedido final', () => {
  assert.match(SUMMARY_PROMPT, /Objetivo/);
  assert.match(SUMMARY_PROMPT, /Decisões/);
  assert.match(SUMMARY_PROMPT, /Arquivos alterados/);
  assert.match(SUMMARY_PROMPT, /Estado atual/);
  assert.match(SUMMARY_PROMPT, /Pendências/);
  assert.match(SUMMARY_PROMPT, /erros|comandos/i);
  const out = buildSummaryMessages([
    { role: 'system', content: 'contexto do arquivo' },
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'olá' },
  ]);
  assert.equal(out[0].role, 'system');
  assert.equal(out[0].content, SUMMARY_PROMPT);
  assert.deepEqual(out.slice(1, 3), [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }]);
  assert.equal(out.at(-1).role, 'user');
  assert.match(out.at(-1).content, /Resuma/);
  assert.ok(!out.some((m) => m.content === 'contexto do arquivo'), 'system do renderer não vai');
});
