const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSnippetStore, searchSnippets, LANGUAGES } = require('../../src/main/modules/snippets/store');

const SEED = [
  { id: 'hero-a', name: 'Hero A', category: 'Hero', language: 'html', tags: ['topo'], body: '<section>A</section>' },
  { id: 'cta-a', name: 'CTA A', category: 'CTA', language: 'html', tags: [], body: '<div>CTA</div>' },
];

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-snip-'));
  file = path.join(dir, 'snippets.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const make = (opts = {}) => createSnippetStore({ file, seed: SEED, now: () => 1000, ...opts });

test('store: primeira leitura cria o arquivo com a biblioteca inicial (builtin)', () => {
  const s = make();
  const list = s.list();
  assert.equal(list.length, 2);
  assert.ok(list.every((x) => x.builtin === true && x.createdAt === 1000));
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(disk.version, 1);
  assert.equal(disk.snippets.length, 2);
});

test('store: arquivo gravado com permissão 0600', { skip: process.platform === 'win32' }, () => {
  make().list();
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('store: escrita atômica (tmp + rename), sem sobras de .tmp', () => {
  const calls = [];
  const fsx = {
    ...fs,
    writeFileSync: (p, ...a) => { calls.push(['write', path.basename(p)]); return fs.writeFileSync(p, ...a); },
    renameSync: (a, b) => { calls.push(['rename', path.basename(a), path.basename(b)]); return fs.renameSync(a, b); },
  };
  const s = make({ fs: fsx });
  s.save({ name: 'Novo', category: 'Outros', language: 'html', body: '<p>x</p>' });
  const writes = calls.filter((c) => c[0] === 'write');
  assert.ok(writes.length >= 1);
  assert.ok(writes.every((c) => c[1] !== 'snippets.json'), 'nunca escreve direto no arquivo final');
  assert.ok(calls.some((c) => c[0] === 'rename' && c[2] === 'snippets.json'));
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.tmp')), []);
});

test('store: falha na escrita não corrompe o arquivo anterior', () => {
  const s = make();
  s.list();
  const before = fs.readFileSync(file, 'utf8');
  const broken = make({ fs: { ...fs, renameSync: () => { throw new Error('disco cheio'); } } });
  assert.throws(() => broken.save({ name: 'X', category: 'Y', language: 'html', body: '' }), /disco cheio/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('store: save cria (id novo) e atualiza (mesmo id) com updatedAt', () => {
  let t = 1000;
  const s = make({ now: () => t });
  const created = s.save({ name: ' Meu card ', category: 'Card', language: 'tailwind', body: '<div/>', tags: ['a', '', 3] });
  assert.match(created.id, /^[a-z0-9-]+$/);
  assert.equal(created.name, 'Meu card');
  assert.deepEqual(created.tags, ['a']);
  assert.equal(created.builtin, undefined);
  t = 2000;
  const updated = s.save({ id: created.id, name: 'Meu card 2', category: 'Card', language: 'html', body: '<b/>' });
  assert.equal(updated.createdAt, 1000);
  assert.equal(updated.updatedAt, 2000);
  assert.equal(s.get(created.id).body, '<b/>');
  assert.equal(s.list().length, 3);
});

test('store: editar um builtin mantém builtin e o id', () => {
  const s = make();
  const u = s.save({ id: 'hero-a', name: 'Hero editado', category: 'Hero', language: 'html', body: '<x/>' });
  assert.equal(u.id, 'hero-a');
  assert.equal(u.builtin, true);
});

test('store: validação de nome, linguagem e corpo', () => {
  const s = make();
  assert.throws(() => s.save({ name: '', category: 'X', language: 'html', body: '' }), /nome/i);
  assert.throws(() => s.save({ name: 'a', category: 'X', language: 'php', body: '' }), /linguagem/i);
  assert.throws(() => s.save({ name: 'a', category: 'X', language: 'html', body: 5 }), /corpo/i);
  assert.throws(() => s.save({ name: 'a', category: 'X', language: 'html', body: 'x'.repeat(300 * 1024) }), /grande/i);
  assert.deepEqual(LANGUAGES, ['html', 'jsx', 'css', 'tailwind']);
});

test('store: categoria vazia vira "Outros"', () => {
  const s = make();
  assert.equal(s.save({ name: 'a', category: '  ', language: 'css', body: '' }).category, 'Outros');
});

test('store: remove, duplicate e restoreDefaults', () => {
  const s = make();
  const dup = s.duplicate('hero-a');
  assert.notEqual(dup.id, 'hero-a');
  assert.equal(dup.name, 'Hero A (cópia)');
  assert.equal(dup.builtin, undefined);
  s.save({ id: 'hero-a', name: 'Mudado', category: 'Hero', language: 'html', body: '<z/>' });
  assert.equal(s.remove('cta-a'), true);
  assert.equal(s.remove('nao-existe'), false);
  const r = s.restoreDefaults();
  assert.equal(r.restored, 2);
  assert.equal(s.get('hero-a').body, '<section>A</section>');
  assert.equal(s.get('cta-a').name, 'CTA A');
  assert.ok(s.get(dup.id), 'snippets do usuário ficam');
  assert.throws(() => s.duplicate('nada'), /não encontrado/i);
});

test('store: JSON corrompido vira backup e volta à biblioteca inicial', () => {
  fs.writeFileSync(file, '{ quebrado');
  const s = make();
  assert.equal(s.list().length, 2);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('snippets.json.corrupt-')));
});

test('store: itens inválidos no disco são descartados', () => {
  fs.writeFileSync(file, JSON.stringify({ version: 1, snippets: [
    { id: 'ok', name: 'Ok', category: 'A', language: 'html', body: '' },
    { id: 'ruim', name: '', category: 'A', language: 'html', body: '' },
    'lixo',
  ] }));
  const s = make();
  assert.deepEqual(s.list().map((x) => x.id), ['ok']);
});

test('store: export e import (novos, atualizados e inválidos)', () => {
  const s = make();
  const data = s.exportData();
  assert.equal(data.version, 1);
  assert.equal(data.snippets.length, 2);
  const res = s.importData(JSON.stringify({ snippets: [
    { id: 'hero-a', name: 'Hero importado', category: 'Hero', language: 'html', body: '<i/>' },
    { name: 'Sem id', category: 'Card', language: 'jsx', body: '<Card />' },
    { name: '', language: 'html', body: '' },
  ] }));
  assert.deepEqual(res, { added: 1, updated: 1, skipped: 1 });
  assert.equal(s.get('hero-a').name, 'Hero importado');
  assert.equal(s.list().length, 3);
  assert.throws(() => s.importData('não é json'), /JSON/);
  assert.deepEqual(s.importData([{ name: 'Lista', category: 'X', language: 'css', body: 'a{}' }]).added, 1);
});

test('store: onChange avisa a cada mudança', () => {
  const s = make();
  let n = 0;
  const off = s.onChange(() => { n++; });
  s.save({ name: 'a', category: 'b', language: 'html', body: '' });
  s.remove('cta-a');
  off();
  s.remove('hero-a');
  assert.equal(n, 2);
});

test('searchSnippets: por nome, categoria e tags, sem acento e caixa; todos os termos', () => {
  const list = [
    { id: '1', name: 'Formulário de contato', category: 'Formulário', tags: ['email'], body: '' },
    { id: '2', name: 'Hero com vídeo', category: 'Hero', tags: ['topo'], body: '' },
    { id: '3', name: 'Rodapé simples', category: 'Rodapé', tags: [], body: '' },
  ];
  assert.deepEqual(searchSnippets(list, 'formulario').map((s) => s.id), ['1']);
  assert.deepEqual(searchSnippets(list, 'HERO topo').map((s) => s.id), ['2']);
  assert.deepEqual(searchSnippets(list, 'rodape').map((s) => s.id), ['3']);
  assert.deepEqual(searchSnippets(list, '').map((s) => s.id), ['1', '2', '3']);
  assert.deepEqual(searchSnippets(list, '', 'Hero').map((s) => s.id), ['2']);
  assert.deepEqual(searchSnippets(list, 'nada').length, 0);
});
