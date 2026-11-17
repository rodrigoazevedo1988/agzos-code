const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = (m) => import(`../../src/renderer/scripts/viewers/${m}.js`);

test('detectViewer: imagens suportadas', async () => {
  const { detectViewer } = await load('detect');
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'apng']) {
    assert.equal(detectViewer(`/a/b.${ext}`), 'image', ext);
  }
});

test('detectViewer: maiúsculas e .MD', async () => {
  const { detectViewer } = await load('detect');
  assert.equal(detectViewer('/a/FOTO.PNG'), 'image');
  assert.equal(detectViewer('C:\\x\\README.MD'), 'markdown');
  assert.equal(detectViewer('/a/doc.Markdown'), 'markdown');
  assert.equal(detectViewer('/a/Video.MP4'), 'video');
});

test('detectViewer: vídeo, áudio, pdf', async () => {
  const { detectViewer } = await load('detect');
  for (const ext of ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi']) assert.equal(detectViewer(`x.${ext}`), 'video', ext);
  for (const ext of ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus']) assert.equal(detectViewer(`x.${ext}`), 'audio', ext);
  assert.equal(detectViewer('/a/manual.pdf'), 'pdf');
});

test('detectViewer: documentos e planilhas', async () => {
  const { detectViewer } = await load('detect');
  for (const ext of ['docx', 'doc', 'odt', 'rtf']) assert.equal(detectViewer(`x.${ext}`), 'docx', ext);
  for (const ext of ['xlsx', 'xls', 'ods', 'csv', 'tsv']) assert.equal(detectViewer(`x.${ext}`), 'sheet', ext);
});

test('detectViewer: formatos sem pré-visualização vão para external', async () => {
  const { detectViewer } = await load('detect');
  for (const ext of ['heic', 'heif', 'tiff', 'tif', 'psd', 'raw', 'cr2', 'pptx', 'ppt', 'odp', 'zip', 'exe', 'woff2', 'sqlite']) {
    assert.equal(detectViewer(`x.${ext}`), 'external', ext);
  }
});

test('detectViewer: texto, sem extensão e dotfiles', async () => {
  const { detectViewer } = await load('detect');
  assert.equal(detectViewer('/a/app.js'), 'text');
  assert.equal(detectViewer('/a/Makefile'), 'text');
  assert.equal(detectViewer('/a/.gitignore'), 'text');
  assert.equal(detectViewer('/a/.env'), 'text');
  assert.equal(detectViewer('/a/arquivo.desconhecido'), 'text');
  assert.equal(detectViewer('/a.b/semext'), 'text');
  assert.equal(detectViewer(''), 'text');
  assert.equal(detectViewer(null), 'text');
});

test('parseCsv: básico, aspas, vírgula em aspas, aspas escapadas', async () => {
  const { parseCsv } = await load('csv');
  const { rows } = parseCsv('a,b,c\n1,"x, y",3\n"diz ""oi""",,fim');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', '3'], ['diz "oi"', '', 'fim']]);
});

test('parseCsv: CRLF, quebra de linha dentro de aspas, BOM e linha final vazia', async () => {
  const { parseCsv } = await load('csv');
  const { rows } = parseCsv('\uFEFFnome,obs\r\nAna,"linha1\r\nlinha2"\r\nBia,ok\r\n');
  assert.deepEqual(rows, [['nome', 'obs'], ['Ana', 'linha1\r\nlinha2'], ['Bia', 'ok']]);
});

test('parseCsv: detecta ponto e vírgula e tab', async () => {
  const { parseCsv, detectDelimiter } = await load('csv');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('"a;b",c\n1,2'), ',');
  assert.deepEqual(parseCsv('a;b\n1,5;2').rows, [['a', 'b'], ['1,5', '2']]);
  assert.deepEqual(parseCsv('a,b\n1;2', { delimiter: ',' }).rows, [['a', 'b'], ['1;2']]);
});

test('parseCsv: maxRows corta e marca truncated', async () => {
  const { parseCsv } = await load('csv');
  const text = Array.from({ length: 10 }, (_, i) => `${i},x`).join('\n');
  const r = parseCsv(text, { maxRows: 4 });
  assert.equal(r.rows.length, 4);
  assert.equal(r.truncated, true);
  assert.equal(r.totalRows, 10);
  const all = parseCsv(text);
  assert.equal(all.truncated, false);
  assert.equal(all.totalRows, 10);
});

test('toFileUrl gera URL agzos-file codificada (POSIX e Windows)', async () => {
  const { toFileUrl } = await load('paths');
  assert.equal(toFileUrl('/home/u/a b#1.png'), 'agzos-file://local/home/u/a%20b%231.png');
  assert.equal(toFileUrl('C:\\Users\\u\\x.png'), 'agzos-file://local/C%3A/Users/u/x.png');
  assert.equal(toFileUrl('/a/x.png', 123), 'agzos-file://local/a/x.png?v=123');
});

test('toFileUrl usa o host (token da janela) informado', async () => {
  const { toFileUrl } = await load('paths');
  assert.equal(toFileUrl('/a/x.png', null, 'ab12'), 'agzos-file://ab12/a/x.png');
  assert.equal(toFileUrl('/a/x.png', 7, 'ab12'), 'agzos-file://ab12/a/x.png?v=7');
});

test('resolveMarkdownPath resolve caminhos relativos de imagens', async () => {
  const { resolveMarkdownPath } = await load('paths');
  assert.equal(resolveMarkdownPath('/ws/docs/README.md', 'img/a.png'), '/ws/docs/img/a.png');
  assert.equal(resolveMarkdownPath('/ws/docs/README.md', './img/a.png'), '/ws/docs/img/a.png');
  assert.equal(resolveMarkdownPath('/ws/docs/README.md', '../logo.svg'), '/ws/logo.svg');
  assert.equal(resolveMarkdownPath('/ws/docs/README.md', 'img/a%20b.png'), '/ws/docs/img/a b.png');
  assert.equal(resolveMarkdownPath('/ws/docs/README.md', 'img/a.png?raw=1#x'), '/ws/docs/img/a.png');
  assert.equal(resolveMarkdownPath('/ws/docs/README.md', '/assets/x.png', '/ws'), '/ws/assets/x.png');
  assert.equal(resolveMarkdownPath('C:\\ws\\docs\\README.md', 'img/a.png'), 'C:\\ws\\docs\\img\\a.png');
  assert.equal(resolveMarkdownPath('C:\\ws\\docs\\README.md', '..\\b.png'), 'C:\\ws\\b.png');
});

test('resolveMarkdownPath ignora URLs externas, data: e âncoras', async () => {
  const { resolveMarkdownPath } = await load('paths');
  assert.equal(resolveMarkdownPath('/ws/README.md', 'https://x.com/a.png'), null);
  assert.equal(resolveMarkdownPath('/ws/README.md', 'data:image/png;base64,AAAA'), null);
  assert.equal(resolveMarkdownPath('/ws/README.md', '#secao'), null);
  assert.equal(resolveMarkdownPath('/ws/README.md', 'mailto:a@b.c'), null);
  assert.equal(resolveMarkdownPath('/ws/README.md', ''), null);
});

test('formatBytes em pt-BR', async () => {
  const { formatBytes } = await load('format');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(275), '275 B');
  assert.equal(formatBytes(4096), '4,0 KB');
  assert.equal(formatBytes(1536 * 1024), '1,5 MB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3,0 GB');
  assert.equal(formatBytes(undefined), '—');
});

test('formatDuration', async () => {
  const { formatDuration } = await load('format');
  assert.equal(formatDuration(1.2), '0:01');
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(NaN), '—');
});
