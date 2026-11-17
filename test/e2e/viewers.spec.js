const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');
const { writeDocx, writeXlsx, writeLargeXlsx, writeOds } = require('./office-fixtures');

const FIX = path.join(__dirname, 'fixtures', 'viewers');

let ctx;

async function makeWorkspace() {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-viewers-')));
  for (const f of fs.readdirSync(FIX)) fs.copyFileSync(path.join(FIX, f), path.join(ws, f));
  fs.writeFileSync(path.join(ws, 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>');
  fs.mkdirSync(path.join(ws, 'docs'));
  fs.writeFileSync(path.join(ws, 'docs', 'README.md'),
    '# Título Agzos\n\nTexto com **negrito**.\n\n- [x] feito\n- [ ] pendente\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![logo](../tiny.png)\n\n```js\nconst x = 1;\n```\n');
  fs.writeFileSync(path.join(ws, 'dados.csv'), 'nome,obs,valor\r\nAna,"x, y",10\r\nBia,"diz ""oi""",20\r\n');
  const rnd = Buffer.alloc(4096);
  for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 7919 + 13) % 256;
  rnd[10] = 0;
  fs.writeFileSync(path.join(ws, 'dados.bin2'), rnd);
  fs.writeFileSync(path.join(ws, 'foto.heic'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]));
  fs.writeFileSync(path.join(ws, 'app.js'), 'console.log(1);\n');
  await writeDocx(path.join(ws, 'relatorio.docx'), fs.readFileSync(path.join(FIX, 'tiny.png')));
  writeXlsx(path.join(ws, 'planilha.xlsx'));
  writeLargeXlsx(path.join(ws, 'grande.xlsx'));
  writeOds(path.join(ws, 'calc.ods'));
  fs.writeFileSync(path.join(ws, 'antigo.doc'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  return ws;
}

test.beforeAll(async () => {
  const ws = await makeWorkspace();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-outside-')));
  fs.writeFileSync(path.join(outside, 'segredo.png'), fs.readFileSync(path.join(FIX, 'tiny.png')));
  const launched = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  launched.cspErrors = [];
  launched.page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) launched.cspErrors.push(m.text());
  });
  await launched.app.evaluate((_e, d) => global.__agzosAllowRoot(d), ws);
  await launched.page.evaluate(async (dir) => {
    const mod = await import('./scripts/file-tree.js');
    await mod.openWorkspace(dir);
  }, ws);
  ctx = { ...launched, ws, outside };
});

test.afterAll(async () => {
  await ctx?.app.close();
  fs.rmSync(ctx.ws, { recursive: true, force: true });
  fs.rmSync(ctx.outside, { recursive: true, force: true });
});

const open = (p) => ctx.page.evaluate((fp) => window.AgzosEditor.openFile(fp), p);

test('png abre em aba de visualização com zoom e rodapé', async () => {
  const { page, ws } = ctx;
  const png = path.join(ws, 'tiny.png');
  await open(png);
  const viewer = page.locator('#viewer-host .viewer-image');
  await expect(viewer).toBeVisible();
  const img = viewer.locator('img');
  await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(32);
  await expect(viewer.locator('.viewer-footer')).toContainText('32 × 24');
  await expect(page.locator('.tab.active .label')).toHaveText('tiny.png');
  const before = await viewer.getAttribute('data-zoom');
  await viewer.locator('[data-action="zoom-in"]').click();
  await expect.poll(() => viewer.getAttribute('data-zoom')).not.toBe(before);
  await viewer.locator('[data-action="zoom-100"]').click();
  await expect(viewer).toHaveAttribute('data-zoom', '1');

  // Ctrl+S numa aba de visualização não escreve nada no arquivo.
  const bytes = fs.readFileSync(png);
  await page.evaluate(() => window.AgzosEditor.saveActive());
  expect(fs.readFileSync(png).equals(bytes)).toBe(true);
});

test('svg abre como <img> (nunca inline) e tem "Abrir como texto"', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'logo.svg'));
  const viewer = page.locator('#viewer-host .viewer-image');
  await expect(viewer).toBeVisible();
  await expect.poll(() => viewer.locator('img').evaluate((el) => el.naturalWidth)).toBe(40);
  expect(await viewer.locator('img').getAttribute('src')).toMatch(/^agzos-file:\/\/local\//);
  expect(await page.locator('#viewer-host svg rect').count()).toBe(0);
  await viewer.locator('[data-action="open-text"]').click();
  await expect(page.locator('#viewer-host')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.monaco?.editor.getModels().some((m) => m.getValue().includes('<rect')))).toBe(true);
});

