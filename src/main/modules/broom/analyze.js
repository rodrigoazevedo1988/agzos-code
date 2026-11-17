/**
 * Vassoura de Produção — análise sintática (roda dentro do worker dos módulos).
 *
 * analyze(text, { fileName, rules, keepConsole, keepComments }) → { edits, error? }
 *   Edit = { id, start, end, rule, line, preview, keepStart?, keepEnd? }
 *   As edições são intervalos de remoção sobre o texto original (nunca re-impresso);
 *   keepStart/keepEnd marcam um trecho preservado dentro do intervalo (if (false) … else).
 *
 * Parse com ts.createSourceFile, sem Program/type checker. Regras: console, comments,
 * unusedImports, deadCode (ver a spec da 1.1.0, seção V).
 */

const path = require('path');
const ts = require('typescript');
const { pieces } = require('./apply');
const { jsxFactoryNames } = require('./jsx-config');

const RULES = ['console', 'comments', 'unusedImports', 'deadCode'];

const DEFAULT_OPTIONS = Object.freeze({
  rules: Object.freeze({ console: true, comments: true, unusedImports: true, deadCode: true }),
  keepConsole: Object.freeze(['error', 'warn']),
  keepComments: Object.freeze(['jsdoc', 'directives', 'license']),
});

const SCRIPT_KINDS = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
};

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function isSupported(fileName) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(String(fileName || '')).toLowerCase());
}

