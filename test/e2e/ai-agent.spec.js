const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');
const { startFakeOpenAI } = require('./fake-openai');

const SETTINGS = { welcomeSeen: true, onboardingCompleted: true };

async function setup({ script = [], mode = 'edit', files = {}, fakeOptions = {}, settings = {} } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-agent-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(workspace, name), content);
  const fake = await startFakeOpenAI({ script, delayMs: 5, ...fakeOptions });
  const launched = await launchApp({ settings: { ...SETTINGS, aiAgent: { mode }, ...settings } });
  const { app, page } = launched;
  await app.evaluate((_electron, d) => global.__agzosAllowRoot(d), workspace);
  await page.evaluate(async (dir) => {
    const mod = await import('./scripts/file-tree.js');
    await mod.openWorkspace(dir);
  }, workspace);
  await page.evaluate(async (url) => {
    await window.agzos.ai.saveProfile({ preset: 'custom', label: 'Fake', baseUrl: `${url}/v1`, model: 'fake-1' });
    window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
    window.AgzosAiDock.show();
  }, fake.baseUrl);
  await expect(page.locator('#ai-chat')).toBeVisible();
  await expect(page.locator('.ai-pill-model')).toHaveText('fake-1');
  await expect(page.locator('#ai-skill-btn')).toHaveAttribute('data-skill', 'agent');
  const close = async () => { await app.close(); await fake.close(); };
  return { ...launched, fake, workspace, close };
}

async function ask(page, text = 'Crie hello.txt') {
  await page.locator('#ai-input').fill(text);
  await page.locator('#ai-input').press('Enter');
}
const idle = (page) => expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'send', { timeout: 15000 });
const step = (page, tool) => page.locator(`.ag-step[data-tool="${tool}"]`);

test('agente cria, edita e roda comando com aprovação; desfazer tudo restaura o disco', async () => {
  const env = await setup({
    script: [
      { text: 'Vou criar o arquivo.', toolCalls: [{ name: 'write_file', arguments: { path: 'hello.txt', content: 'linha 1\n' } }] },
      { toolCalls: [{ name: 'edit_file', arguments: { path: 'hello.txt', old_string: 'linha 1', new_string: 'linha 1\nlinha 2' } }] },
      { toolCalls: [{ name: 'run_command', arguments: { command: 'echo agzos-ok' } }] },
      { text: 'Pronto: criei hello.txt.' },
    ],
  });
  const { page, workspace } = env;
  const file = path.join(workspace, 'hello.txt');
  try {
    await ask(page);
    await expect(step(page, 'write_file')).toHaveAttribute('data-status', 'ok');
    await expect(step(page, 'edit_file')).toHaveAttribute('data-status', 'ok');
    await expect(step(page, 'edit_file').locator('.ag-step-meta')).toContainText('+1');

    // Comando pede OK no modo "edit": cartão focado, Enter permite.
    const card = page.locator('.ag-approval');
    await expect(card).toBeVisible();
    await expect(card.locator('.ag-cmd-line')).toContainText('echo agzos-ok');
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await expect(step(page, 'run_command')).toHaveAttribute('data-status', 'ok');
    await expect(step(page, 'run_command').locator('.ag-output')).toContainText('agzos-ok');
    await expect(step(page, 'run_command').locator('.ag-step-meta')).toContainText('exit 0');

    await idle(page);
    await expect(page.locator('.ag-text').last()).toContainText('Pronto: criei hello.txt.');
    await expect(page.locator('.ag-summary .ag-file')).toHaveCount(1);
    await expect(page.locator('.ag-summary .ag-file')).toContainText('hello.txt');
    expect(fs.readFileSync(file, 'utf8')).toBe('linha 1\nlinha 2\n');

    // Arquivo da lista abre no editor.
    await page.locator('.ag-summary .ag-file').click();
    await expect.poll(() => page.evaluate(() => window.AgzosState.activePath)).toBe(file);

    // Histórico guarda um resumo legível.
    const saved = await page.evaluate(async (root) => {
      const history = await window.agzos.chat.loadHistory(root);
      return history.conversations.find((c) => c.id === history.activeId).messages.at(-1).content;
    }, workspace);
    expect(saved).toContain('Ações do agente');
    expect(saved).toContain('Pronto: criei hello.txt.');

    // Desfazer tudo pede confirmação e restaura (o arquivo não existia).
    await page.locator('.ag-undo').click();
    await expect(page.locator('.ag-confirm')).toBeVisible();
    await page.locator('.ag-undo-confirm').click();
    await expect(page.locator('.ag-summary')).toHaveClass(/is-undone/);
    await expect.poll(() => fs.existsSync(file)).toBe(false);
  } finally { await env.close(); }
});

