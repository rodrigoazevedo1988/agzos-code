'use strict';
// RSS do serviço do esbuild nativo (processo filho) após 10 builds do Dashboard.
// Uso: node mem-esbuild.js
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const esbuild = require('esbuild');
const { buildOptions } = require('./lib/build.js');

const root = path.join(__dirname, 'fixture');
const io = { readFile: async (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } } };

(async () => {
  for (let i = 0; i < 10; i++) {
    await esbuild.build(buildOptions({ projectRoot: root, shimsDir: path.join(__dirname, 'shims'), componentPath: root + '/src/components/Dashboard.tsx', mode: 'fs', io, react: 'external' }));
  }
  console.log(execSync(`ps -o pid,rss,comm --ppid ${process.pid}`).toString().trim());
  console.log('node rss MB', (process.memoryUsage().rss / 1048576).toFixed(1));
  esbuild.stop();
})();
