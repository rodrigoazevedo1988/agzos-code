/**
 * Agzos Snap — monta a página HTML da imagem a partir de dados estruturados (puro, sem Electron).
 *
 * O renderer manda tokens já coloridos (monaco.editor.colorize + estilo calculado), nunca HTML:
 *   { lines: [[{ t, c, i?, b?, u? }]], theme: { bg, fg, lineNumber }, background: 'gradient'|'solid'|'transparent',
 *     solidColor, padding, frame, title, lineNumbers, startLine, watermark, fontSize }
 * Todo texto é escapado; cores só passam se forem #hex ou rgb(a) numérico; a página tem CSP sem scripts.
 */

const LIMITS = {
  lines: 1000, chars: 200_000, tokensPerLine: 2000,
  paddingMin: 0, paddingMax: 128, fontMin: 10, fontMax: 32, title: 120,
};

const DEFAULT_THEME = { bg: '#0E0E0E', fg: '#E8E8E8', lineNumber: '#5A5A5A' };
const GRADIENT = 'linear-gradient(135deg, #D10A11 0%, #6B0509 45%, #0E0E0E 100%)';
const FONT_STACK = 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace';

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|1\.0+)\s*)?\)$/i;

function safeColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return HEX_RE.test(v) || RGB_RE.test(v) ? v : null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function intIn(value, min, max, fallback) {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSnapPayload(p) {
  const v = p && typeof p === 'object' ? p : {};
  if (!Array.isArray(v.lines) || !v.lines.length) throw new Error('Nada para capturar: selecione um trecho ou abra um arquivo.');
  const t = v.theme && typeof v.theme === 'object' ? v.theme : {};
  const theme = {
    bg: safeColor(t.bg) || DEFAULT_THEME.bg,
    fg: safeColor(t.fg) || DEFAULT_THEME.fg,
    lineNumber: safeColor(t.lineNumber) || DEFAULT_THEME.lineNumber,
  };
  let budget = LIMITS.chars;
  const lines = [];
  for (const raw of v.lines.slice(0, LIMITS.lines)) {
    const tokens = [];
    for (const tok of Array.isArray(raw) ? raw.slice(0, LIMITS.tokensPerLine) : []) {
      if (!tok || typeof tok.t !== 'string' || budget <= 0) continue;
      const text = tok.t.slice(0, budget).replace(/[\r\n]/g, '');
      budget -= text.length;
      tokens.push({ t: text, c: safeColor(tok.c), i: tok.i === true, b: tok.b === true, u: tok.u === true });
    }
    lines.push(tokens);
  }
  return {
    lines,
    theme,
    background: ['gradient', 'solid', 'transparent'].includes(v.background) ? v.background : 'gradient',
    solidColor: safeColor(v.solidColor) || '#1A1A1A',
    padding: intIn(v.padding, LIMITS.paddingMin, LIMITS.paddingMax, 48),
    frame: v.frame !== false,
    title: typeof v.title === 'string' ? v.title.slice(0, LIMITS.title) : '',
    lineNumbers: v.lineNumbers === true,
    startLine: intIn(v.startLine, 1, 10_000_000, 1),
    watermark: v.watermark === true,
    fontSize: intIn(v.fontSize, LIMITS.fontMin, LIMITS.fontMax, 14),
  };
}

function tokenHtml(tok, fg) {
  const styles = [`color:${tok.c || fg}`];
  if (tok.i) styles.push('font-style:italic');
  if (tok.b) styles.push('font-weight:bold');
  if (tok.u) styles.push('text-decoration:underline');
  return `<span style="${styles.join(';')}">${escapeHtml(tok.t)}</span>`;
}

function buildSnapHtml(payload) {
  const o = normalizeSnapPayload(payload);
  const bg = o.background === 'gradient' ? GRADIENT : (o.background === 'solid' ? o.solidColor : 'transparent');
  const rows = o.lines.map((tokens, idx) => {
    const ln = o.lineNumbers ? `<span class="ln">${o.startLine + idx}</span>` : '';
    const code = tokens.map((tok) => tokenHtml(tok, o.theme.fg)).join('') || ' ';
    return `<div class="row">${ln}<span class="code">${code}</span></div>`;
  }).join('');
  const bar = o.frame
    ? `<div class="frame-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>`
      + `<span class="frame-title">${escapeHtml(o.title)}</span></div>`
    : '';
  const mark = o.watermark ? '<div class="watermark">Agzos Code</div>' : '';
  const css = [
    'html,body{margin:0;padding:0;background:transparent}',
    `.snap{display:inline-block;padding:${o.padding}px;background:${bg}}`,
    `.window{background:${o.theme.bg};color:${o.theme.fg};border-radius:${o.frame ? 10 : 6}px;`
      + `box-shadow:${o.background === 'transparent' ? 'none' : '0 18px 50px rgba(0,0,0,.45)'};overflow:hidden;position:relative}`,
    '.frame-bar{display:flex;align-items:center;gap:7px;padding:11px 14px 0}',
    '.dot{width:12px;height:12px;border-radius:50%;display:inline-block}',
    '.dot.r{background:#FF5F57}.dot.y{background:#FEBC2E}.dot.g{background:#28C840}',
    `.frame-title{flex:1;text-align:center;margin-right:57px;font:12px system-ui,sans-serif;color:${o.theme.lineNumber}}`,
    `.code-box{padding:14px 18px 16px;font-family:${FONT_STACK};font-size:${o.fontSize}px;line-height:1.55;white-space:pre}`,
    '.row{display:flex}',
    `.ln{display:inline-block;min-width:2.5em;padding-right:1.2em;text-align:right;color:${o.theme.lineNumber};user-select:none}`,
    `.watermark{text-align:right;font:600 11px system-ui,sans-serif;color:rgba(255,255,255,.75);margin-top:8px;letter-spacing:.04em}`,
  ].join('');
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'
    + `<style>${css}</style></head><body><div class="snap" id="snap"><div class="window">${bar}`
    + `<div class="code-box">${rows}</div></div>${mark}</div></body></html>`;
}

module.exports = { buildSnapHtml, normalizeSnapPayload, safeColor, escapeHtml, LIMITS };
