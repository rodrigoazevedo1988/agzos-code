const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');

// Regressão 0.4.0: MonacoEnvironment apontava direto para tsWorker.js/jsonWorker.js
// (módulos AMD) e o worker falhava com "define is not defined".
test('abrir .js/.json/.css não gera erro de worker do Monaco', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  const workerErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') workerErrors.push(m.text()); });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-workers-'));
    const files = { 'a.js': 'const x = 1;\nx.', 'b.json': '{"a": 1,}', 'c.css': 'a { color: red }' };
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), dir);
    for (const n of Object.keys(files)) {
      await page.evaluate((p) => window.AgzosEditor.openFile(p), path.join(dir, n));
      await page.waitForTimeout(300); // deixa o modelo anterior ser trocado antes de clicar
      await page.click('.monaco-editor .view-lines');
      await page.keyboard.type(' ');
    }
    // dá tempo aos workers subirem e validarem
    await page.waitForTimeout(2500);
    // Só erros de worker interessam aqui (troca rápida de modelos pode gerar ruído do Monaco).
    expect(errors.filter((t) => /define is not defined|worker/i.test(t))).toEqual([]);
    expect(workerErrors.filter((t) => /define is not defined|worker/i.test(t))).toEqual([]);
  } finally {
    await app.close();
  }
});
