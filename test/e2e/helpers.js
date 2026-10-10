const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');

function needsNoSandbox() {
  return process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;
}

async function launchApp({ userData, settings } = {}) {
  const dir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-e2e-'));
  if (settings) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  }

  const args = ['.'];
  if (needsNoSandbox()) args.push('--no-sandbox');
  if (process.platform === 'linux') args.push('--password-store=basic');

  const app = await electron.launch({
    args,
    cwd: ROOT,
    env: { ...process.env, AGZOS_USER_DATA: dir, AGZOS_TEST: '1' },
  });

  const errors = [];
  // A splash abre primeiro e fecha sozinha; esperamos pela janela principal.
  const page = await waitForMainWindow(app);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#topbar', { timeout: 15000 });

  return { app, page, userData: dir, errors };
}

async function waitForMainWindow(app, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const w of app.windows()) {
      if (w.url().endsWith('renderer/index.html')) return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('janela principal não apareceu');
}

function readSettings(userData) {
  return JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf-8'));
}

async function completeOnboarding(page) {
  const welcomeBtn = page.locator('.welcome-primary');
  if (await welcomeBtn.isVisible().catch(() => false)) {
    await welcomeBtn.click();
    // welcome.js abre o onboarding com setTimeout(200ms)
    await page.locator('#onboarding-overlay.active').waitFor({ timeout: 5000 });
  }
  for (let i = 0; i < 10; i++) {
    const active = await page.locator('#onboarding-overlay.active').count();
    if (!active) return;
    await page.locator('#onboarding-overlay.active .onb-primary').click();
    await page.waitForTimeout(150);
  }
  throw new Error('onboarding não concluiu em 10 cliques');
}

module.exports = { launchApp, readSettings, completeOnboarding };
