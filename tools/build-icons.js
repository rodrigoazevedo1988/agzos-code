#!/usr/bin/env node
/**
 * Agzos Code — pipeline de ícones (zero dependências externas)
 *
 * Gera, a partir de logos/SVG/6.svg (símbolo Agzos vermelho):
 *   - build/icon-{16..1024}.png  (PNGs usados em runtime e no Linux)
 *   - build/icon.png             (512px — Linux / electron-builder)
 *   - build/icon.ico             (Windows, frames PNG 16–256)
 *   - build/icon.icns            (macOS, frames PNG 16–1024)
 *
 * O desenho segue o grid de ícones do macOS: canvas 1024 transparente,
 * "squircle" escuro de 824px centralizado e o símbolo com respiro interno.
 * Em tamanhos pequenos (≤ 48px) usa uma variante com menos margem para
 * o símbolo continuar legível.
 *
 * Renderiza com o Chromium do próprio Electron, então roda igual em
 * macOS, Windows e Linux sem rsvg-convert, Pillow ou png2icns.
 *
 * Uso:
 *   npm run build:icons
 *   (equivale a: electron tools/build-icons.js)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const SYMBOL_SVG = path.join(ROOT, 'logos', 'SVG', '6.svg');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const BG = '#0E0E0E';
const BG_TOP = '#1C1C1C';

/* -------------------------------------------------------------------------- */
/*  SVG composto                                                               */
/* -------------------------------------------------------------------------- */
function composeSvg(small) {
  const raw = fs.readFileSync(SYMBOL_SVG, 'utf-8');
  const vb = raw.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  // Grid macOS: corpo 824/1024, raio ~185. Variante pequena: corpo 960.
  const body = small ? 960 : 824;
  const off = (1024 - body) / 2;
  const radius = small ? 200 : 185;
  // Símbolo ocupa ~62% do corpo, mantendo proporção do viewBox
  const symW = body * 0.62;
  const symH = symW * (vb[3] / vb[2]);
  const symX = (1024 - symW) / 2;
  const symY = (1024 - symH) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG}"/>
    </linearGradient>
  </defs>
  <rect x="${off}" y="${off}" width="${body}" height="${body}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>
  <rect x="${off + 2}" y="${off + 2}" width="${body - 4}" height="${body - 4}" rx="${radius - 2}" ry="${radius - 2}" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="4"/>
  <svg x="${symX}" y="${symY}" width="${symW}" height="${symH}" viewBox="${vb.join(' ')}" fill="none">${inner}</svg>
</svg>`;
}

/* -------------------------------------------------------------------------- */
/*  Render via Chromium (offscreen)                                            */
/* -------------------------------------------------------------------------- */
async function renderPng(win, svg, size) {
  // SVG inline num HTML temporário (data: URLs grandes falham no loadURL)
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`;
  const tmp = path.join(require('os').tmpdir(), `agzos-icon-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  win.setContentSize(size, size);
  await win.loadFile(tmp);
  fs.rmSync(tmp, { force: true });
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  // capturePage pode devolver em escala do display; normaliza
  return img.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

/* -------------------------------------------------------------------------- */
/*  Writers                                                                    */
/* -------------------------------------------------------------------------- */
function writeIco(frames, out) {
  // frames: [{ size, png }]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + 16 * frames.length;
  for (const { size, png } of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  fs.writeFileSync(out, Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]));
}

function writeIcns(bySize, out) {
  // Tipos ICNS com payload PNG (macOS 10.7+)
  const types = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64],
    ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ];
  const chunks = [];
  for (const [type, size] of types) {
    const png = bySize[size];
    if (!png) continue;
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32BE(png.length + 8, 4);
    chunks.push(h, png);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(out, Buffer.concat([head, body]));
}

/* -------------------------------------------------------------------------- */
/*  Main                                                                       */
/* -------------------------------------------------------------------------- */
async function main() {
  let electron;
  try { electron = require('electron'); } catch { electron = null; }
  if (!electron || typeof electron === 'string' || !electron.app) {
    console.error('✗ Rode via Electron: npm run build:icons');
    process.exit(1);
  }
  const { app, BrowserWindow } = electron;
  app.disableHardwareAcceleration();
  if (app.dock) app.dock.hide();
  await app.whenReady();

  fs.mkdirSync(BUILD, { recursive: true });
  const svgLarge = composeSvg(false);
  const svgSmall = composeSvg(true);
  fs.writeFileSync(path.join(BUILD, 'icon.svg'), svgLarge);

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true },
  });
  const bySize = {};
  for (const s of SIZES) {
    bySize[s] = await renderPng(win, s <= 48 ? svgSmall : svgLarge, s);
    fs.writeFileSync(path.join(BUILD, `icon-${s}.png`), bySize[s]);
  }
  win.destroy();
  fs.copyFileSync(path.join(BUILD, 'icon-512.png'), path.join(BUILD, 'icon.png'));
  console.log(`✓ ${SIZES.length} PNGs em build/ (+ icon.png, icon.svg)`);

  writeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: bySize[size] })), path.join(BUILD, 'icon.ico'));
  console.log('✓ build/icon.ico');

  writeIcns(bySize, path.join(BUILD, 'icon.icns'));
  console.log('✓ build/icon.icns');

  app.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