test('modo ask pede OK para editar; negar não cria o arquivo', async () => {
  const env = await setup({
    mode: 'ask',
    script: [
      { toolCalls: [{ name: 'write_file', arguments: { path: 'novo.js', content: 'const x = 1;\n' } }] },
      { text: 'Tudo bem, não criei.' },
    ],
  });
  const { page, workspace } = env;
  try {
    await expect(page.locator('#ai-agent-mode')).toContainText('Perguntar');
    await ask(page, 'Crie novo.js');
    const card = page.locator('.ag-approval');
    await expect(card).toBeVisible();
    await expect(card.locator('.ag-diff-line.is-add')).toContainText('const x = 1;');
    await card.focus();
    await page.keyboard.press('Escape');
    await expect(step(page, 'write_file')).toHaveAttribute('data-status', 'denied');
    await idle(page);
    await expect(page.locator('.ag-text').last()).toContainText('não criei');
    expect(fs.existsSync(path.join(workspace, 'novo.js'))).toBe(false);
  } finally { await env.close(); }
});

test('troca o modo pelo seletor e persiste', async () => {
  const env = await setup({ mode: 'edit' });
  const { page, userData } = env;
  try {
    await page.locator('#ai-agent-mode').click();
    await page.locator('.ai-menu-item', { hasText: 'Automático' }).click();
    await expect(page.locator('#ai-agent-mode')).toContainText('Auto');
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).aiAgent?.mode).toBe('auto');
    // Chat desliga o agente e esconde o seletor de modo.
    await page.locator('#ai-skill-btn').click();
    await page.locator('.ai-menu-item', { hasText: 'Chat' }).click();
    await expect(page.locator('#ai-skill-btn')).toHaveAttribute('data-skill', 'chat');
    await expect(page.locator('#ai-agent-mode')).toBeHidden();
  } finally { await env.close(); }
});

test('editor recarrega arquivo aberto e avisa conflito quando está sujo', async () => {
  const env = await setup({
    files: { 'app.js': 'const a = 1;\n' },
    script: [
      { toolCalls: [{ name: 'edit_file', arguments: { path: 'app.js', old_string: 'const a = 1;', new_string: 'const a = 2;' } }] },
      { text: 'Editei.' },
      { toolCalls: [{ name: 'edit_file', arguments: { path: 'app.js', old_string: 'const a = 2;', new_string: 'const a = 3;' } }] },
      { text: 'Editei de novo.' },
    ],
  });
  const { page, workspace } = env;
  const file = path.join(workspace, 'app.js');
  const editorValue = () => page.evaluate(() => window.monaco.editor.getModels().find((m) => !m.isDisposed() && m.getValue().includes('const a'))?.getValue());
  try {
    await page.evaluate((p) => window.AgzosEditor.openFile(p), file);
    await expect.poll(editorValue).toBe('const a = 1;\n');
    await ask(page, 'Mude a para 2');
    await idle(page);
    await expect.poll(editorValue).toBe('const a = 2;\n');
    expect(await page.evaluate((p) => window.AgzosState.files.get(p).dirty, file)).toBe(false);

    // Suja o editor: a mudança do agente não sobrescreve, aparece o aviso.
    await page.evaluate(() => {
      const model = window.monaco.editor.getModels().find((m) => !m.isDisposed() && m.getValue().includes('const a'));
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: 'const a = 2; // meu\n' }], () => null);
    });
    await ask(page, 'Mude a para 3');
    await idle(page);
    await expect(page.locator('#agent-conflict')).toBeVisible();
    await expect.poll(editorValue).toBe('const a = 2; // meu\n');
    await page.locator('.agent-conflict-reload').click();
    await expect.poll(editorValue).toBe('const a = 3;\n');
    await expect(page.locator('#agent-conflict')).toHaveCount(0);
  } finally { await env.close(); }
});

