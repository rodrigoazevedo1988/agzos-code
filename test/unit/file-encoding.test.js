const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeBuffer,
  encodeBuffer,
  detectEol,
  normalizeEol,
  encodingLabel,
} = require('../../src/main/lib/file-encoding');

test('UTF-8 simples mantém acentos e LF', () => {
  const r = decodeBuffer(Buffer.from('café ação\nlinha 2\n', 'utf8'));
  assert.equal(r.encoding, 'utf8');
  assert.equal(r.eol, 'LF');
  assert.equal(r.binary, false);
  assert.equal(r.readOnly, false);
  assert.equal(r.text, 'café ação\nlinha 2\n');
});

test('UTF-8 com BOM é reconhecido e o BOM não entra no texto', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('olá\r\n', 'utf8')]);
  const r = decodeBuffer(buf);
  assert.equal(r.encoding, 'utf8');
  assert.equal(r.bom, true);
  assert.equal(r.eol, 'CRLF');
  assert.equal(r.text, 'olá\r\n');
  assert.deepEqual(encodeBuffer(r.text, { encoding: r.encoding, bom: r.bom }), buf);
});

test('UTF-16 LE com BOM e CRLF é editável', () => {
  const text = 'linha 1\r\nlinha 2\r\n';
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const r = decodeBuffer(buf);
  assert.equal(r.encoding, 'utf16le');
  assert.equal(r.bom, true);
  assert.equal(r.eol, 'CRLF');
  assert.equal(r.text, text);
  assert.equal(r.readOnly, false);
});

test('UTF-16 BE com BOM é reconhecido', () => {
  const text = 'ação';
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.from(le);
  be.swap16();
  const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
  const r = decodeBuffer(buf);
  assert.equal(r.encoding, 'utf16be');
  assert.equal(r.bom, true);
  assert.equal(r.text, text);
});

test('UTF-16 LE sem BOM é detectado por heurística', () => {
  const buf = Buffer.from('hello world', 'utf16le');
  const r = decodeBuffer(buf);
  assert.equal(r.encoding, 'utf16le');
  assert.equal(r.text, 'hello world');
  assert.equal(r.readOnly, false);
});

test('Latin-1 não-UTF-8 abre somente leitura, sem U+FFFD', () => {
  const buf = Buffer.from('café ação', 'latin1');
  const r = decodeBuffer(buf);
  assert.equal(r.encoding, 'unknown');
  assert.equal(r.readOnly, true);
  assert.equal(r.binary, false);
  assert.equal(r.text, 'café ação');
  assert.equal(r.text.includes('\uFFFD'), false);
});

test('Latin-1 reaberto como Windows-1252 fica editável', () => {
  const buf = Buffer.from('café ação', 'latin1');
  const r = decodeBuffer(buf, { encoding: 'windows-1252' });
  assert.equal(r.encoding, 'windows-1252');
  assert.equal(r.readOnly, false);
  assert.equal(r.text, 'café ação');
  assert.deepEqual(encodeBuffer(r.text, { encoding: 'windows-1252' }), buf);
});

test('PNG é binário e somente leitura', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
  const r = decodeBuffer(png);
  assert.equal(r.binary, true);
  assert.equal(r.readOnly, true);
  assert.equal(r.encoding, 'binary');
});

test('detectEol reconhece CRLF, LF e CR', () => {
  assert.equal(detectEol('a\r\nb\r\n'), 'CRLF');
  assert.equal(detectEol('a\nb\n'), 'LF');
  assert.equal(detectEol('a\rb\r'), 'CR');
  assert.equal(detectEol(''), 'LF');
});

test('normalizeEol converte sem duplicar CR', () => {
  assert.equal(normalizeEol('a\r\nb\rc\n', 'CRLF'), 'a\r\nb\r\nc\r\n');
  assert.equal(normalizeEol('a\r\nb\rc\n', 'LF'), 'a\nb\nc\n');
  assert.equal(normalizeEol('a\r\nb\rc\n', 'CR'), 'a\rb\rc\r');
});

test('encodeBuffer UTF-8 BOM e UTF-16 BE', () => {
  const utf8 = encodeBuffer('ação', { encoding: 'utf8', bom: true });
  assert.equal(utf8.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.equal(utf8.subarray(3).toString('utf8'), 'ação');

  const be = encodeBuffer('ação', { encoding: 'utf16be' });
  const expected = Buffer.from('ação', 'utf16le');
  expected.swap16();
  assert.deepEqual(be, expected);
});

test('encodingLabel devolve rótulos pt-BR', () => {
  assert.equal(encodingLabel('utf8'), 'UTF-8');
  assert.equal(encodingLabel('binary'), 'Binário');
  assert.equal(encodingLabel('windows-1252'), 'Windows-1252');
});
