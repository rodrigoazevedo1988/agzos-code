#!/usr/bin/env node
/**
 * Regenera build/icon.ico a partir dos PNGs em build/icon-*.png
 * e build/icon.icns pro macOS.
 *
 * Requer:
 *   - Python 3 + Pillow
 *   - libicns-utils (png2icns)
 *
 * Uso:
 *   node tools/build-icons.js
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

// Tamanhos que existem nos PNGs
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function py(code) {
  return spawnSync('python3', ['-c', code], { stdio: 'pipe', encoding: 'utf-8' });
}

function buildIco() {
  // Monta o ICO via Python (Pillow com append_images não funciona bem; faço manual)
  const code = `
import struct
sizes = [16, 24, 32, 48, 64, 128, 256]
images_data = []
for s in sizes:
    with open(f"build/icon-{s}.png", "rb") as f:
        images_data.append((s, f.read()))
header = struct.pack("<HHH", 0, 1, len(images_data))
entries = b''
total_data = b''
offset = 6 + 16 * len(images_data)
for s, blob in images_data:
    w = 0 if s == 256 else s
    h = 0 if s == 256 else s
    entry = struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
    entries += entry
    total_data += blob
    offset += len(blob)
with open("build/icon.ico", "wb") as f:
    f.write(header + entries + total_data)
print(f"OK: {len(sizes)} frames")
`;
  const r = py(code);
  if (r.status !== 0) {
    console.error('buildIco failed:', r.stderr);
    process.exit(1);
  }
  console.log('✓', r.stdout.trim(), '→ build/icon.ico');
}

function buildIcns() {
  // Gera .icns a partir dos PNGs via png2icns
  // Tamanhos suportados: 16, 32, 48, 128, 256, 512, 1024
  const ok = spawnSync('which', ['png2icns']);
  if (ok.status !== 0) {
    console.warn('⚠ png2icns não instalado. Instale: apt-get install icnsutils');
    console.warn('  (electron-builder gera o .icns a partir do PNG automaticamente, então o build não quebra)');
    return;
  }
  const validSizes = SIZES.filter(s => [16, 32, 48, 128, 256, 512, 1024].includes(s));
  const args = ['build/icon.icns', ...validSizes.map(s => `build/icon-${s}.png`)];
  const r = spawnSync('png2icns', args, { stdio: 'inherit' });
  if (r.status === 0) {
    console.log('✓ build/icon.icns');
  } else {
    console.warn('⚠ png2icns falhou — electron-builder ainda gera o .icns a partir do PNG');
  }
}

function main() {
  if (!fs.existsSync(BUILD)) {
    console.error('✗ build/ não existe');
    process.exit(1);
  }
  // Verifica que os PNGs existem
  for (const s of SIZES) {
    if (!fs.existsSync(path.join(BUILD, `icon-${s}.png`))) {
      console.error(`✗ build/icon-${s}.png não existe. Rode tools/build-pngs-from-svg.js primeiro.`);
      process.exit(1);
    }
  }
  buildIco();
  buildIcns();
  console.log('\nIcones regenerados. Pra trocar o logo:');
  console.log('  1) Substitua logos/SVG/6.svg (símbolo vermelho oficial)');
  console.log('  2) Rode: node tools/build-pngs-from-svg.js && node tools/build-icons.js');
}

main();
