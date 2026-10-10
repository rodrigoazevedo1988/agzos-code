#!/usr/bin/env node
/**
 * Regenera os PNGs de build/ a partir de logos/SVG/6.svg (símbolo Agzos).
 *
 * Uso:
 *   node tools/build-pngs-from-svg.js
 *
 * Requer: librsvg2-bin (rsvg-convert)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const SVG = path.join(ROOT, 'logos', 'SVG', '6.svg');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function main() {
  if (!fs.existsSync(SVG)) {
    console.error(`✗ ${SVG} não existe`);
    process.exit(1);
  }
  const which = spawnSync('which', ['rsvg-convert']);
  if (which.status !== 0) {
    console.error('✗ rsvg-convert não instalado. apt-get install librsvg2-bin');
    process.exit(1);
  }
  fs.mkdirSync(BUILD, { recursive: true });
  for (const s of SIZES) {
    const out = path.join(BUILD, `icon-${s}.png`);
    const r = spawnSync('rsvg-convert', ['-w', String(s), '-h', String(s), '-b', '#0E0E0E', SVG, '-o', out]);
    if (r.status !== 0) {
      console.error(`✗ Falha em ${out}:`, r.stderr?.toString());
      process.exit(1);
    }
  }
  // Copia icon-256.png como icon.png
  fs.copyFileSync(path.join(BUILD, 'icon-256.png'), path.join(BUILD, 'icon.png'));
  console.log(`✓ ${SIZES.length} PNGs gerados em build/`);
  console.log('\nPróximo passo: node tools/build-icons.js (gera .ico e .icns)');
}

main();