test('modelo sem ferramentas oferece responder como chat', async () => {
  const env = await setup({ fakeOptions: { toolsStatus: 400, reply: 'Resposta do chat' } });
  const { page } = env;
  try {
    await ask(page, 'Oi');
    await expect(page.locator('.ag-error[data-code="tools_unsupported"]')).toBeVisible();
    await page.locator('.ag-chat-fallback').click();
    await expect(page.locator('.ai-assistant').last()).toContainText('Resposta do chat');
    await expect(page.locator('#ai-skill-btn')).toHaveAttribute('data-skill', 'chat');
  } finally { await env.close(); }
});

test('reabrir a conversa mostra os passos e o resumo do agente', async () => {
  const env = await setup({
    script: [
      { toolCalls: [{ name: 'write_file', arguments: { path: 'nota.md', content: '# Nota\n' } }] },
      { text: 'Criei nota.md.' },
    ],
  });
  const { page, workspace, userData } = env;
  try {
    await ask(page, 'Crie nota.md');
    await idle(page);
    await expect(page.locator('.ag-summary .ag-file')).toContainText('nota.md');
  } finally { await env.close(); }
  const second = await launchApp({ userData });
  try {
    await second.app.evaluate((_electron, d) => global.__agzosAllowRoot(d), workspace);
    await second.page.evaluate(async (dir) => {
      const mod = await import('./scripts/file-tree.js');
      await mod.openWorkspace(dir);
      window.AgzosAiDock.show();
    }, workspace);
    await expect(second.page.locator('.ag-step[data-tool="write_file"]')).toHaveAttribute('data-status', 'ok');
    await expect(second.page.locator('.ag-summary .ag-file')).toContainText('nota.md');
    await expect(second.page.locator('.ag-text')).toContainText('Criei nota.md.');
    await expect(second.page.locator('.ai-agent-msg')).not.toContainText('agzos-agent');
  } finally { await second.app.close(); }
});

test('agente chama clean_code no modo edit sem pedir OK e o arquivo aberto recarrega', async () => {
  const dirty = "import { a } from './x';\n// comentário\nconsole.log(a);\nexport const n = 1;\n";
  const env = await setup({
    mode: 'edit',
    files: { 'app.ts': dirty },
    script: [
      { toolCalls: [{ name: 'clean_code', arguments: { path: 'app.ts' } }] },
      { text: 'Código limpo.' },
    ],
  });
  const { page, workspace } = env;
  const file = path.join(workspace, 'app.ts');
  const editorValue = () => page.evaluate(() => window.monaco.editor.getModels().find((m) => !m.isDisposed() && m.getValue().includes('export const n'))?.getValue());
  try {
    await page.evaluate((p) => window.AgzosEditor.openFile(p), file);
    await expect.poll(editorValue).toBe(dirty);
    await ask(page, 'Limpe o app.ts para produção');
    await expect(step(page, 'clean_code')).toHaveAttribute('data-status', 'ok');
    await expect(page.locator('.ag-approval')).toHaveCount(0);
    await idle(page);
    await expect(step(page, 'clean_code')).toContainText('app.ts');
    expect(fs.readFileSync(file, 'utf8')).toBe('export const n = 1;\n');
    await expect.poll(editorValue).toBe('export const n = 1;\n');
    // O modelo recebeu a ferramenta com o schema (campo parameters dos providers).
    const tool = env.fake.requests.at(-1).body.tools.find((t) => t.function.name === 'clean_code');
    expect(tool.function.parameters.required).toEqual(['path']);
  } finally { await env.close(); }
});
