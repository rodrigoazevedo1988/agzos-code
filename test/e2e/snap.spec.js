const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const base = { welcomeSeen: true, onboardingCompleted: true };
const CODE = "// Agzos\nconst saudacao = 'olá';\nfunction oi(nome) {\n  return `${saudacao}, ${nome}`;\n}\n";

async function setup({ settings = {} } = {}) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-snap-e2e-')));
  fs.writeFileSync(path.join(workspace, 'app.js'), CODE);
  const launched = await launchApp({ settings: { ...base, ...settings } });
  const { app, page } = launched;
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), workspace);
  await page.evaluate((d) => import('./scripts/file-tree.js').then((m) => m.openWorkspace(d)), workspace);
  await page.evaluate((p) => window.AgzosEditor.openFile(p), path.join(workspace, 'app.js'));
  const close = async () => { await app.close(); fs.rmSync(workspace, { recursive: true, force: true }); };
  return { ...launched, workspace, close };
}

async function runCommand(page, label) {
  await page.keyboard.press('Control+Shift+P');
  await page.locator('#cmd-input').fill(`> ${label}`);
  await expect(page.locator('#cmd-list')).toContainText(label);
  await page.keyboard.press('Enter');
}

function pngSize(buf) {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('Snap da seleção: prévia com marca d\'água, salvar PNG 2x pelo diálogo', async () => {
  const env = await setup();
  const { page, app, workspace } = env;
  const out = path.join(workspace, 'snap.png');
  try {
    // Seleciona as linhas 2–3.
    await page.evaluate(() => import('./scripts/editor.js').then((m) => {
      m.getActiveEditor().setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 20 });
    }));
    await runCommand(page, 'Agzos Snap: Capturar código');
    const dialog = page.locator('.snap-dialog');
    await expect(dialog).toBeVisible();
    const frame = dialog.locator('iframe.snap-preview');
    await expect.poll(() => frame.getAttribute('srcdoc')).toContain('saudacao');
    expect(await frame.getAttribute('sandbox')).toBe('');
    const srcdoc = await frame.getAttribute('srcdoc');
    expect(srcdoc).toContain('Agzos Code');
    expect(srcdoc).toContain('class="ln">2<');
    // Cores do tema Agzos Escuro vindas do colorize (keyword = #D10A11).
    expect(srcdoc).toContain('color:rgb(209, 10, 17)');
    expect(srcdoc).not.toContain('Agzos\n'); // linha 1 fora da seleção
    await dialog.getByLabel('Marca d\'água "Agzos Code"').uncheck();
    await expect.poll(() => frame.getAttribute('srcdoc')).not.toContain('Agzos Code');
    await dialog.getByLabel('Título').fill('<b>meu-app.js</b>');
    await expect.poll(() => frame.getAttribute('srcdoc')).toContain('&lt;b&gt;meu-app.js&lt;/b&gt;');

    await app.evaluate(({ dialog: d }, p) => { d.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, out);
    await dialog.locator('button', { hasText: 'Salvar PNG' }).click();
    await expect.poll(() => fs.existsSync(out), { timeout: 15000 }).toBe(true);
    const size = pngSize(fs.readFileSync(out));
    expect(size.width).toBeGreaterThan(100);
    expect(size.height).toBeGreaterThan(50);
    expect(size.width % 2).toBe(0);
    expect(env.errors).toEqual([]);
  } finally { await env.close(); }
});

test('Snap do arquivo inteiro: copiar imagem para a área de transferência', async () => {
  const env = await setup();
  const { page, app } = env;
  try {
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await runCommand(page, 'Agzos Snap: Capturar código');
    const dialog = page.locator('.snap-dialog');
    const frame = dialog.locator('iframe.snap-preview');
    await expect.poll(() => frame.getAttribute('srcdoc')).toContain('class="ln">5<');
    await dialog.getByLabel('Fundo', { exact: true }).selectOption('transparent');
    await dialog.locator('button', { hasText: 'Copiar imagem' }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().getSize().width), { timeout: 15000 })
      .toBeGreaterThan(100);
  } finally { await env.close(); }
});

test('Snap desabilitado: comando avisa e não abre o diálogo', async () => {
  const env = await setup({ settings: { modules: { snap: { enabled: false } } } });
  const { page } = env;
  try {
    await runCommand(page, 'Agzos Snap: Capturar código');
    await expect(page.locator('#toast-container')).toContainText('desabilitado');
    await expect(page.locator('.snap-dialog')).toHaveCount(0);
  } finally { await env.close(); }
});
