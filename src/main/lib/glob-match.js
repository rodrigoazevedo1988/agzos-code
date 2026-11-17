/**
 * Matcher de glob sem backtracking exponencial (sem RegExp).
 *
 * Usado com padrões vindos do projeto aberto (`.gitignore` na Árvore, `overrides.files` do
 * `.prettierrc` no Formatador): um padrão malicioso não pode congelar o processo main.
 *
 * compileGlob(pattern, { braces, onWarn }) → (path) => boolean | null (padrão inválido, nunca lança)
 *   - `*` (qualquer sequência sem `/`), `?` (um caractere sem `/`), `[abc]`, `[a-z]`, `[!x]`/`[^x]`,
 *     `\x` (literal), `**` como segmento inteiro (zero ou mais pastas; no fim, uma ou mais).
 *     `**` dentro de um segmento vale como `*`. Asteriscos seguidos viram um só.
 *   - braces: true expande `{a,b}` (até LIMITS.braceAlternatives alternativas).
 *   - Inválido: padrão maior que LIMITS.patternMax, classe com intervalo invertido (`[z-a]`),
 *     brace com alternativas demais. Devolve null e chama onWarn(mensagem).
 *
 * Algoritmo: dois ponteiros com retrocesso só até o último `*` (dentro do segmento) e só até o
 * último `**` (entre segmentos) — O(n·m) no pior caso, sem explosão combinatória.
 */

const LIMITS = { patternMax: 512, rulesMax: 2000, braceAlternatives: 64 };

const GLOBSTAR = Symbol('globstar');
const STAR = { t: 'star' };

class GlobError extends Error {}

/** Lê um caractere (com escape `\`) a partir de i. → { c, next } */
function readChar(s, i) {
  if (s[i] === '\\' && i + 1 < s.length) return { c: s[i + 1], next: i + 2 };
  return { c: s[i], next: i + 1 };
}

/** Classe `[...]` em s[i] === '['. → { token, next } | null (sem `]`: o `[` é literal). */
function parseClass(s, i) {
  let j = i + 1;
  let neg = false;
  if (s[j] === '!' || s[j] === '^') { neg = true; j++; }
  const items = [];
  let first = true;
  while (j < s.length) {
    if (s[j] === ']' && !first) {
      return { token: { t: 'cls', neg, items }, next: j + 1 };
    }
    first = false;
    const lo = readChar(s, j);
    j = lo.next;
    if (s[j] === '-' && j + 1 < s.length && s[j + 1] !== ']') {
      const hi = readChar(s, j + 1);
      j = hi.next;
      if (hi.c < lo.c) throw new GlobError(`intervalo inválido [${lo.c}-${hi.c}]`);
      items.push([lo.c, hi.c]);
    } else {
      items.push([lo.c, lo.c]);
    }
  }
  return null;
}

/** Um segmento (sem `/`) → lista de tokens, ou GLOBSTAR. */
function parseSegment(seg) {
  if (seg.length >= 2 && /^\*+$/.test(seg)) return GLOBSTAR;
  const tokens = [];
  for (let i = 0; i < seg.length;) {
    const ch = seg[i];
    if (ch === '*') {
      if (tokens[tokens.length - 1] !== STAR) tokens.push(STAR);
      i++;
    } else if (ch === '?') {
      tokens.push({ t: 'any' });
      i++;
    } else if (ch === '[') {
      const cls = parseClass(seg, i);
      if (cls) { tokens.push(cls.token); i = cls.next; } else { tokens.push({ t: 'lit', c: '[' }); i++; }
    } else {
      const r = readChar(seg, i);
      tokens.push({ t: 'lit', c: r.c });
      i = r.next;
    }
  }
  return tokens;
}

function tokenMatches(tok, c) {
  if (tok.t === 'lit') return tok.c === c;
  if (tok.t === 'any') return true;
  let hit = false;
  for (const [lo, hi] of tok.items) {
    if (c >= lo && c <= hi) { hit = true; break; }
  }
  return tok.neg ? !hit : hit;
}

/** Dois ponteiros: `*` casa qualquer sequência; os demais tokens, um caractere. */
function segmentMatches(tokens, s) {
  let p = 0;
  let i = 0;
  let starP = -1;
  let starI = 0;
  while (i < s.length) {
    if (p < tokens.length && tokens[p] === STAR) {
      starP = p++;
      starI = i;
    } else if (p < tokens.length && tokenMatches(tokens[p], s[i])) {
      p++;
      i++;
    } else if (starP >= 0) {
      p = starP + 1;
      i = ++starI;
    } else {
      return false;
    }
  }
  while (p < tokens.length && tokens[p] === STAR) p++;
  return p === tokens.length;
}

/** Mesmo algoritmo entre segmentos: `**` casa zero ou mais segmentos. */
function pathMatches(segs, parts) {
  let p = 0;
  let i = 0;
  let starP = -1;
  let starI = 0;
  while (i < parts.length) {
    if (p < segs.length && segs[p] === GLOBSTAR) {
      starP = p++;
      starI = i;
    } else if (p < segs.length && segmentMatches(segs[p], parts[i])) {
      p++;
      i++;
    } else if (starP >= 0) {
      p = starP + 1;
      i = ++starI;
    } else {
      return false;
    }
  }
  while (p < segs.length && segs[p] === GLOBSTAR) p++;
  return p === segs.length;
}

/** `{a,b}` → ['a', 'b'] (aninhamento resolvido por expansão repetida), com limite. */
function expandBraces(pattern) {
  let out = [pattern];
  for (let round = 0; round < 16; round++) {
    let changed = false;
    const next = [];
    for (const p of out) {
      const open = p.indexOf('{');
      const close = open === -1 ? -1 : p.indexOf('}', open);
      if (open === -1 || close === -1) { next.push(p); continue; }
      // Usa o `{` mais interno antes do `}` para tratar aninhamento.
      const inner = p.lastIndexOf('{', close);
      const head = p.slice(0, inner);
      const tail = p.slice(close + 1);
      for (const alt of p.slice(inner + 1, close).split(',')) next.push(head + alt + tail);
      changed = true;
      if (next.length > LIMITS.braceAlternatives) throw new GlobError('alternativas demais em {…}');
    }
    out = next;
    if (!changed) return out;
  }
  throw new GlobError('chaves {…} aninhadas demais');
}

function compileOne(pattern) {
  const segs = pattern.split('/').map(parseSegment);
  // `a/**` no fim: só o que está dentro (uma ou mais pastas), não `a` em si.
  if (segs.length > 1 && segs[segs.length - 1] === GLOBSTAR) segs.splice(segs.length - 1, 1, [STAR], GLOBSTAR);
  return segs;
}

function compileGlob(pattern, { braces = false, onWarn } = {}) {
  try {
    if (typeof pattern !== 'string') throw new GlobError('padrão não é texto');
    if (pattern.length > LIMITS.patternMax) throw new GlobError(`padrão maior que ${LIMITS.patternMax} caracteres`);
    const variants = (braces ? expandBraces(pattern) : [pattern]).map(compileOne);
    return (p) => {
      const parts = String(p).split('/');
      return variants.some((segs) => pathMatches(segs, parts));
    };
  } catch (e) {
    if (!(e instanceof GlobError)) throw e;
    onWarn?.(`Padrão de glob ignorado (${e.message}): ${String(pattern).slice(0, 80)}`);
    return null;
  }
}

module.exports = { compileGlob, LIMITS };