test('alternar entre aba de texto e aba de imagem', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'app.js'));
  await expect(page.locator('#viewer-host')).toBeHidden();
  await page.locator('.tab', { hasText: 'tiny.png' }).click();
  await expect(page.locator('#viewer-host .viewer-image')).toBeVisible();
  await page.locator('.tab', { hasText: 'app.js' }).click();
  await expect(page.locator('#viewer-host')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.monaco.editor.getModels().some((m) => m.getValue().includes('console.log(1)')))).toBe(true);
});

test('mp4 toca no <video> com duração > 0', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'tiny.mp4'));
  const video = page.locator('#viewer-host video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v) => v.duration), { timeout: 10000 }).toBeGreaterThan(0);
});

test('mp3 abre no <audio>', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'tiny.mp3'));
  const audio = page.locator('#viewer-host audio');
  await expect(audio).toBeAttached();
  await expect.poll(() => audio.evaluate((a) => a.duration), { timeout: 10000 }).toBeGreaterThan(0);
});

test('pdf carrega no visualizador embutido', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'tiny.pdf'));
  const frame = page.locator('#viewer-host .viewer-pdf iframe');
  await expect(frame).toBeVisible();
  await expect(page.locator('#viewer-host .viewer-pdf')).toHaveAttribute('data-loaded', 'true', { timeout: 10000 });
  // O Chromium troca o documento do frame pelo plugin de PDF (embed application/pdf).
  await expect.poll(async () => {
    const f = page.frames().find((fr) => fr.url().includes('tiny.pdf'));
    if (!f) return 'sem-frame';
    return f.evaluate(() => document.querySelector('embed')?.getAttribute('type') || document.contentType);
  }, { timeout: 10000 }).toMatch(/pdf/);
});

test('markdown: pré-visualização ao lado atualiza ao digitar', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'docs', 'README.md'));
  await expect(page.locator('#editor-actions [data-action="md-preview-side"]')).toBeVisible();
  await page.locator('#editor-host .monaco-editor textarea').focus();
  await page.keyboard.press('Control+Shift+V');
  const side = page.locator('#md-preview-side');
  await expect(side).toBeVisible();
  await expect(side.locator('h1')).toHaveText('Título Agzos');
  await expect(side.locator('table td').first()).toHaveText('1');
  await expect(side.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect.poll(() => side.locator('img').evaluate((el) => el.naturalWidth)).toBe(32);
  expect(await side.locator('img').getAttribute('src')).toMatch(/^agzos-file:\/\/local\/.*tiny\.png/);

  await page.locator('#editor-host .monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n## Seção Nova\n');
  await expect(side.locator('h2')).toHaveText('Seção Nova');

  await side.locator('[data-action="close-preview"]').click();
  await expect(side).toBeHidden();
});

test('markdown: pré-visualização na aba atual e voltar ao texto', async () => {
  const { page } = ctx;
  await page.locator('#editor-actions [data-action="md-preview-tab"]').click();
  const viewer = page.locator('#viewer-host .viewer-markdown');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('h2')).toHaveText('Seção Nova');
  await viewer.locator('[data-action="open-text"]').click();
  await expect(page.locator('#viewer-host')).toBeHidden();
});

test('csv vira tabela', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'dados.csv'));
  const table = page.locator('#viewer-host .viewer-sheet table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toContainText(['nome', 'obs', 'valor']);
  await expect(table.locator('tbody tr[data-row]')).toHaveCount(2);
  await expect(table.locator('tbody tr[data-row="0"]')).toContainText('x, y');
  await expect(table.locator('tbody tr[data-row="1"]')).toContainText('diz "oi"');
});

test('arquivo binário desconhecido mostra a tela "Arquivo binário"', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'dados.bin2'));
  const viewer = page.locator('#viewer-host .viewer-fallback[data-kind="binary"]');
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText('Arquivo binário');
  await expect(viewer).toContainText('4,0 KB');
  await expect(viewer.locator('[data-action="open-external"]')).toBeVisible();
  await viewer.locator('[data-action="open-text"]').click();
  await expect(page.locator('#viewer-host')).toBeHidden();
});

