// Agzos IA 1.2.0: compactar conversa (/compactar, menu ⋯, paleta, automática antes do pedido).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');
const { startFakeOpenAI } = require('./fake-openai');

const SUMMARY = '## Objetivo\nResumo fake da conversa.';

async function setup({ script = [], aiPanel = {}, reply = SUMMARY, delayMs = 5, aiAgent = {} } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-compact-'));
  const fake = await startFakeOpenAI({ script, reply, delayMs });
  const launched = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true, aiAgent: { mode: 'auto', ...aiAgent }, aiPanel: { visible: true, ...aiPanel } },
  });
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
  const close = async () => { await app.close(); await fake.close().catch(() => {}); };
  return { ...launched, fake, workspace, close };
}

async function ask(page, text) {
  await page.locator('#ai-input').fill(text);
  await page.locator('#ai-input').press('Enter');
}
const idle = (page) => expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'send', { timeout: 20000 });
const completions = (fake) => fake.requests.filter((r) => r.path === '/v1/chat/completions');
const agentBodies = (fake) => completions(fake).filter((r) => Array.isArray(r.body?.tools)).map((r) => r.body);
const summaryBodies = (fake) => completions(fake).filter((r) => !Array.isArray(r.body?.tools)).map((r) => r.body);
const userTexts = (body) => body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));

test('/compactar gera o marcador e o próximo pedido leva só o resumo + a nova mensagem; export inclui tudo', async () => {
  const env = await setup({ script: [{ text: 'Resposta A.' }, { text: 'Resposta B.' }] });
  const { page, fake, app } = env;
  const out = path.join(env.workspace, '..', `agzos-compact-${Date.now()}.md`);
  try {
    await ask(page, 'Pedido A');
    await idle(page);
    await ask(page, '/compactar');
    const marker = page.locator('.ai-compact-marker');
    await expect(marker).toHaveCount(1, { timeout: 15000 });
    await expect(marker).toContainText('Conversa compactada — 2 mensagens resumidas');
    await idle(page);
    // composer não manda "/compactar" como mensagem
    await expect(page.locator('.ai-user')).toHaveCount(1);
    expect(agentBodies(fake)).toHaveLength(1);
    // pedido de resumo: modelo atual, prompt de resumo, conversa inteira
    const sum = summaryBodies(fake).at(-1);
    expect(sum.model).toBe('fake-1');
    expect(sum.messages[0].content).toContain('## Arquivos alterados');
    expect(userTexts(sum)).toContain('Pedido A');
    // expansível: mostra o resumo
    await expect(marker.locator('.ai-compact-body')).toBeHidden();
    await marker.locator('summary').click();
    await expect(marker.locator('.ai-compact-body')).toContainText('Resumo fake da conversa.');
    // mensagens antigas continuam visíveis, esmaecidas
    await expect(page.locator('.ai-thread > .ai-msg.is-compacted')).toHaveCount(2);

    await ask(page, 'Pedido B');
    await idle(page);
    const last = agentBodies(fake).at(-1);
    const users = userTexts(last);
    expect(users).toHaveLength(2);
    expect(users[0]).toContain('Resumo fake da conversa.');
    expect(users[1]).toBe('Pedido B');
    expect(JSON.stringify(last.messages)).not.toContain('Pedido A');
    expect(JSON.stringify(last.messages)).not.toContain('Resposta A.');

    // persiste e o export Markdown tem o resumo e as mensagens antigas
    await app.evaluate((_e, file) => { global.__agzosNextSavePath = file; }, out);
    await page.locator('#ai-more-btn').click();
    await page.locator('.ai-menu-item', { hasText: 'Exportar como Markdown' }).click();
    await expect.poll(() => fs.existsSync(out), { timeout: 10000 }).toBe(true);
    const md = fs.readFileSync(out, 'utf8');
    expect(md).toContain('Pedido A');
    expect(md).toContain('Resposta A.');
    expect(md).toContain('## Conversa compactada — 2 mensagens resumidas');
    expect(md).toContain('Resumo fake da conversa.');
    expect(md).toContain('Pedido B');
    expect(md.indexOf('Resposta A.')).toBeLessThan(md.indexOf('Conversa compactada'));
  } finally { await env.close(); fs.rmSync(out, { force: true }); }
});

