const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const base = { welcomeSeen: true, onboardingCompleted: true };
const tmp = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

async function openFolder(app, page, dir) {
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), dir);
  await page.evaluate((d) => import('./scripts/file-tree.js').then((m) => m.openWorkspace(d)), dir);
}

async function openSnippets(page) {
  await page.click('.activity-btn[data-view="modules"]');
  await page.locator('#panel-modules .module-card[data-module="snippets"]').click();
  const view = page.locator('.module-view[data-module="snippets"]');
  await expect(view.locator('.sn-card').first()).toBeVisible();
  return view;
}

/** Abre um arquivo e põe o cursor na linha/coluna (1-based). */
async function openAt(page, file, line, column = 1) {
  await page.evaluate((f) => window.AgzosEditor.openFile(f), file);
  await expect.poll(() => page.evaluate(() => window.AgzosState.activePath)).toBe(file);
  await page.evaluate(([l, c]) => import('./scripts/editor.js').then((m) => {
    const ed = m.getActiveEditor();
    ed.setPosition({ lineNumber: l, column: c });
    ed.focus();
  }), [line, column]);
}

const editorValue = (page) => page.evaluate(() => import('./scripts/editor.js').then((m) => m.getActiveEditor().getModel().getValue()));

test('snippets: card ativo no hub, biblioteca inicial, busca e categoria', async () => {
  const { app, page, errors } = await launchApp({ settings: base });
  try {
    await page.click('.activity-btn[data-view="modules"]');
    const card = page.locator('#panel-modules .module-card[data-module="snippets"]');
    await expect(card).toContainText('Habilitado');
    await expect(card).not.toHaveAttribute('aria-disabled', 'true');
    const view = await openSnippets(page);
    expect(await view.locator('.sn-card').count()).toBeGreaterThanOrEqual(20);

    await view.locator('#snippets-search').fill('perguntas');
    await expect(view.locator('.sn-card')).toHaveCount(1);
    await expect(view.locator('.sn-card')).toHaveAttribute('data-id', 'faq-details');
    await view.locator('#snippets-search').fill('');
    await view.locator('#snippets-category').selectOption('Hero');
    await expect(view.locator('.sn-card')).toHaveCount(3);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('snippets: miniatura em iframe sandbox com CSP renderiza o Tailwind e não executa scripts', async () => {
  const { app, page } = await launchApp({ settings: base });
  try {
    await page.evaluate(() => window.agzos.snippets.save({
      id: 'malicioso', name: 'Malicioso', category: 'Teste', language: 'html',
      body: '<div id="alvo" class="bg-[{{cor_primaria}}] p-4">x</div><img src="x" onerror="parent.__pwned=1;window.__ran=1">'
        + '<script>parent.__pwned=2;window.__ran=2</script><svg><animate onbegin="window.__ran=3" attributeName="x" dur="1s"/></svg>'
        + '<a id="link" href="javascript:parent.__pwned=3">l</a>',
    }));
    const view = await openSnippets(page);
    await view.locator('#snippets-category').selectOption('Teste');
    const frameEl = view.locator('.sn-card[data-id="malicioso"] iframe');
    await expect(frameEl).toHaveAttribute('sandbox', 'allow-scripts');
    const srcdoc = await frameEl.getAttribute('srcdoc');
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).not.toMatch(/onerror|parent\.__pwned=2/);
    const frame = await (await frameEl.elementHandle()).contentFrame();
    // Tailwind embutido gerou a classe com a variável trocada.
    await expect.poll(() => frame.evaluate(() => getComputedStyle(document.getElementById('alvo')).backgroundColor), { timeout: 10000 })
      .toBe('rgb(209, 10, 17)');
    await page.waitForTimeout(300);
    expect(await frame.evaluate(() => typeof window.__ran)).toBe('undefined');
    expect(await frame.evaluate(() => document.getElementById('link')?.getAttribute('href') || null)).toBeNull();
    // Sem allow-same-origin: o iframe não alcança o app.
    expect(await frame.evaluate(() => { try { return typeof parent.agzos; } catch { return 'bloqueado'; } })).toBe('bloqueado');
    expect(await page.evaluate(() => typeof window.__pwned)).toBe('undefined');

    // Segunda barreira: mesmo SEM o DOMPurify, a CSP do srcdoc só roda o script com nonce.
    await page.evaluate(() => import('./scripts/snippets-utils.js').then((u) => {
      const f = document.createElement('iframe');
      f.id = 'csp-probe';
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = u.buildPreviewDoc({
        body: '<script>window.__ran=9</script><img src="x" onerror="window.__ran=8"><div onclick="window.__ran=7" id="d">d</div>',
        tailwind: 'window.__tw=1', nonce: u.makeNonce(), background: '#000',
      });
      document.body.append(f);
    }));
    const probe = await (await page.locator('#csp-probe').elementHandle()).contentFrame();
    await expect.poll(() => probe.evaluate(() => window.__tw)).toBe(1);
    await probe.evaluate(() => document.getElementById('d').click());
    await page.waitForTimeout(300);
    expect(await probe.evaluate(() => typeof window.__ran)).toBe('undefined');
  } finally {
    await app.close();
  }
});

test('snippets: clique insere no cursor com variáveis; .tsx recebe JSX', async () => {
  const dir = tmp('agzos-snip-');
  fs.writeFileSync(path.join(dir, 'index.html'), '<body>\n  \n</body>\n');
  fs.writeFileSync(path.join(dir, 'App.tsx'), 'export const App = () => (\n  \n);\n');
  const { app, page } = await launchApp({ settings: base });
  try {
    await openFolder(app, page, dir);
    await openAt(page, path.join(dir, 'index.html'), 2, 3);
    const view = await openSnippets(page);
    const t0 = Date.now();
    await view.locator('.sn-card[data-id="cta-faixa"] .sn-card-main').click();
    await expect.poll(() => editorValue(page)).toContain('bg-[#D10A11]');
    expect(Date.now() - t0).toBeLessThan(2000);
    const html = await editorValue(page);
    expect(html.startsWith('<body>\n  <section class="bg-[#D10A11] text-white"')).toBe(true);
    expect(html).not.toContain('{{cor_primaria}}');
    // Linhas seguintes herdam a indentação do cursor.
    expect(html).toContain('\n    <div class="mx-auto flex');

    await openAt(page, path.join(dir, 'App.tsx'), 2, 3);
    await view.locator('.sn-card[data-id="form-newsletter"] .sn-card-main').click();
    await expect.poll(() => editorValue(page)).toContain('className=');
    const tsx = await editorValue(page);
    expect(tsx).toContain('htmlFor="news-email"');
    expect(tsx).toContain("style={{ fontFamily: 'Inter, sans-serif' }}");
    expect(tsx).not.toMatch(/\sclass="/);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('snippets: arrastar para o editor insere no ponto de soltura', async () => {
  const dir = tmp('agzos-snip-drag-');
  fs.writeFileSync(path.join(dir, 'a.html'), 'linha1\nlinha2\nlinha3\n');
  const { app, page } = await launchApp({ settings: base });
  try {
    await openFolder(app, page, dir);
    await openAt(page, path.join(dir, 'a.html'), 1, 1);
    const view = await openSnippets(page);
    const target = await page.evaluate(() => import('./scripts/editor.js').then((m) => {
      const ed = m.getActiveEditor();
      const pos = ed.getScrolledVisiblePosition({ lineNumber: 3, column: 1 });
      const box = ed.getDomNode().getBoundingClientRect();
      return { x: box.left + pos.left + 2, y: box.top + pos.top + pos.height / 2 };
    }));
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const card = view.locator('.sn-card[data-id="rodape-minimo"]');
    await card.dispatchEvent('dragstart', { dataTransfer: dt });
    const host = page.locator('#editor-host .monaco-editor .view-lines');
    await host.dispatchEvent('dragover', { dataTransfer: dt, clientX: target.x, clientY: target.y });
    await host.dispatchEvent('drop', { dataTransfer: dt, clientX: target.x, clientY: target.y });
    await expect.poll(() => editorValue(page)).toContain('<footer');
    const lines = (await editorValue(page)).split('\n');
    expect(lines[0]).toBe('linha1');
    expect(lines[1]).toBe('linha2');
    expect(lines[2].startsWith('<footer')).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('snippets: variável trocada nas Configurações vale na inserção', async () => {
  const dir = tmp('agzos-snip-var-');
  fs.writeFileSync(path.join(dir, 'a.html'), '\n');
  const { app, page, userData } = await launchApp({ settings: base });
  try {
    await page.click('#btn-settings');
    await page.locator('.settings-category-item[data-cat="modules"]').click();
    const main = page.locator('#settings-main');
    await expect(main.locator('.settings-subsection-title', { hasText: 'Snippets' })).toBeVisible();
    await expect(main.locator('.setting-item-row[data-key="modules.snippets.enabled"]')).toBeVisible();
    const row = main.locator('.sn-var-row[data-name="cor_primaria"]');
    await row.locator('.sn-var-value').fill('#00AA55');
    await row.locator('.sn-var-value').dispatchEvent('change');
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
      .modules?.snippets?.variables?.find((v) => v.name === 'cor_primaria')?.value).toBe('#00AA55');

    // Nova variável do usuário
    await main.locator('#snippets-var-add').click();
    const fresh = main.locator('.sn-var-row').last();
    await fresh.locator('.sn-var-name').fill('slogan');
    await fresh.locator('.sn-var-value').fill('Feito no Brasil');
    await fresh.locator('.sn-var-value').dispatchEvent('change');
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
      .modules?.snippets?.variables?.some((v) => v.name === 'slogan' && v.value === 'Feito no Brasil')).toBe(true);
    await page.keyboard.press('Escape');

    await openFolder(app, page, dir);
    await openAt(page, path.join(dir, 'a.html'), 1, 1);
    const view = await openSnippets(page);
    await view.locator('.sn-card[data-id="cta-faixa"] .sn-card-main').click();
    await expect.poll(() => editorValue(page)).toContain('bg-[#00AA55]');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('snippets: criar, editar, duplicar, apagar e restaurar originais', async () => {
  const { app, page } = await launchApp({ settings: base });
  try {
    const view = await openSnippets(page);
    const total = await view.locator('.sn-card').count();

    // Criar
    await view.locator('#snippets-new').click();
    const modal = page.locator('#snippet-editor');
    await expect(modal).toBeVisible();
    await modal.locator('#snippet-name').fill('Selo Agzos');
    await modal.locator('#snippet-category').fill('Selos');
    await modal.locator('#snippet-language').selectOption('tailwind');
    await page.evaluate(() => import('./scripts/snippets.js').then((m) => m.getSnippetEditor().setValue('<span class="text-[{{cor_primaria}}]">{{nome_marca}}</span>')));
    // Prévia ao vivo com variáveis trocadas
    const preview = await modal.locator('iframe.sn-preview').contentFrame();
    await expect(preview.locator('span')).toHaveText('Agzos');
    await modal.locator('#snippet-save').click();
    await expect(modal).toBeHidden();
    await expect(view.locator('.sn-card')).toHaveCount(total + 1);
    const card = view.locator('.sn-card', { hasText: 'Selo Agzos' });
    await expect(card).toContainText('Selos');

    // Editar
    await card.locator('.sn-menu-btn').click();
    await page.locator('.sn-menu [data-action="edit"]').click();
    await expect(modal).toBeVisible();
    await expect(modal.locator('#snippet-name')).toHaveValue('Selo Agzos');
    await modal.locator('#snippet-name').fill('Selo editado');
    await modal.locator('#snippet-save').click();
    await expect(view.locator('.sn-card', { hasText: 'Selo editado' })).toHaveCount(1);

    // Duplicar
    await view.locator('.sn-card', { hasText: 'Selo editado' }).locator('.sn-menu-btn').click();
    await page.locator('.sn-menu [data-action="duplicate"]').click();
    await expect(view.locator('.sn-card', { hasText: 'Selo editado (cópia)' })).toHaveCount(1);

    // Apagar (com confirmação)
    await view.locator('.sn-card', { hasText: 'Selo editado (cópia)' }).locator('.sn-menu-btn').click();
    await page.locator('.sn-menu [data-action="delete"]').click();
    await page.locator('.git-dialog-actions button[type="submit"]').click();
    await expect(view.locator('.sn-card', { hasText: 'Selo editado (cópia)' })).toHaveCount(0);

    // Apagar um original e restaurar
    await view.locator('.sn-card[data-id="faq-details"] .sn-menu-btn').click();
    await page.locator('.sn-menu [data-action="delete"]').click();
    await page.locator('.git-dialog-actions button[type="submit"]').click();
    await expect(view.locator('.sn-card[data-id="faq-details"]')).toHaveCount(0);
    await view.locator('#snippets-restore').click();
    await page.locator('.git-dialog-actions button[type="submit"]').click();
    await expect(view.locator('.sn-card[data-id="faq-details"]')).toHaveCount(1);
    await expect(view.locator('.sn-card', { hasText: 'Selo editado' })).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('snippets: "Salvar seleção como snippet" abre o editor com o trecho selecionado', async () => {
  const dir = tmp('agzos-snip-sel-');
  fs.writeFileSync(path.join(dir, 'b.css'), '.a { color: red; }\n.b { color: blue; }\n');
  const { app, page } = await launchApp({ settings: base });
  try {
    await openFolder(app, page, dir);
    await openAt(page, path.join(dir, 'b.css'), 1, 1);
    await page.evaluate(() => import('./scripts/editor.js').then((m) => {
      m.getActiveEditor().setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 20 });
    }));
    await page.evaluate(() => import('./scripts/command-palette.js').then((m) => m.runCommand('snippets.saveSelection')));
    const modal = page.locator('#snippet-editor');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#snippet-language')).toHaveValue('css');
    expect(await page.evaluate(() => import('./scripts/snippets.js').then((m) => m.getSnippetEditor().getValue()))).toBe('.b { color: blue; }');
    await modal.locator('#snippet-name').fill('Cor azul');
    await modal.locator('#snippet-save').click();
    await expect(modal).toBeHidden();
    const list = await page.evaluate(() => window.agzos.snippets.list({ query: 'azul' }));
    expect(list.snippets.map((s) => s.body)).toEqual(['.b { color: blue; }']);
    // Item no menu de contexto do editor
    const hasAction = await page.evaluate(() => import('./scripts/editor.js').then((m) => !!m.getActiveEditor().getAction('agzos-snippets.saveSelection')));
    expect(hasAction).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('snippets: importar JSON pela API atualiza a view', async () => {
  const { app, page } = await launchApp({ settings: base });
  try {
    const view = await openSnippets(page);
    const res = await page.evaluate(() => window.agzos.snippets.import(JSON.stringify([
      { name: 'Importado', category: 'Importados', language: 'css', body: '.x{}' },
    ])));
    expect(res).toEqual({ added: 1, updated: 0, skipped: 0 });
    await expect(view.locator('.sn-card', { hasText: 'Importado' })).toHaveCount(1);
  } finally {
    await app.close();
  }
});