test('formato sem pré-visualização (heic) mostra fallback com ações', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'foto.heic'));
  const viewer = page.locator('#viewer-host .viewer-fallback');
  await expect(viewer).toContainText('Formato sem pré-visualização');
  await expect(viewer.locator('[data-action="open-external"]')).toBeVisible();
  await expect(viewer.locator('[data-action="reveal"]')).toBeVisible();
});

test('protocolo agzos-file: 200 dentro do workspace, 403 fora', async () => {
  const { app, ws, outside } = ctx;
  const url = (p) => 'agzos-file://local' + p.split('/').map(encodeURIComponent).join('/');
  const status = (u) => app.evaluate(async ({ net }, target) => (await net.fetch(target)).status, u);
  expect(await status(url(path.join(ws, 'tiny.png')))).toBe(200);
  expect(await status(url(path.join(outside, 'segredo.png')))).toBe(403);
  expect(await status(`agzos-file://local${ws}/../${path.basename(outside)}/segredo.png`)).toBe(403);
});

test('docx renderizado com docx-preview (texto, tabela, imagem, zoom)', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'relatorio.docx'));
  const viewer = page.locator('#viewer-host .viewer-docx');
  await expect(viewer).toBeVisible();
  const body = viewer.locator('.docx-wrapper');
  await expect(body).toContainText('Relatório Agzos', { timeout: 10000 });
  await expect(body).toContainText('Parágrafo de teste');
  await expect(body.locator('table td').nth(2)).toHaveText('Parafuso');
  await expect.poll(() => body.locator('img').first().evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
  expect(await body.locator('img').first().getAttribute('src')).toMatch(/^data:image\/png/);
  const before = await viewer.getAttribute('data-zoom');
  await viewer.locator('[data-action="zoom-in"]').click();
  await expect.poll(() => viewer.getAttribute('data-zoom')).not.toBe(before);
  // Link do documento não navega a janela.
  await body.locator('a', { hasText: 'link externo' }).click();
  expect(page.url()).toMatch(/index\.html$/);
});

test('xlsx com 2 abas: troca de aba e cabeçalho de colunas', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'planilha.xlsx'));
  const viewer = page.locator('#viewer-host .viewer-sheet');
  await expect(viewer).toBeVisible();
  const tabs = viewer.locator('.sheet-tab');
  await expect(tabs).toHaveText(['Vendas', 'Notas']);
  await expect(viewer.locator('thead th')).toContainText(['#', 'A', 'B']);
  await expect(viewer.locator('tbody tr[data-row]')).toHaveCount(3);
  await expect(viewer.locator('tbody tr[data-row="1"]')).toContainText('Café');
  await expect(viewer.locator('tbody tr[data-row="1"]')).toContainText('12.5');
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(viewer.locator('tbody tr[data-row="1"]')).toContainText('segunda aba');
  await expect(viewer.locator('[data-action="open-external"]')).toBeVisible();
});

test('xlsx grande: aviso de células e rolagem virtual', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'grande.xlsx'));
  const viewer = page.locator('#viewer-host .viewer-sheet');
  await expect(viewer.locator('.viewer-warning')).toContainText('60.000 células', { timeout: 10000 });
  const rendered = await viewer.locator('tbody tr[data-row]').count();
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(200);
  await viewer.locator('.viewer-grid').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(viewer.locator('tbody tr[data-row="5999"]')).toBeVisible();
});

test('ods abre pelo SheetJS; doc antigo continua no fallback', async () => {
  const { page, ws } = ctx;
  await open(path.join(ws, 'calc.ods'));
  await expect(page.locator('#viewer-host .viewer-sheet tbody tr[data-row="0"]')).toContainText('ods');
  await open(path.join(ws, 'antigo.doc'));
  await expect(page.locator('#viewer-host .viewer-fallback')).toContainText('Formato sem pré-visualização');
});

test('sem erros de página nem violações de CSP', async () => {
  expect(ctx.errors).toEqual([]);
  expect(ctx.cspErrors).toEqual([]);
});
