const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, readSettings } = require('./helpers');

async function openWorkspaceWith(app, page, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-shortcuts-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  await app.evaluate((_electron, d) => global.__agzosAllowRoot(d), dir);
  await page.evaluate(async (d) => {
    const mod = await import('./scripts/file-tree.js');
    await mod.openWorkspace(d);
  }, dir);
  return dir;
}

test('configuração booleana do modal é persistida (editor.minimap)', async () => {
  const { app, page, userData, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await page.click('#btn-settings');
    const row = page.locator('.setting-item-row[data-key="editor.minimap"]');
    await expect(row).toBeVisible();
    const checkbox = row.locator('input.settings-control-checkbox');
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();

    await expect(row).toHaveClass(/modified/);
    await expect.poll(() => readSettings(userData).editor?.minimap).toBe(false);
    expect(await page.evaluate(() => window.AgzosState.settings.editor.minimap)).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Ctrl+W fecha a aba ativa; no terminal não fecha; Ctrl+K Ctrl+W fecha todas', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const dir = await openWorkspaceWith(app, page, { 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' });
    for (const f of ['a.txt', 'b.txt', 'c.txt']) {
      await page.evaluate((p) => window.AgzosEditor.openFile(p), path.join(dir, f));
    }
    await expect(page.locator('#tabs .tab')).toHaveCount(3);

    // Foco no corpo (fora de input/terminal): Ctrl+W fecha a ativa (c.js)
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+w');
    await expect(page.locator('#tabs .tab')).toHaveCount(2);
    await expect(page.locator('#tabs .tab.active')).toContainText('b.txt');

    // Ctrl+W com foco num input (simula terminal/campo de texto) não fecha abas
    await page.evaluate(() => {
      const el = document.createElement('input');
      el.id = 'tmp-focus-input';
      document.body.appendChild(el);
      el.focus();
    });
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(200);
    await expect(page.locator('#tabs .tab')).toHaveCount(2);
    await page.evaluate(() => { const el = document.getElementById('tmp-focus-input'); el.blur(); el.remove(); });

    // Chord Ctrl+K Ctrl+W fecha todas
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+w');
    await expect(page.locator('#tabs .tab')).toHaveCount(0);

    // Com foco no Monaco: Ctrl+W fecha a ativa e o chord é resolvido pelo editor
    for (const f of ['a.txt', 'b.txt']) {
      await page.evaluate((p) => window.AgzosEditor.openFile(p), path.join(dir, f));
    }
    await page.locator('#editor-host .monaco-editor .view-lines').click();
    await page.keyboard.press('Control+w');
    await expect(page.locator('#tabs .tab')).toHaveCount(1);
    await page.locator('#editor-host .monaco-editor .view-lines').click();
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+w');
    await expect(page.locator('#tabs .tab')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
