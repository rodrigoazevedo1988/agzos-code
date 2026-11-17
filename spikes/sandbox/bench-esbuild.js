'use strict';
// Benchmark de compilação (pergunta 1 e 2).
// Uso: node bench-esbuild.js --engine native|wasm --mode fs|virtual --react bundle|external --runs 20 [--component Dashboard] [--sourcemap]
// "frio" = require do pacote + initialize (wasm) + 1º build, num processo novo.
// "quente" = builds seguintes no mesmo processo (mediana e p95). Cache de leitura do plugin
// é recriado a cada build (o plugin é novo), então o quente inclui IO real.
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const engine = arg('engine', 'native');
const mode = arg('mode', 'fs');
const react = arg('react', 'bundle');
const runs = Number(arg('runs', 20));
const component = arg('component', 'Dashboard');
const sourcemap = !!arg('sourcemap', false);
const vendor = !!arg('vendor', false); // build do bundle vendor (React) 1x por projeto

const root = path.join(__dirname, 'fixture');
const shimsDir = path.join(__dirname, 'shims');
const componentPath = path.join(root, 'src/components', component + '.tsx');
const io = { readFile: async (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } } };

(async () => {
  const t0 = performance.now();
  const esbuild = require(engine === 'wasm' ? 'esbuild-wasm' : 'esbuild');
  if (engine === 'wasm') await esbuild.initialize({});
  const tInit = performance.now();
  const { buildOptions } = require('./lib/build.js');

  const times = [];
  let last, stats;
  const useCtx = !!arg('ctx', false); // context().rebuild(): plugin e cache de arquivos persistem entre builds
  let ctx;
  for (let i = 0; i < runs; i++) {
    if (!useCtx || !ctx) stats = { reads: 0, aliasHits: [], nodeModules: new Set(), tsconfig: null };
    const s = performance.now();
    const opts = () => buildOptions({ projectRoot: root, shimsDir, componentPath, mode, io, react, stats, sourcemap, vendor });
    if (useCtx) {
      ctx ||= await esbuild.context({ ...opts(), metafile: false });
      last = await ctx.rebuild();
    } else last = await esbuild.build(opts());
    times.push(performance.now() - s);
  }
  if (ctx) await ctx.dispose();
  const warm = times.slice(1).sort((a, b) => a - b);
  const q = (p) => warm.length ? +warm[Math.min(warm.length - 1, Math.floor(p * warm.length))].toFixed(1) : null;
  const out = last.outputFiles[0].text;
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(__dirname, vendor ? "out-vendor.js" : `out-${component}-${react}.js`), out);
  console.log(JSON.stringify({
    engine, mode, react, sourcemap, component, ctx: useCtx, vendor,
    initMs: +(tInit - t0).toFixed(1),
    firstBuildMs: +times[0].toFixed(1),
    coldTotalMs: +(tInit - t0 + times[0]).toFixed(1),
    warmMedianMs: q(0.5),
    warmP95Ms: q(0.95),
    outKB: +(Buffer.byteLength(out) / 1024).toFixed(1),
    inputs: Object.keys(last.metafile?.inputs || {}).length || undefined,
    fileReads: stats.reads,
    tsconfig: stats.tsconfig,
    aliasHits: stats.aliasHits,
    nodeModules: [...stats.nodeModules],
    warnings: last.warnings.length,
  }));
  if (esbuild.stop) esbuild.stop();
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