const DIRECTIVE_RE = [
  /^\/\/\/\s*<(reference|amd)/,
  /@ts-/,
  /\beslint(-|\s)/,
  /^\/\*\s*(global|globals|jshint|exported)\s/,
  /prettier-ignore/,
  /[#@]\s*source(Mapping)?URL=/,
  /@jsx/,
  /\bwebpack[A-Z]\w*\s*:/,
  /[#@]__(PURE|NO_SIDE_EFFECTS)__/,
  /\b(istanbul|c8|v8)\s+ignore\b/,
  /@vite-ignore/,
  /@flow\b/,
];

/** 'jsdoc' | 'license' | 'directives' | null (comentário comum). */
function commentKind(raw) {
  if (/^\/\*!/.test(raw) || /@license\b|@preserve\b/.test(raw)) return 'license';
  if (DIRECTIVE_RE.some((re) => re.test(raw))) return 'directives';
  if (/^\/\*\*(?!\/)/.test(raw)) return 'jsdoc';
  return null;
}

const isHSpace = (ch) => ch === ' ' || ch === '\t';
const isWordChar = (ch) => typeof ch === 'string' && /[\w$À-￿]/.test(ch);

function normalizeOptions(options = {}) {
  const rules = { ...DEFAULT_OPTIONS.rules };
  if (options.rules && typeof options.rules === 'object') {
    for (const r of RULES) if (typeof options.rules[r] === 'boolean') rules[r] = options.rules[r];
  }
  const list = (v, d) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [...d]);
  return {
    fileName: typeof options.fileName === 'string' ? options.fileName : 'arquivo.ts',
    rules,
    keepConsole: list(options.keepConsole, DEFAULT_OPTIONS.keepConsole),
    keepComments: list(options.keepComments, DEFAULT_OPTIONS.keepComments),
  };
}

function analyze(fullText, options = {}) {
  const opts = normalizeOptions(options);
  if (typeof fullText !== 'string' || !isSupported(opts.fileName)) return { edits: [] };
  const kind = SCRIPT_KINDS[path.extname(opts.fileName).toLowerCase()];
  // BOM: analisa sem ele e desloca as posições em 1 (o BOM nunca é removido).
  const bom = fullText.charCodeAt(0) === 0xfeff ? 1 : 0;
  const text = bom ? fullText.slice(1) : fullText;
  const sf = ts.createSourceFile(opts.fileName, text, ts.ScriptTarget.Latest, true, kind);
  const diags = sf.parseDiagnostics || [];
  if (diags.length) {
    const d = diags[0];
    const { line } = sf.getLineAndCharacterOfPosition(d.start || 0);
    return { edits: [], error: `Erro de sintaxe na linha ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}` };
  }

  const raw = [];
  let jsxNamesCache = null;

  // ------------------------------------------------------------ utilitários de linha
  function lineStartOf(pos) {
    let i = pos;
    while (i > 0 && text[i - 1] !== '\n') i--;
    return i;
  }

  /** Fim da linha a partir de pos, absorvendo comentários de fim de linha; null se houver código. */
  function lineEndAfter(pos) {
    let i = pos;
    for (;;) {
      while (i < text.length && isHSpace(text[i])) i++;
      if (text.startsWith('//', i)) {
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        continue;
      }
      if (text.startsWith('/*', i)) {
        const close = text.indexOf('*/', i + 2);
        if (close < 0) return null;
        const inner = text.slice(i, close);
        if (inner.includes('\n')) return null;
        i = close + 2;
        continue;
      }
      break;
    }
    if (i >= text.length) return text.length;
    if (text[i] === '\r' && text[i + 1] === '\n') return i + 2;
    if (text[i] === '\n') return i + 1;
    return null;
  }

  /** Intervalo de linhas inteiras que contém só [start, end) (+ espaços/comentário final). */
  function wholeLines(start, end) {
    const ls = lineStartOf(start);
    for (let i = ls; i < start; i++) if (!isHSpace(text[i])) return null;
    const le = lineEndAfter(end);
    if (le === null) return null;
    return [ls, le];
  }

  /** Remoção de instrução: linhas inteiras, ou o nó com os espaços vizinhos na mesma linha. */
  function statementRange(start, end) {
    const whole = wholeLines(start, end);
    if (whole) return whole;
    let e = end;
    while (e < text.length && isHSpace(text[e])) e++;
    if (e < text.length && text[e] !== '\n' && text[e] !== '\r') return [start, e];
    let s = start;
    while (s > 0 && isHSpace(text[s - 1])) s--;
    return [s, end];
  }

  function preview(start, end) {
    const first = text.slice(start, end).split(/\r?\n/).find((l) => l.trim()) || '';
    const t = first.trim();
    return t.length > 80 ? `${t.slice(0, 79)}…` : t;
  }

  function lineOf(pos) {
    return sf.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function push(rule, range, nodeStart, nodeEnd, keep) {
    const e = { rule, start: range[0], end: range[1], line: lineOf(nodeStart), preview: preview(nodeStart, nodeEnd) };
    if (keep) { e.keepStart = keep[0]; e.keepEnd = keep[1]; }
    raw.push(e);
  }

  const isStatementList = (n) => n && (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n)
    || ts.isCaseClause(n) || ts.isDefaultClause(n));

  // ------------------------------------------------------------------ console
  function consoleMethod(expr) {
    if (!ts.isCallExpression(expr)) return null;
    const callee = expr.expression;
    if (!ts.isPropertyAccessExpression(callee)) return null;
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'console') return null;
    return callee.name.text;
  }


  /** Argumentos de console.* removíveis só se nenhum tiver efeito colateral. */
  function consoleArgsPure(call) {
    return call.arguments.every(isPure);
  }

  // ----------------------------------------------------------------- deadCode
  const isFalseLiteral = (e) => e.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isNumericLiteral(e) && Number(e.text) === 0);
  const isTerminator = (s) => ts.isReturnStatement(s) || ts.isThrowStatement(s)
    || ts.isBreakStatement(s) || ts.isContinueStatement(s);

  function deadIf(node) {
    // Bloco morto com var/function: as declarações são içadas para fora — mantém tudo.
    if (containsHoisted(node.thenStatement)) return;
    const start = node.getStart(sf);
    const end = node.getEnd();
    const els = node.elseStatement;
    if (!els) { push('deadCode', statementRange(start, end), start, end); return; }
    if (ts.isBlock(els) && els.statements.length === 0) { push('deadCode', statementRange(start, end), start, end); return; }
    const whole = wholeLines(start, end);
    if (ts.isBlock(els) && hasBlockScopedDeclaration(els)) {
      // let/const/class/function no else: desembrulhar mudaria o escopo — mantém as chaves.
      push('deadCode', [start, end], start, end, [els.getStart(sf), els.getEnd()]);
      return;
    }
    if (ts.isBlock(els)) {
      const open = els.getStart(sf) + 1;
      const close = els.getEnd() - 1;
      let ks = open;
      while (ks < close && isHSpace(text[ks])) ks++;
      const ksLine = text[ks] === '\n' ? ks + 1 : (text[ks] === '\r' && text[ks + 1] === '\n' ? ks + 2 : null);
      const closeLine = lineStartOf(close);
      let onlySpace = true;
      for (let i = closeLine; i < close; i++) if (!isHSpace(text[i])) onlySpace = false;
      if (whole && ksLine !== null && onlySpace && closeLine >= ksLine) {
        push('deadCode', whole, start, end, [ksLine, closeLine]);
        return;
      }
      let a = open;
      while (a < close && /\s/.test(text[a])) a++;
      let b = close;
      while (b > a && /\s/.test(text[b - 1])) b--;
      push('deadCode', [start, end], start, end, [a, b]);
      return;
    }
    push('deadCode', [start, end], start, end, [els.getStart(sf), els.getEnd()]);
  }

  function visitStatements(list) {
    let dead = false;
    for (const s of list) {
      if (dead) {
        if (!isDeclarationStatement(s) && !containsHoisted(s)) {
          const start = s.getStart(sf);
          push('deadCode', statementRange(start, s.getEnd()), start, s.getEnd());
        }
        continue;
      }
      if (opts.rules.deadCode && isTerminator(s)) dead = true;
    }
  }

  const jsxEmptyExpressions = [];
  const jsxTextRanges = [];
  let hasJsx = false;

  function visit(node) {
    if (ts.isJsxText(node)) jsxTextRanges.push([node.pos, node.end]);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) hasJsx = true;
    if (ts.isJsxExpression(node) && !node.expression) jsxEmptyExpressions.push(node);

    if (isStatementList(node.parent)) {
      if (opts.rules.console && ts.isExpressionStatement(node)) {
        const m = consoleMethod(node.expression);
        if (m !== null && !opts.keepConsole.includes(m) && consoleArgsPure(node.expression)) {
          const start = node.getStart(sf);
          push('console', statementRange(start, node.getEnd()), start, node.getEnd());
        }
      }
      if (opts.rules.deadCode && ts.isIfStatement(node) && isFalseLiteral(node.expression)) deadIf(node);
    }
    if (opts.rules.deadCode && (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node))) visitStatements(node.statements);
    if (opts.rules.deadCode && (ts.isCaseClause(node) || ts.isDefaultClause(node))) visitStatements(node.statements);
    ts.forEachChild(node, visit);
  }
  visit(sf);

  // ------------------------------------------------------------------ comments
  const comments = collectComments(sf, text, jsxTextRanges);
  if (opts.rules.comments) {
    const removable = (c) => {
      const k = commentKind(text.slice(c.pos, c.end));
      return !k || !opts.keepComments.includes(k);
    };
    for (const c of comments) {
      if (!removable(c)) continue;
      const range = commentRange(c.pos, c.end);
      if (range) push('comments', range, c.pos, c.end);
    }
    for (const j of jsxEmptyExpressions) {
      const start = j.getStart(sf);
      const end = j.getEnd();
      const inside = comments.filter((c) => c.pos >= start && c.end <= end);
      if (!inside.length || !inside.every(removable)) continue;
      push('comments', wholeLines(start, end) || [start, end], start, end);
    }
  }

  function commentRange(start, end) {
    const whole = wholeLines(start, end);
    if (whole) return whole;
    let e = end;
    while (e < text.length && isHSpace(text[e])) e++;
    const atEol = e >= text.length || text[e] === '\n' || text[e] === '\r';
    if (atEol) {
      let s = start;
      while (s > 0 && isHSpace(text[s - 1])) s--;
      return [s, end];
    }
    // Comentário antes de código na mesma linha: não pode colar dois tokens.
    const before = start > 0 ? text[start - 1] : '';
    if (e === end && isWordChar(before) && isWordChar(text[e])) return null;
    if (text.startsWith('//', start)) return null;
    return [start, e];
  }

  // ------------------------------------------------------------- unusedImports
  if (opts.rules.unusedImports) {
    const removed = unionOf(raw.flatMap((e) => pieces(e)));
    const inRemoved = (pos) => removed.contains(pos);
    const uses = countUses(sf, inRemoved);
    // Nomes citados em JSDoc que não será removido contam como uso.
    const docText = comments
      .filter((c) => text.startsWith('/**', c.pos) && !inRemoved(c.pos))
      .map((c) => text.slice(c.pos, c.end)).join('\n');
    const used = (id) => (uses.get(id.text) || 0) > 0
      || (docText && new RegExp(`(^|[^\\w$])${id.text.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(docText));
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) unusedInImport(st, used);
    }
  }

  // Fábrica JSX: nomes clássicos, pragmas @jsx/@jsxFrag e jsxFactory do tsconfig.
  function jsxNames() {
    if (jsxNamesCache) return jsxNamesCache;
    const names = new Set(JSX_FACTORY_NAMES);
    for (const c of comments) {
      const body = text.slice(c.pos, c.end);
      for (const m of body.matchAll(/@jsx(?:Frag)?\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    }
    for (const n of jsxFactoryNames(opts.fileName)) names.add(n);
    jsxNamesCache = names;
    return names;
  }

  function unusedInImport(decl, used) {
    const clause = decl.importClause;
    if (!clause) return; // import 'x' (efeito colateral)
    const declStart = decl.getStart(sf);
    const declEnd = decl.getEnd();
    const keepReact = (id) => hasJsx && jsxNames().has(id.text);
    const isUsed = (id) => used(id) || keepReact(id);
    const def = clause.name || null;
    const nb = clause.namedBindings || null;
    const ns = nb && ts.isNamespaceImport(nb) ? nb : null;
    const named = nb && ts.isNamedImports(nb) ? nb : null;
    if (named && named.elements.length === 0 && !def) return; // import {} from 'x'
    const defUnused = def ? !isUsed(def) : false;
    const nsUnused = ns ? !isUsed(ns.name) : false;
    const elements = named ? [...named.elements] : [];
    const elUnused = elements.map((el) => !isUsed(el.name));
    const namedAllUnused = named ? elUnused.every(Boolean) : false;
    const allUnused = (!def || defUnused) && (!ns || nsUnused) && (!named || namedAllUnused);

    if (allUnused) {
      push('unusedImports', statementRange(declStart, declEnd), declStart, declEnd);
      return;
    }
    if (def && defUnused) {
      push('unusedImports', [def.getStart(sf), nb.getStart(sf)], def.getStart(sf), def.getEnd());
    }
    if (ns && nsUnused) {
      push('unusedImports', [def.getEnd(), ns.getEnd()], ns.getStart(sf), ns.getEnd());
    }
    if (named && namedAllUnused) {
      push('unusedImports', [def.getEnd(), named.getEnd()], named.getStart(sf), named.getEnd());
      return;
    }
    elements.forEach((el, i) => {
      if (!elUnused[i]) return;
      const usedAfter = elUnused.slice(i + 1).some((u) => !u);
      const elStart = el.getStart(sf);
      if (usedAfter) push('unusedImports', [elStart, elements[i + 1].getStart(sf)], elStart, el.getEnd());
      else push('unusedImports', [elements[i - 1].getEnd(), el.getEnd()], elStart, el.getEnd());
    });
  }

  // ------------------------------------------------------------- consolidação
  const edits = dedupe(raw).map((e) => {
    const out = {
      id: `${e.rule}:${e.start + bom}`,
      start: e.start + bom,
      end: e.end + bom,
      rule: e.rule,
      line: e.line,
      preview: e.preview,
    };
    if (e.keepStart !== undefined) { out.keepStart = e.keepStart + bom; out.keepEnd = e.keepEnd + bom; }
    return out;
  });
  return { edits };
}

const JSX_FACTORY_NAMES = ['React', 'h', 'createElement', 'Fragment', 'jsx', 'jsxs', 'jsxDEV'];

const hasModifier = (node, kind) => Array.isArray(node.modifiers) && node.modifiers.some((m) => m.kind === kind);

/** Declarações nunca removidas como código morto (içadas, tipos, imports/exports, declare). */
function isDeclarationStatement(s) {
  return ts.isVariableStatement(s) || ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)
    || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)
    || ts.isModuleDeclaration(s) || ts.isImportEqualsDeclaration(s) || ts.isImportDeclaration(s)
    || ts.isExportDeclaration(s) || ts.isExportAssignment(s)
    || hasModifier(s, ts.SyntaxKind.DeclareKeyword);
}

const isBlockScopedList = (list) => (list.flags & ts.NodeFlags.BlockScoped) !== 0;

/** Há `var` ou declaração de função alcançável sem entrar em outra função/classe? */
function containsHoisted(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n)) { found = true; return; }
    if (ts.isVariableDeclarationList(n) && !isBlockScopedList(n)) { found = true; return; }
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/** O bloco declara let/const/class/função/tipo no próprio nível? */
function hasBlockScopedDeclaration(block) {
  return block.statements.some((s) => (ts.isVariableStatement(s) && isBlockScopedList(s.declarationList))
    || ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)
    || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isModuleDeclaration(s));
}

const PURE_UNARY = new Set([ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.TildeToken]);

const isAssignmentOperator = (k) => k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;

/**
 * Expressão livre de efeito colateral (avaliá-la não chama nada nem muda estado):
 * literais, identificadores, this, acesso a propriedade/elemento, template sem tag,
 * unários/binários/condicionais, arrays/objetos e funções (definir não executa).
 * Chamada, new, await, yield, atribuição, ++/--, delete, spread, classe → não.
 */
function isPure(e) {
  if (!e) return true;
  switch (e.kind) {
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.SuperKeyword:
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.MetaProperty:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return true;
    default:
      break;
  }
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)
    || ts.isTypeAssertionExpression(e) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e))) {
    return isPure(e.expression);
  }
  if (ts.isPropertyAccessExpression(e)) return isPure(e.expression);
  if (ts.isElementAccessExpression(e)) return isPure(e.expression) && isPure(e.argumentExpression);
  if (ts.isTemplateExpression(e)) return e.templateSpans.every((sp) => isPure(sp.expression));
  if (ts.isPrefixUnaryExpression(e)) return PURE_UNARY.has(e.operator) && isPure(e.operand);
  if (ts.isTypeOfExpression(e) || ts.isVoidExpression(e)) return isPure(e.expression);
  if (ts.isBinaryExpression(e)) {
    return !isAssignmentOperator(e.operatorToken.kind) && isPure(e.left) && isPure(e.right);
  }
  if (ts.isConditionalExpression(e)) return isPure(e.condition) && isPure(e.whenTrue) && isPure(e.whenFalse);
  if (ts.isArrayLiteralExpression(e)) return e.elements.every((x) => ts.isOmittedExpression(x) || isPure(x));
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.every((p) => {
      if (ts.isShorthandPropertyAssignment(p)) return !p.objectAssignmentInitializer;
      if (ts.isPropertyAssignment(p)) return pureName(p.name) && isPure(p.initializer);
      if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) return pureName(p.name);
      return false; // spread
    });
  }
  return false;
}

const pureName = (name) => !ts.isComputedPropertyName(name) || isPure(name.expression);

/** Intervalos disjuntos ordenados, com busca binária. */
function createIntervalSet() {
  const list = [];
  // Índice do primeiro intervalo com fim > pos.
  function firstEndAfter(pos) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][1] > pos) hi = mid; else lo = mid + 1;
    }
    return lo;
  }
  return {
    /** Intervalos que sobrepõem [s, e), em ordem. */
    overlapping(s, e) {
      const out = [];
      for (let i = firstEndAfter(s); i < list.length && list[i][0] < e; i++) out.push(list[i]);
      return out;
    },
    contains(pos) {
      const i = firstEndAfter(pos);
      return i < list.length && list[i][0] <= pos;
    },
    /** Acrescenta um intervalo disjunto dos existentes. */
    add(s, e) {
      list.splice(firstEndAfter(s), 0, [s, e]);
    },
  };
}

/** União de intervalos quaisquer como IntervalSet (mescla sobreposições). */
function unionOf(ranges) {
  const set = createIntervalSet();
  const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let cur = null;
  for (const [s, e] of sorted) {
    if (cur && s <= cur[1]) cur[1] = Math.max(cur[1], e);
    else { if (cur) set.add(cur[0], cur[1]); cur = [s, e]; }
  }
  if (cur) set.add(cur[0], cur[1]);
  return set;
}

/** Remove edições contidas em outras e apara sobreposições parciais (a união não muda). */
function dedupe(list) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted = [];
  const taken = createIntervalSet();
  for (const e of sorted) {
    if (!pieces(e).length) continue;
    const hasKeep = e.keepStart !== undefined;
    let { start } = e;
    let drop = false;
    for (const [s, t] of taken.overlapping(start, e.end)) {
      if (start >= s && e.end <= t) { drop = true; break; }
      if (start < t && e.end > s) {
        if (hasKeep || start < s) { drop = true; break; }
        start = t; // começa dentro de um trecho já removido: apara o início
      }
    }
    if (drop || start >= e.end) continue;
    const next = { ...e, start };
    accepted.push(next);
    for (const [s, t] of pieces(next)) taken.add(s, t);
  }
  return accepted;
}

/** Comentários do arquivo (sem os que caem dentro de texto JSX). */
function collectComments(sf, text, jsxTextRanges) {
  const seen = new Map();
  const jsxText = unionOf(jsxTextRanges);
  const insideJsxText = (pos) => jsxText.contains(pos);
  const add = (ranges) => {
    for (const r of ranges || []) {
      if (seen.has(r.pos) || insideJsxText(r.pos)) continue;
      if (text.startsWith('#!', r.pos)) continue;
      seen.set(r.pos, { pos: r.pos, end: r.end });
    }
  };
  const walk = (node) => {
    if (node.kind !== ts.SyntaxKind.JsxText) {
      add(ts.getLeadingCommentRanges(text, node.pos));
      add(ts.getTrailingCommentRanges(text, node.end));
    }
    for (const child of node.getChildren(sf)) walk(child);
  };
  walk(sf);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}

/** Referências sintáticas por nome (fora dos imports e dos trechos removidos). */
function countUses(sf, inRemoved) {
  const uses = new Map();
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && !inRemoved(node.getStart(sf)) && countsAsUse(node)) {
      uses.set(node.text, (uses.get(node.text) || 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return uses;
}

function countsAsUse(id) {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if ((ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)
    || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)
    || ts.isEnumMember(p)) && p.name === id) return false;
  return true;
}

module.exports = { analyze, isSupported, commentKind, DEFAULT_OPTIONS, SUPPORTED_EXTENSIONS, RULES };
