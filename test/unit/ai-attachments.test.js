const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAttachmentStore, classify } = require('../../src/main/ai/attachments');
const { extractPdfText } = require('../../src/main/ai/pdf-text');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3e1d9b40000000049454e44ae426082', 'hex');
const SAMPLE_PDF = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.pdf'));

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-att-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('extrai texto do PDF de fixture, com limite de páginas', async () => {
  const all = await extractPdfText(SAMPLE_PDF);
  assert.equal(all.totalPages, 2);
  assert.match(all.text, /Pagina um do Agzos/);
  assert.match(all.text, /Pagina dois do Agzos/);
  assert.equal(all.truncated, false);
  const one = await extractPdfText(SAMPLE_PDF, { maxPages: 1 });
  assert.equal(one.truncated, true);
  assert.doesNotMatch(one.text, /dois/);
});

test('classifica imagem, texto, pdf e recusa docx/binário', () => {
  assert.equal(classify('a.png', PNG).kind, 'image');
  assert.equal(classify('x.ts', Buffer.from('const a = 1;')).kind, 'text');
  assert.equal(classify('LEIAME', Buffer.from('texto simples')).kind, 'text');
  assert.equal(classify('doc.pdf', SAMPLE_PDF).kind, 'pdf');
  assert.throws(() => classify('a.docx', Buffer.from('PK\x03\x04')), /ainda não são suportados — veja o backlog/);
  assert.throws(() => classify('a.bin', Buffer.from([0, 1, 2, 3])), /ainda não suportado/);
  assert.throws(() => classify('falsa.png', Buffer.from('não é png')), /não parece uma imagem/);
});

test('save/buildContent: texto vira bloco com nome; imagem vira parte de visão; pdf vira texto', async () => {
  const store = createAttachmentStore({ dir });
  const code = await store.save({ name: 'app.js', bytes: Buffer.from('console.log(1)') });
  const img = await store.save({ name: 'tela.png', bytes: PNG });
  const pdf = await store.save({ name: 'manual.pdf', bytes: SAMPLE_PDF });
  assert.equal(code.kind, 'text');
  assert.equal(img.kind, 'image');
  assert.equal(pdf.kind, 'pdf');
  assert.match(code.id, /^[a-f0-9]{32}$/);
  // não duplica: mesmo conteúdo, mesmo id
  assert.equal((await store.save({ name: 'outro.js', bytes: Buffer.from('console.log(1)') })).id, code.id);

  const textOnly = store.buildContent('Revise', [code, pdf]);
  assert.equal(typeof textOnly, 'string');
  assert.match(textOnly, /Arquivo anexado: app\.js\n```\nconsole\.log\(1\)\n```/);
  assert.match(textOnly, /PDF anexado \(texto extraído\): manual\.pdf/);

  const withImage = store.buildContent('O que é isto?', [img]);
  assert.equal(withImage[0].text, 'O que é isto?');
  assert.deepEqual(withImage[1], { type: 'image', mediaType: 'image/png', data: PNG.toString('base64') });

  // anexo sumido não derruba o envio
  assert.match(store.buildContent('oi', [{ id: 'f'.repeat(32), name: 'x.txt' }]), /indisponível/);
});

test('texto acima de 200 KB é cortado com aviso', async () => {
  const store = createAttachmentStore({ dir });
  const meta = await store.save({ name: 'big.log', bytes: Buffer.alloc(300 * 1024, 'a') });
  assert.equal(meta.truncated, true);
  assert.match(meta.note, /200 KB/);
  assert.equal(store.read(meta.id).data.length, 200 * 1024);
});

test('gc apaga só o que não é referenciado e já passou da carência', async () => {
  let clock = Date.now();
  const store = createAttachmentStore({ dir, now: () => clock });
  const keep = await store.save({ name: 'a.txt', bytes: Buffer.from('a') });
  const drop = await store.save({ name: 'b.txt', bytes: Buffer.from('b') });
  assert.equal(store.gc(new Set([keep.id])), 0); // ainda na carência
  clock += 7 * 60 * 60 * 1000;
  assert.equal(store.gc(new Set([keep.id])), 1);
  assert.ok(fs.existsSync(path.join(dir, keep.id)));
  assert.ok(!fs.existsSync(path.join(dir, drop.id)));
  assert.ok(!fs.existsSync(path.join(dir, `${drop.id}.json`)));
});
