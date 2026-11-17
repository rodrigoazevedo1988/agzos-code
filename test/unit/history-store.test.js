const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHistoryStore, MAX_FILE_BYTES } = require('../../src/main/modules/history/store');
const { planPrune } = require('../../src/main/modules/history/prune');

const DAY = 24 * 60 * 60 * 1000;
let dir;
let work;
let clock;
let limits;

function store() {
  return createHistoryStore({ dir, getLimits: () => limits, now: () => clock });
}

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-hist-ud-')), 'local-history');
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-hist-ws-')));
  clock = 1_700_000_000_000;
  limits = { maxPerFile: 50, maxDays: 30, maxTotalMB: 300 };
});

afterEach(() => {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

test('record guarda a cópia em <sha1(caminho)>/<timestamp> com index.json', () => {
  const file = path.join(work, 'a.js');
  fs.writeFileSync(file, 'um');
  const s = store();
  const entry = s.record(file, 'salvar');
  assert.equal(entry.origin, 'salvar');
  assert.equal(entry.size, 2);
  const key = crypto.createHash('sha1').update(file).digest('hex');
  const index = JSON.parse(fs.readFileSync(path.join(dir, key, 'index.json'), 'utf8'));
  assert.equal(index.path, file);
  assert.equal(index.entries.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, key, entry.id), 'utf8'), 'um');
});

test('pastas 0700 e arquivos 0600', { skip: process.platform === 'win32' }, () => {
  const file = path.join(work, 'a.js');
  fs.writeFileSync(file, 'x');
  const s = store();
  const entry = s.record(file, 'salvar');
  const key = crypto.createHash('sha1').update(file).digest('hex');
  const mode = (p) => fs.statSync(p).mode & 0o777;
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(path.join(dir, key)), 0o700);
  assert.equal(mode(path.join(dir, key, entry.id)), 0o600);
  assert.equal(mode(path.join(dir, key, 'index.json')), 0o600);
});

test('list devolve as versões da mais nova para a mais antiga; conteúdo igual ao último não duplica', () => {
  const file = path.join(work, 'a.js');
  const s = store();
  for (const text of ['1', '2', '2', '3']) {
    fs.writeFileSync(file, text);
    clock += 1000;
    s.record(file, 'salvar');
  }
  const list = s.list(file);
  assert.deepEqual(list.map((e) => s.read(file, e.id).toString()), ['3', '2', '1']);
  assert.ok(list[0].ts > list[1].ts);
});

test('mesmo milissegundo gera ids distintos', () => {
  const file = path.join(work, 'a.js');
  const s = store();
  fs.writeFileSync(file, 'a'); s.record(file, 'salvar');
  fs.writeFileSync(file, 'b'); s.record(file, 'agente');
  const ids = s.list(file).map((e) => e.id);
  assert.equal(new Set(ids).size, 2);
});

test('arquivo de 0 byte, CRLF e acentos no caminho: restaurado byte a byte', () => {
  const folder = path.join(work, 'ação çé');
  fs.mkdirSync(folder);
  const s = store();
  const cases = [
    ['vazio.txt', Buffer.alloc(0)],
    ['crlf.txt', Buffer.from('linha 1\r\nlinha 2\r\n\r\n')],
    ['ãéíõü.md', Buffer.from('# Título com acentuação: ção\n')],
  ];
  for (const [name, buf] of cases) {
    const file = path.join(folder, name);
    fs.writeFileSync(file, buf);
    const entry = s.record(file, 'salvar');
    assert.ok(entry, name);
    fs.writeFileSync(file, 'mudou');
    assert.ok(s.read(file, entry.id).equals(buf), name);
  }
});

test('ignora binários, arquivos > 1 MB, pastas e inexistentes', () => {
  const s = store();
  const bin = path.join(work, 'img.png');
  fs.writeFileSync(bin, Buffer.from([0x89, 0x50, 0x00, 0x01]));
  const big = path.join(work, 'grande.txt');
  fs.writeFileSync(big, 'a'.repeat(MAX_FILE_BYTES + 1));
  assert.equal(s.record(bin, 'salvar'), null);
  assert.equal(s.record(big, 'salvar'), null);
  assert.equal(s.record(work, 'salvar'), null);
  assert.equal(s.record(path.join(work, 'nao-existe.js'), 'salvar'), null);
  assert.deepEqual(s.list(bin), []);
});

test('origem desconhecida vira "externo"', () => {
  const file = path.join(work, 'a.js');
  fs.writeFileSync(file, 'x');
  assert.equal(store().record(file, 'qualquer').origin, 'externo');
});

