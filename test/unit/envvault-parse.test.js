const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseEnv, setEntry, removeEntry } = require('../../src/main/modules/envvault/parse');
const { compareEnv, findExampleFile } = require('../../src/main/modules/envvault/compare');

const get = (text, key) => parseEnv(text).entries.find((e) => e.key === key);

test('parse: chave simples, export e número da linha', () => {
  const { entries } = parseEnv('A=1\n\nexport B=dois\n');
  assert.deepEqual(entries.map((e) => [e.key, e.value, e.line, e.exported, e.quoted]), [
    ['A', '1', 1, false, false],
    ['B', 'dois', 3, true, false],
  ]);
});

test('parse: aspas simples, duplas e crase', () => {
  const text = "S='um # dois'\nD=\"tres # quatro\"\nC=`cinco 'seis'`\n";
  assert.equal(get(text, 'S').value, 'um # dois');
  assert.equal(get(text, 'S').quoted, "'");
  assert.equal(get(text, 'D').value, 'tres # quatro');
  assert.equal(get(text, 'D').quoted, '"');
  assert.equal(get(text, 'C').value, "cinco 'seis'");
  assert.equal(get(text, 'C').quoted, '`');
});

test('parse: aspas duplas interpretam \\n, \\" e \\\\; simples são literais', () => {
  const text = 'D="a\\nb \\"c\\" d\\\\e"\nS=\'a\\nb\'\n';
  assert.equal(get(text, 'D').value, 'a\nb "c" d\\e');
  assert.equal(get(text, 'S').value, 'a\\nb');
});

test('parse: multilinha entre aspas duplas', () => {
  const text = 'K="-----BEGIN-----\nlinha2\n-----END-----"\nDEPOIS=x\n';
  const { entries } = parseEnv(text);
  assert.equal(entries[0].value, '-----BEGIN-----\nlinha2\n-----END-----');
  assert.equal(entries[0].line, 1);
  assert.equal(entries[1].key, 'DEPOIS');
  assert.equal(entries[1].line, 4);
});

test('parse: # sem espaço faz parte do valor; com espaço é comentário', () => {
  assert.equal(get('KEY=a#b\n', 'KEY').value, 'a#b');
  assert.equal(get('KEY=a #c\n', 'KEY').value, 'a');
  assert.equal(get('KEY="x=y#z"\n', 'KEY').value, 'x=y#z');
  assert.equal(get('KEY="x" # comentário\n', 'KEY').value, 'x');
  assert.equal(get('KEY=a=b=c\n', 'KEY').value, 'a=b=c');
});

test('parse: comentários, linhas vazias e lixo são ignorados', () => {
  const { entries } = parseEnv('# comentário\n\n   \nnão é chave\nA=\n  B = 2  \n');
  assert.deepEqual(entries.map((e) => [e.key, e.value]), [['A', ''], ['B', '2']]);
});

test('parse: CRLF detectado e sem \\r no valor', () => {
  const r = parseEnv('A=1\r\nB="x y"\r\n');
  assert.equal(r.eol, '\r\n');
  assert.deepEqual(r.entries.map((e) => e.value), ['1', 'x y']);
  assert.equal(parseEnv('A=1\n').eol, '\n');
});

test('setEntry: altera só a linha da chave (byte a byte no resto)', () => {
  const text = '# topo\r\nA=1\r\nexport B="velho" # nota\r\nC=3';
  const out = setEntry(text, 'B', 'novo');
  assert.equal(out, '# topo\r\nA=1\r\nexport B="novo" # nota\r\nC=3');
  assert.equal(get(out, 'B').value, 'novo');
});

test('setEntry: valor com espaço, # ou aspas ganha aspas duplas e faz round-trip', () => {
  for (const v of ['a b', 'x#y', 'tem "aspas"', "simples'", 'l1\nl2', 'barra\\n']) {
    const out = setEntry('A=1\n', 'A', v);
    assert.equal(get(out, 'A').value, v, `round-trip de ${JSON.stringify(v)}`);
  }
  assert.equal(setEntry('A=1\n', 'A', 'a b'), 'A="a b"\n');
});

test('setEntry: multilinha substitui todas as linhas da entrada', () => {
  const text = 'K="l1\nl2\nl3"\nZ=1\n';
  const out = setEntry(text, 'K', 'simples');
  assert.equal(out, 'K="simples"\nZ=1\n'); // mantém o estilo de aspas
});

test('setEntry: chave nova vai para o fim, respeitando a quebra de linha', () => {
  assert.equal(setEntry('A=1\r\n', 'B', '2'), 'A=1\r\nB=2\r\n');
  assert.equal(setEntry('A=1', 'B', 'x y'), 'A=1\nB="x y"\n');
  assert.equal(setEntry('', 'B', '2'), 'B=2\n');
});

test('setEntry: chave inválida é rejeitada', () => {
  assert.throws(() => setEntry('', 'A B', '1'), /chave/i);
  assert.throws(() => setEntry('', 'A\nB=2', '1'), /chave/i);
});

test('removeEntry: remove a linha (e a continuação multilinha) sem tocar o resto', () => {
  assert.equal(removeEntry('A=1\nB=2\nC=3\n', 'B'), 'A=1\nC=3\n');
  assert.equal(removeEntry('A=1\r\nK="x\r\ny"\r\nC=3', 'K'), 'A=1\r\nC=3');
  assert.equal(removeEntry('A=1\nB=2', 'B'), 'A=1\n');
  assert.equal(removeEntry('A=1\n', 'NAO'), 'A=1\n');
});

test('compareEnv: missing, extra e empty', () => {
  const ex = parseEnv('A=\nB=\nC=\n').entries;
  const env = parseEnv('A=1\nC=\nD=4\n').entries;
  assert.deepEqual(compareEnv(ex, env), { missing: ['B'], extra: ['D'], empty: ['C'] });
});

test('findExampleFile: .env.example > .env.sample > .env.template', () => {
  assert.equal(findExampleFile(['/p/.env', '/p/.env.template', '/p/.env.sample']), '/p/.env.sample');
  assert.equal(findExampleFile(['/p/.env.template', '/p/.env.example']), '/p/.env.example');
  assert.equal(findExampleFile(['/p/.env', '/p/.env.local']), null);
});
