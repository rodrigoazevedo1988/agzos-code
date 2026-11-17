const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const MESSAGES = require('./fixtures/ts-errors/messages.json');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/mods/format-ts-error.js')).href);

const partsOf = (block) => block.parts.map((p) => [p.type, p.text]);

test('mensagem simples: trechos entre aspas viram tipos', async () => {
  const { formatTsMessage } = await load();
  const { blocks } = formatTsMessage(MESSAGES.simple);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].indent, 0);
  assert.deepEqual(partsOf(blocks[0]), [
    ['text', 'Type '], ['type', 'string'], ['text', ' is not assignable to type '], ['type', 'number'], ['text', '.'],
  ]);
});

test('cadeia de mensagens mantém o nível de indentação', async () => {
  const { formatTsMessage } = await load();
  const { blocks } = formatTsMessage(MESSAGES.chain);
  assert.deepEqual(blocks.map((b) => b.indent), [0, 1]);
  assert.ok(blocks[1].parts.some((p) => p.type === 'type' && p.text === 'age'));
});

test('tipos longos são quebrados e indentados', async () => {
  const { formatTsMessage } = await load();
  const { blocks } = formatTsMessage(MESSAGES.long);
  const big = blocks[0].parts.find((p) => p.type === 'type' && p.multiline);
  assert.ok(big, 'tipo longo deveria ser multiline');
  assert.equal(big.text, [
    '{',
    '  id: number;',
    '  title: string;',
    '  done: boolean;',
    '  tags: string[];',
    '  owner: {',
    '    name: string;',
    '    email: string;',
    '  };',
    '}',
  ].join('\n'));
  // Tipos curtos continuam inline.
  assert.ok(blocks[0].parts.some((p) => p.type === 'type' && p.text === 'Task' && !p.multiline));
});

test('prettyType mantém strings literais intactas', async () => {
  const { prettyType } = await load();
  assert.equal(prettyType('{ a: "x; y"; b: \'{\'; }', { minLength: 0 }), '{\n  a: "x; y";\n  b: \'{\';\n}');
  assert.equal(prettyType('{}', { minLength: 0 }), '{}');
  assert.equal(prettyType('string', { minLength: 0 }), 'string');
});

test('literais com aspas duplas e mensagens sem tipos', async () => {
  const { formatTsMessage } = await load();
  assert.deepEqual(partsOf(formatTsMessage(MESSAGES.literal).blocks[0])[1], ['type', '"a" | "b"']);
  assert.deepEqual(partsOf(formatTsMessage(MESSAGES.noTypes).blocks[0]), [['text', 'Cannot find name '], ['type', 'foo'], ['text', '.']]);
  assert.deepEqual(formatTsMessage('').blocks, []);
});

test('código do erro com link para a documentação', async () => {
  const { tsErrorCode } = await load();
  assert.deepEqual(tsErrorCode('2322'), { label: 'TS2322', url: 'https://typescript.tv/errors/#ts2322' });
  assert.deepEqual(tsErrorCode(7006), { label: 'TS7006', url: 'https://typescript.tv/errors/#ts7006' });
  assert.deepEqual(tsErrorCode({ value: '1005' }), { label: 'TS1005', url: 'https://typescript.tv/errors/#ts1005' });
  assert.equal(tsErrorCode('abc'), null);
  assert.equal(tsErrorCode(undefined), null);
});

test('markdown do hover: link, tipos em código e blocos para tipos longos', async () => {
  const { tsErrorMarkdown } = await load();
  const simple = tsErrorMarkdown(MESSAGES.simple, '2322');
  assert.match(simple, /\[TS2322\]\(https:\/\/typescript\.tv\/errors\/#ts2322\)/);
  assert.match(simple, /Type `string` is not assignable to type `number`\./);
  const long = tsErrorMarkdown(MESSAGES.long, '2345');
  assert.match(long, /```typescript\n\{\n {2}id: number;/);
  // Texto comum tem caracteres de markdown escapados.
  assert.match(tsErrorMarkdown("Cannot find name '*x*' [y].", null), /\\\[y\\\]/);
});
