#!/usr/bin/env node
/**
 * Mede a RAM do Agzos Code (soma de app.getAppMetrics().memory.workingSetSize)
 * em repouso e depois de usar os módulos nativos (Vassoura + Cofre .env).
 *
 * Uso: xvfb-run -a node tools/measure-ram.js   → imprime JSON { idleMB, withModulesMB, deltaMB }
 * Requer o app de dev (npm install). Não reprova nada: só mede.
 */
/* global window */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('../test/e2e/helpers');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeWorkspace() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ram-')));
  fs.mkdirSync(path.join(dir, 'src'));
  for (let i = 0; i < 300; i++) {
    fs.writeFileSync(path.join(dir, 'src', `mod${i}.ts`), [
      "import { a, b } from './x';",
      '// comentário',
      `export function f${i}(n: number) {`,
      "  console.log('n', n);",
      '  return a(n);',
      "  console.log('morto');",
      '}',
      '',
    ].join('\n').repeat(20));
  }
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=abc123\nDATABASE_URL=postgres://u:p@h/db\n');
  fs.writeFileSync(path.join(dir, '.env.example'), 'API_KEY=\nDATABASE_URL=\n');
  return dir;
}

async function totalMB(app) {
  const kb = await app.evaluate(({ app: a }) => a.getAppMetrics().reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0));
  return Math.round(kb / 1024);
}

async function measure() {
  const ws = makeWorkspace();
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), ws);
    await page.evaluate(async (d) => { const m = await import('./scripts/file-tree.js'); await m.openWorkspace(d); }, ws);
    await wait(4000);
    const idleMB = await totalMB(app);

    await page.evaluate(() => new Promise((resolve) => {
      const id = `ram-${Date.now()}`;
      const off = window.agzos.broom.onEvent((rid, evt) => { if (rid === id && evt.type === 'done') { off(); resolve(); } });
      window.agzos.broom.scanWorkspace(id);
    }));
    await page.evaluate(() => window.agzos.envVault.list());
    await wait(2000);
    const withModulesMB = await totalMB(app);
    const byType = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, name: m.serviceName || m.name || '', mb: Math.round((m.memory?.workingSetSize || 0) / 1024) })));
    // O worker da Vassoura encerra após 60 s ocioso.
    await wait(65000);
    const afterIdleMB = await totalMB(app);
    return { idleMB, withModulesMB, deltaMB: withModulesMB - idleMB, afterIdleMB, afterIdleDeltaMB: afterIdleMB - idleMB, files: 300, byType };
  } finally {
    await app.close();
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

if (require.main === module) {
  measure().then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { measure };
