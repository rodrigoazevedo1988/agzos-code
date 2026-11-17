/**
 * Detector de segredos do Cofre .env.
 *
 * `detectSecrets(text, { fileName, extraPatterns, allowlist })` → [{ line, column, rule, preview }]
 * - line/column começam em 1; column aponta para o início do valor.
 * - preview = 4 primeiros caracteres do valor + `…`. O valor completo NUNCA sai daqui
 *   (nem em logs, nem no retorno).
 * - allowlist: valores ou sha256 (hex, com ou sem prefixo `sha256:`) que nunca disparam.
 * - extraPatterns: [{ name, regex }] (regex em texto; grupo 1, se houver, é o valor).
 */

const path = require('node:path');
const crypto = require('node:crypto');

const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'bun.lock']);
const MAX_LINE = 10_000;
const MIN_ENTROPY = 3.5;
const MIN_GENERIC_LEN = 16;

/** Entropia de Shannon (bits por caractere). */
function shannon(s) {
  if (!s) return 0;
  const freq = new Map();
  for (const c of s) freq.set(c, (freq.get(c) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER_RE = /^(?:x+|\*+|\.+|-+|changeme|change[-_]?me|placeholder|example|dummy|sample|test|todo|null|undefined|none|secret|password|pass|senha|token|redacted)$/i;
/** Valores de exemplo/modelo que nunca são segredo real. */
function isPlaceholder(v) {
  if (!v) return true;
  if (PLACEHOLDER_RE.test(v)) return true;
  if (/^<.*>$|^\$\{.*\}$|^\{\{.*\}\}$|^%\(?.*\)?s?%?$|^\$[A-Z_][A-Z0-9_]*$/i.test(v)) return true;
  if (/\$\{|\{\{/.test(v)) return true;
  if (/^your[-_]/i.test(v) || /[-_]here$/i.test(v)) return true;
  if (/x{6,}|\*{4,}|placeholder|example|changeme/i.test(v)) return true;
  return false;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Referência a código (process.env.X, a.b.c, chamada) — não é valor literal. */
function looksLikeCode(v) {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v) || /[()]/.test(v);
}

function decodeJwtPayload(token) {
  try {
    return Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Regras embutidas, em ordem de prioridade (a primeira que cobre um trecho vence).
 * `group`: índice do grupo com o valor (0 = match inteiro). `accept(value)` filtra falsos positivos.
 */
const RULES = [
  { rule: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g, group: 0, noPlaceholder: true },
  { rule: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, group: 0 },
  { rule: 'aws-secret-key', re: /aws_?secret[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi, group: 1 },
  { rule: 'stripe', re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}|\bsk_test_[0-9a-zA-Z]{16,}/g, group: 0 },
  { rule: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, group: 0 },
  { rule: 'openai', re: /\bsk-proj-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{40,}\b/g, group: 0 },
  { rule: 'github', re: /\bgh[posu]_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{22,}/g, group: 0 },
  { rule: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g, group: 0 },
  { rule: 'slack', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g, group: 0 },
  {
    rule: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    group: 0,
    accept: (v) => {
      const payload = decodeJwtPayload(v);
      if (/service_role/.test(payload)) return true;
      if (/"role"\s*:\s*"(?:anon|authenticated)"/.test(payload)) return false;
      return v.length >= 100;
    },
  },
  {
    rule: 'url-credentials',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'`]+:([^\s@/"'`]+)@/gi,
    group: 1,
  },
  {
    rule: 'generic-secret',
    re: /([A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSW(?:OR)?D|PRIVATE_?KEY|API_?KEY)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*(["'`]?)([^\s"'`#;,]+)\2/gi,
    group: 3,
    accept: (v) => v.length >= MIN_GENERIC_LEN && shannon(v) >= MIN_ENTROPY && !UUID_RE.test(v)
      && !looksLikeCode(v) && !/^sha(?:1|256|384|512)-/i.test(v),
  },
];

function sha256(v) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

function buildAllowlist(list) {
  const values = new Set();
  const hashes = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string' || !raw) continue;
    values.add(raw);
    const m = /^(?:sha256:)?([0-9a-f]{64})$/i.exec(raw);
    if (m) hashes.add(m[1].toLowerCase());
  }
  return (v) => values.has(v) || (hashes.size > 0 && hashes.has(sha256(v)));
}

function compileExtra(extraPatterns) {
  const out = [];
  for (const p of Array.isArray(extraPatterns) ? extraPatterns : []) {
    if (!p || typeof p.regex !== 'string' || !p.regex) continue;
    try {
      const re = new RegExp(p.regex, 'gd');
      out.push({ rule: String(p.name || 'personalizado'), re, extra: true });
    } catch {
      // regex inválida: ignorada (a normalização das settings já descarta, isto é defesa extra)
    }
  }
  return out;
}

function previewOf(v) {
  return `${Array.from(v).slice(0, 4).join('')}…`;
}

function matchValue(m, spec) {
  if (spec.extra) {
    if (m.length > 1 && m[1] !== undefined && m.indices?.[1]) return { value: m[1], index: m.indices[1][0] };
    return { value: m[0], index: m.index };
  }
  if (!spec.group) return { value: m[0], index: m.index };
  const value = m[spec.group];
  if (value === undefined) return null;
  // Posição do grupo: último trecho do match (os grupos de valor estão no fim).
  const rel = m[0].lastIndexOf(value);
  return { value, index: m.index + rel };
}

/** Varre uma linha; `covered` evita que duas regras apontem o mesmo trecho. */
function scanLine(line, specs, allowed) {
  const found = [];
  const covered = [];
  const overlaps = (a, b) => covered.some(([s, e]) => a < e && b > s);
  for (const spec of specs) {
    spec.re.lastIndex = 0;
    let m;
    while ((m = spec.re.exec(line)) !== null) {
      if (m[0] === '') { spec.re.lastIndex++; continue; }
      const hit = matchValue(m, spec);
      if (!hit || !hit.value) continue;
      const { value, index } = hit;
      const range = [m.index, m.index + m[0].length];
      if (overlaps(range[0], range[1])) continue;
      if (!spec.noPlaceholder && !spec.extra && isPlaceholder(value)) continue;
      if (spec.accept && !spec.accept(value)) continue;
      if (allowed(value)) { covered.push(range); continue; }
      covered.push(range);
      found.push({ column: index + 1, rule: spec.rule, preview: previewOf(value) });
    }
  }
  return found.sort((a, b) => a.column - b.column);
}

function detectSecrets(text, { fileName, extraPatterns = [], allowlist = [] } = {}) {
  if (fileName && LOCKFILES.has(path.basename(String(fileName)))) return [];
  const src = String(text ?? '');
  if (!src) return [];
  const specs = [...RULES, ...compileExtra(extraPatterns)];
  const allowed = buildAllowlist(allowlist);
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.length > MAX_LINE) line = line.slice(0, MAX_LINE);
    for (const f of scanLine(line, specs, allowed)) out.push({ line: i + 1, ...f });
  }
  return out;
}

module.exports = { detectSecrets, shannon, isPlaceholder, LOCKFILES, RULES };