test('maxPerFile: mantém só as N mais recentes do arquivo', () => {
  limits.maxPerFile = 3;
  const file = path.join(work, 'a.js');
  const s = store();
  for (let i = 0; i < 6; i++) {
    fs.writeFileSync(file, `v${i}`);
    clock += 1000;
    s.record(file, 'salvar');
  }
  const list = s.list(file);
  assert.deepEqual(list.map((e) => s.read(file, e.id).toString()), ['v5', 'v4', 'v3']);
  const key = crypto.createHash('sha1').update(file).digest('hex');
  assert.equal(fs.readdirSync(path.join(dir, key)).length, 4); // 3 versões + index.json
});

test('maxDays: versões antigas são apagadas no próximo registro', () => {
  const file = path.join(work, 'a.js');
  const s = store();
  fs.writeFileSync(file, 'velho'); s.record(file, 'salvar');
  clock += 31 * DAY;
  fs.writeFileSync(file, 'novo'); s.record(file, 'salvar');
  assert.deepEqual(s.list(file).map((e) => s.read(file, e.id).toString()), ['novo']);
});

test('read recusa id inválido', () => {
  const file = path.join(work, 'a.js');
  fs.writeFileSync(file, 'x');
  const s = store();
  s.record(file, 'salvar');
  assert.throws(() => s.read(file, '../index.json'), /inválid/i);
  assert.throws(() => s.read(file, '1600000000000'), /não encontrada/i);
});

test('clear(path) apaga só o histórico daquele arquivo; clear() apaga tudo', () => {
  const a = path.join(work, 'a.js');
  const b = path.join(work, 'b.js');
  fs.writeFileSync(a, 'a'); fs.writeFileSync(b, 'b');
  const s = store();
  s.record(a, 'salvar'); s.record(b, 'salvar');
  s.clear(a);
  assert.deepEqual(s.list(a), []);
  assert.equal(s.list(b).length, 1);
  s.clear();
  assert.deepEqual(s.list(b), []);
});

test('índice corrompido não derruba: começa de novo', () => {
  const file = path.join(work, 'a.js');
  fs.writeFileSync(file, 'x');
  const s = store();
  s.record(file, 'salvar');
  const key = crypto.createHash('sha1').update(file).digest('hex');
  fs.writeFileSync(path.join(dir, key, 'index.json'), '{oops');
  assert.deepEqual(s.list(file), []);
  fs.writeFileSync(file, 'y');
  assert.ok(s.record(file, 'salvar'));
});

test('record aceita conteúdo explícito (cópia de arquivo remoto)', () => {
  const s = store();
  const remote = 'ssh://host/srv/app/a.js';
  const entry = s.record(remote, 'salvar', { content: Buffer.from('remoto') });
  assert.equal(s.read(remote, entry.id).toString(), 'remoto');
});

test('maxTotalMB: apaga as mais antigas de todos os arquivos', () => {
  limits.maxTotalMB = 1;
  const s = store();
  const half = 'x'.repeat(400 * 1024);
  for (const name of ['a', 'b', 'c']) {
    const file = path.join(work, `${name}.txt`);
    fs.writeFileSync(file, half + name);
    clock += 1000;
    s.record(file, 'salvar');
  }
  assert.deepEqual(s.list(path.join(work, 'a.txt')), []);
  assert.equal(s.list(path.join(work, 'b.txt')).length, 1);
  assert.equal(s.list(path.join(work, 'c.txt')).length, 1);
});

// ------------------------------------------------------------- planPrune puro
test('planPrune: por arquivo, idade e total', () => {
  const now = 100 * DAY;
  const files = [
    { key: 'a', entries: [
      { id: 'a1', ts: now - 40 * DAY, size: 10 },
      { id: 'a2', ts: now - 3 * DAY, size: 10 },
      { id: 'a3', ts: now - 2 * DAY, size: 10 },
      { id: 'a4', ts: now - 1 * DAY, size: 10 },
    ] },
    { key: 'b', entries: [{ id: 'b1', ts: now - 2.5 * DAY, size: 10 }] },
  ];
  const del = planPrune(files, { maxPerFile: 2, maxDays: 30, maxTotalBytes: 25, now });
  const ids = del.map((d) => `${d.key}:${d.id}`).sort();
  // a1 (idade), a2 (por arquivo: ficam a3,a4), depois total 30 > 25 → apaga a mais antiga restante (b1)
  assert.deepEqual(ids, ['a:a1', 'a:a2', 'b:b1']);
});

test('planPrune: nada a apagar dentro dos limites', () => {
  const files = [{ key: 'a', entries: [{ id: '1', ts: 10, size: 1 }] }];
  assert.deepEqual(planPrune(files, { maxPerFile: 50, maxDays: 30, maxTotalBytes: 100, now: 20 }), []);
});
