'use strict';
// Pergunta 4, opção "Node": Tailwind v3 (o mesmo pacote que o projeto do usuário já tem) rodando
// no main/utilityProcess, lendo o tailwind.config.js do projeto e varrendo SÓ os arquivos que o
// esbuild incluiu no bundle do componente. O CSS pronto vai para o iframe como <style>.
// Uso: node tailwind-v3-node.js [--runs 10]
const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 10;
const root = path.join(__dirname, 'fixture');

(async () => {
  const t0 = performance.now();
  // No app: require resolvido a partir do projeto (createRequire(projectRoot + '/package.json')).
  const postcss = require('postcss');
  const tailwindcss = require('tailwindcss');
  const tReq = performance.now();

  const configPath = path.join(root, 'tailwind.config.js');
  const files = ['Dashboard.tsx', 'StatTile.tsx', 'ui/Button.tsx', 'ui/Card.tsx'].map((f) => path.join(root, 'src/components', f));
  const css = '@tailwind base;\n@tailwind components;\n@tailwind utilities;';

  const times = [];
  let out;
  for (let i = 0; i < runs; i++) {
    delete require.cache[require.resolve(configPath)]; // config pode ter mudado
    const config = { ...require(configPath), content: files.map((f) => ({ raw: fs.readFileSync(f, 'utf8'), extension: 'tsx' })) };
    const s = performance.now();
    out = await postcss([tailwindcss(config)]).process(css, { from: undefined });
    times.push(performance.now() - s);
  }
  const warm = times.slice(1).sort((a, b) => a - b);
  const has = (sel) => out.css.includes(sel);
  console.log(JSON.stringify({
    engine: 'tailwind v3 node ' + require('tailwindcss/package.json').version,
    requireMs: +(tReq - t0).toFixed(1),
    firstMs: +times[0].toFixed(1),
    coldTotalMs: +(tReq - t0 + times[0]).toFixed(1),
    warmMedianMs: +warm[Math.floor(warm.length / 2)].toFixed(1),
    cssKB: +(out.css.length / 1024).toFixed(1),
    configApplied: {
      'bg-brand-500': has('.bg-brand-500') && out.css.includes('31 111 235'),
      'p-18': has('.p-18') && out.css.includes('4.5rem'),
      'rounded-xl2': has('.rounded-xl2'),
      'bg-agz': has('.bg-agz'),
      'hover:bg-brand-900': has('.hover\\:bg-brand-900:hover'),
    },
  }));
  fs.writeFileSync(path.join(__dirname, 'out-tw3.css'), out.css);
})();
