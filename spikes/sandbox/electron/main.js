'use strict';
// Harness Electron do spike (perguntas 1, 4 e 5). Rodar com o Electron do projeto:
//   xvfb-run -a /var/www/agzos-code/node_modules/electron/dist/electron --no-sandbox electron/main.js --scenario <s> [--n 1]
// Cenários:
//   bench     esbuild-wasm (browser) no renderer, modo virtual com IO via IPC
//   tw        Tailwind no iframe: v3 Play CDN (com config do projeto) vs v4 @tailwindcss/browser vs CSS pré-gerado (v3 Node)
//   baseline  só a janela host (renderer vazio)
//   iframe    host + N iframes sandbox (srcdoc) com o componente renderizado
//   wcv       host + N WebContentsView com partition própria (sem persistência)
//   wcv-shared host + N WebContentsView na sessão padrão
// Saída: uma linha JSON no stdout prefixada por "RESULT ".
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i < 0 ? d : process.argv[i + 1];
};
const scenario = arg('scenario', 'baseline');
const N = Number(arg('n', 1));
const SPIKE = path.join(__dirname, '..');
const OUT = path.join(SPIKE, 'out-sandbox.html');

function done(obj) {
  process.stdout.write('RESULT ' + JSON.stringify({ scenario, n: N, electron: process.versions.electron, ...obj }) + '\n');
  app.exit(0);
}

// Memória: soma de RSS e PSS (/proc/<pid>/smaps_rollup) de todos os processos do app.
function memory() {
  const procs = app.getAppMetrics().map((m) => {
    let pss = 0;
    let rss = 0;
    try {
      const t = fs.readFileSync(`/proc/${m.pid}/smaps_rollup`, 'utf8');
      pss = Number(/^Pss:\s+(\d+)/m.exec(t)[1]);
      rss = Number(/^Rss:\s+(\d+)/m.exec(t)[1]);
    } catch {}
    return { type: m.type, pid: m.pid, rssMB: +(rss / 1024).toFixed(1), pssMB: +(pss / 1024).toFixed(1) };
  });
  const sum = (k) => +procs.reduce((s, p) => s + p[k], 0).toFixed(1);
  return { processes: procs.length, totalRssMB: sum('rssMB'), totalPssMB: sum('pssMB'), procs };
}

// Documento do sandbox: CSS pré-gerado (v3 Node) + vendor React + bundle do componente.
function sandboxHtml() {
  const css = fs.readFileSync(path.join(SPIKE, 'out-tw3.css'), 'utf8');
  const vendor = fs.readFileSync(path.join(SPIKE, 'out-vendor.js'), 'utf8');
  const comp = fs.readFileSync(path.join(SPIKE, 'out-Dashboard-external.js'), 'utf8');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:">
<style>${css}</style></head><body><div id="root"></div>
<script>${vendor.replace(/<\/script/g, '<\\/script')}</script>
<script>${comp.replace(/<\/script/g, '<\\/script')}</script>
<script>parent.postMessage({type:'agz-sandbox:ready', rendered: !!window.__AGZ_RENDERED__, rows: document.querySelectorAll('tbody tr').length}, '*')</script>
</body></html>`;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function sample() {
  // 3 amostras, 1 s de intervalo, mediana do total PSS.
  const s = [];
  for (let i = 0; i < 3; i++) {
    await settle(1000);
    s.push(memory());
  }
  s.sort((a, b) => a.totalPssMB - b.totalPssMB);
  return s[1];
}

app.whenReady().then(async () => {
  ipcMain.handle('fs:read', (_e, p) => {
    // No app real: validar que p está dentro da raiz do projeto ou da pasta de shims.
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  });
  ipcMain.handle('spike:paths', () => ({ spike: SPIKE }));

  const host = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, nodeIntegration: false },
  });

  if (scenario === 'bench' || scenario === 'tw' || scenario === 'shims') {
    ipcMain.once('spike:result', (_e, r) => done(r));
    await host.loadFile(path.join(__dirname, 'host.html'), { query: { scenario, warmup: arg('warmup', '0') } });
    setTimeout(() => done({ error: 'timeout' }), 120000);
    return;
  }

  await host.loadFile(path.join(__dirname, 'host.html'), { query: { scenario: 'idle' } });
  await settle(2000);
  const before = await sample();

  if (scenario === 'iframe') {
    const html = sandboxHtml();
    const r = await host.webContents.executeJavaScript(`window.mountIframes(${JSON.stringify(html)}, ${N})`);
    const after = await sample();
    done({ readyMsgs: r, before: strip(before), after: strip(after), deltaPssMB: +(after.totalPssMB - before.totalPssMB).toFixed(1), deltaRssMB: +(after.totalRssMB - before.totalRssMB).toFixed(1), procsAfter: after.procs.map((p) => p.type + ':' + p.pssMB) });
    return;
  }

  if (scenario === 'wcv' || scenario === 'wcv-shared') {
    fs.writeFileSync(OUT, sandboxHtml());
    const views = [];
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const v = new WebContentsView({
        webPreferences: {
          partition: scenario === 'wcv' ? `agz-sandbox-${i}` : undefined, // sem "persist:": só em memória
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          javascript: true,
        },
      });
      host.contentView.addChildView(v);
      v.setBounds({ x: 0, y: 0 + i * 10, width: 1280, height: 860 });
      await v.webContents.loadFile(OUT);
      views.push(v);
    }
    const rows = await views[0].webContents.executeJavaScript('document.querySelectorAll("tbody tr").length');
    const loadMs = Date.now() - t0;
    const after = await sample();
    done({ rows, loadMs, before: strip(before), after: strip(after), deltaPssMB: +(after.totalPssMB - before.totalPssMB).toFixed(1), deltaRssMB: +(after.totalRssMB - before.totalRssMB).toFixed(1), procsAfter: after.procs.map((p) => p.type + ':' + p.pssMB) });
    return;
  }

  done({ before: strip(before) });
});

function strip(m) {
  return { processes: m.processes, totalPssMB: m.totalPssMB, totalRssMB: m.totalRssMB };
}