test('menu ⋯ e paleta compactam; falha do provedor mostra erro e não perde nada', async () => {
  const env = await setup({ script: [{ text: 'Resposta A.' }, { text: 'Resposta B.' }, { text: 'Resposta C.' }] });
  const { page, fake } = env;
  try {
    // sem mensagens: o item não aparece no menu
    await page.locator('#ai-more-btn').click();
    await expect(page.locator('.ai-menu-item', { hasText: 'Compactar conversa' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await ask(page, 'Pedido A');
    await idle(page);
    await page.locator('#ai-more-btn').click();
    await page.locator('.ai-menu-item', { hasText: 'Compactar conversa' }).click();
    await expect(page.locator('.ai-compact-marker')).toHaveCount(1, { timeout: 15000 });
    await idle(page);

    await ask(page, 'Pedido B');
    await idle(page);
    await page.evaluate(async () => (await import('./scripts/command-palette.js')).showCommandPalette());
    await page.locator('#cmd-input').fill('> Compactar conversa');
    await expect(page.locator('#cmd-list')).toContainText('Agzos IA: Compactar conversa');
    await page.locator('#cmd-input').press('Enter');
    await expect(page.locator('.ai-compact-marker')).toHaveCount(2, { timeout: 15000 });
    // a segunda compactação resume o resumo anterior + o que veio depois
    await expect(page.locator('.ai-compact-marker').last()).toContainText('2 mensagens resumidas');
    const second = summaryBodies(fake).at(-1);
    const users = userTexts(second);
    expect(users[0]).toContain('Resumo fake da conversa.');
    expect(users.join('\n')).not.toContain('Pedido A');
    expect(users).toContain('Pedido B');
    await idle(page);

    // logo depois de compactar não há o que compactar
    await ask(page, '/compactar');
    await expect(page.locator('.toast', { hasText: 'Ainda não há o que compactar' })).toBeVisible();

    // provedor fora do ar → erro claro, nada some
    await ask(page, 'Pedido C');
    await idle(page);
    await fake.close();
    await ask(page, '/compact');
    await expect(page.locator('#ai-error')).toContainText(/Não foi possível resumir/, { timeout: 15000 });
    await expect(page.locator('.ai-compact-marker')).toHaveCount(2);
    await expect(page.locator('.ai-user')).toHaveCount(3);
    await expect(page.locator('.ai-thread > .ai-msg:not(.is-compacted)')).toHaveCount(2);
    await idle(page);
  } finally { await env.close(); }
});

test('compactação automática com limite baixo dispara antes de enviar', async () => {
  const env = await setup({
    aiPanel: { autoCompact: true, compactThresholdTokens: 8000 },
    script: [{ text: 'Recebi o texto longo.' }, { text: 'Resposta 2.' }],
    // resumo mais lento para dar tempo de ver o aviso
    reply: `${SUMMARY}\n${'Detalhe. '.repeat(40)}`,
  });
  const { page, fake } = env;
  try {
    const long = `Texto longo ${'x'.repeat(34000)}`;
    await page.locator('#ai-input').fill(long);
    await page.locator('#ai-input').press('Enter');
    await idle(page);
    expect(summaryBodies(fake)).toHaveLength(0);
    await ask(page, 'Pedido 2');
    await expect(page.locator('.ai-compacting')).toContainText('Compactando conversa…');
    await expect(page.locator('.ai-compact-marker')).toHaveCount(1, { timeout: 15000 });
    await idle(page);
    await expect(page.locator('.ai-agent-msg')).toHaveCount(2);
    expect(summaryBodies(fake)).toHaveLength(1);
    const last = agentBodies(fake).at(-1);
    const users = userTexts(last);
    expect(users).toHaveLength(2);
    expect(users[0]).toContain('Resumo fake da conversa.');
    expect(users[1]).toBe('Pedido 2');
    expect(JSON.stringify(last.messages)).not.toContain('x'.repeat(1000));
    // ordem na conversa: antigas, marcador, nova mensagem
    const order = await page.locator('.ai-thread > *').evaluateAll((els) => els.map((e) => (e.classList.contains('ai-compact-marker') ? 'M' : e.classList.contains('ai-user') ? 'U' : 'A')));
    expect(order).toEqual(['U', 'A', 'M', 'U', 'A']);
  } finally { await env.close(); }
});

test('fila durante a compactação: Enter enfileira, "Enviar agora" não interrompe e a fila anda depois', async () => {
  const env = await setup({
    aiPanel: { autoCompact: true, compactThresholdTokens: 8000 },
    script: [{ text: 'Ok longo.' }, { text: 'Resposta 2.' }, { text: 'Resposta 3.' }],
    reply: `${SUMMARY}\n${'Detalhe. '.repeat(60)}`,
    delayMs: 15,
  });
  const { page, fake } = env;
  try {
    await page.locator('#ai-input').fill(`Longo ${'y'.repeat(34000)}`);
    await page.locator('#ai-input').press('Enter');
    await idle(page);
    await ask(page, 'Pedido 2');
    await expect(page.locator('.ai-compacting')).toBeVisible();
    await expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'stop');
    await ask(page, 'Pedido 3');
    await expect(page.locator('.ai-queue-item')).toHaveCount(1);
    await page.locator('.ai-queue-now').click();
    // continua na fila e a compactação segue
    await expect(page.locator('.ai-queue-item')).toHaveCount(1);
    await expect(page.locator('.ai-compact-marker')).toHaveCount(1, { timeout: 20000 });
    await expect(page.locator('.ai-user')).toHaveCount(3, { timeout: 20000 });
    await idle(page);
    await expect(page.locator('.ai-queue-item')).toHaveCount(0);
    expect(summaryBodies(fake)).toHaveLength(1);
    const bodies = agentBodies(fake);
    expect(userTexts(bodies[1]).at(-1)).toBe('Pedido 2');
    expect(userTexts(bodies[2]).slice(-2)).toEqual(['Pedido 2', 'Pedido 3']);
  } finally { await env.close(); }
});

test('execução longa do agente: saídas antigas compactadas no laço e selo discreto no turno', async () => {
  const read = { toolCalls: [{ name: 'read_file', arguments: { path: 'big.txt' } }] };
  const env = await setup({
    aiPanel: { autoCompact: true, compactThresholdTokens: 8000 },
    script: [...Array(12).fill(read), { text: 'Li tudo.' }],
  });
  const { page, fake } = env;
  try {
    fs.writeFileSync(path.join(env.workspace, 'big.txt'), `cabeçalho\n${'z'.repeat(4000)}\n`);
    await ask(page, 'Leia big.txt várias vezes');
    await idle(page);
    await expect(page.locator('.ag-compacted').first()).toContainText('Contexto compactado');
    await expect(page.locator('.ag-text').last()).toContainText('Li tudo.');
    const last = agentBodies(fake).at(-1).messages;
    const tools = last.filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(12);
    expect(tools[0].content).toMatch(/^\[saída compactada: 1\tcabeçalho… \(\d+ caracteres\)\]$/);
    expect(tools.slice(-10).every((m) => m.content.includes('z'.repeat(100)))).toBe(true);
    // compactação do laço não chama o modelo para resumir
    expect(summaryBodies(fake)).toHaveLength(0);
  } finally { await env.close(); }
});

test('"Continuar" depois do limite de passos compacta antes quando o histórico passou do limite', async () => {
  const listTurn = { toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }] };
  const env = await setup({
    aiAgent: { maxSteps: 25 },
    aiPanel: { autoCompact: true, compactThresholdTokens: 8000 },
    script: [...Array(26).fill(listTurn), { text: 'Terminei o que faltava.' }],
  });
  const { page, fake } = env;
  try {
    await page.locator('#ai-input').fill(`Tarefa longa ${'w'.repeat(34000)}`);
    await page.locator('#ai-input').press('Enter');
    await idle(page);
    await page.locator('.ag-continue').last().click();
    await expect(page.locator('.ai-compact-marker')).toHaveCount(1, { timeout: 15000 });
    await idle(page);
    await expect(page.locator('.ai-msg').last()).toContainText('Terminei o que faltava.');
    expect(summaryBodies(fake)).toHaveLength(1);
    const users = userTexts(agentBodies(fake).at(-1));
    expect(users).toHaveLength(2);
    expect(users[0]).toContain('Resumo fake da conversa.');
    expect(users[1]).toContain('Continue a tarefa de onde parou');
  } finally { await env.close(); }
});

test('Configurações → Agzos IA: compactação automática e limite', async () => {
  const env = await setup();
  const { page } = env;
  try {
    await page.evaluate(async () => (await import('./scripts/settings-modal.js')).openSettingsModal('ai'));
    const auto = page.locator('.setting-item-row[data-key="aiPanel.autoCompact"]');
    await expect(auto).toBeVisible();
    await expect(auto.locator('input[type="checkbox"]')).toBeChecked();
    const limit = page.locator('.setting-item-row[data-key="aiPanel.compactThresholdTokens"] input[type="number"]');
    await expect(limit).toHaveValue('60000');
    await limit.fill('20000');
    await limit.press('Enter');
    await limit.blur();
    await expect.poll(() => page.evaluate(() => window.AgzosState.settings.aiPanel.compactThresholdTokens)).toBe(20000);
  } finally { await env.close(); }
});
