'use strict';
// Gera os bundles que o host Electron carrega (electron/gen/): lib de build para o renderer
// (modo virtual do esbuild-wasm) e o tailwind.config.js da fixture em IIFE (para o Play CDN v3).
const esbuild = require('esbuild');
const path = require('path');
const at = (p) => path.join(__dirname, p);

esbuild.buildSync({ entryPoints: [at('lib/build.js')], bundle: true, format: 'iife', globalName: 'AGZ', platform: 'browser', outfile: at('electron/gen/agz-lib.js') });
esbuild.buildSync({ entryPoints: [at('fixture/tailwind.config.js')], bundle: true, format: 'iife', globalName: '__twcfg', platform: 'browser', outfile: at('electron/gen/twcfg.js') });
console.log('ok: electron/gen/');
