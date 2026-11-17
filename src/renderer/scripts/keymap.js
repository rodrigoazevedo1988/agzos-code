/**
 * Keymap — lógica pura dos atalhos globais (sem DOM/window), testável em Node.
 *
 * - Resolve a tecla de forma robusta a layouts: usa e.key quando é um caractere
 *   ASCII simples (respeita o layout lógico, ex.: Dvorak) e cai para e.code quando
 *   e.key não serve (macOS Option+Z = 'Ω', tecla morta 'Dead' no pt-BR ABNT2, etc.).
 * - Chords no estilo VS Code (Ctrl+K Ctrl+S, Ctrl+K Ctrl+W).
 * - Decide quais atalhos valem dentro de terminal/inputs.
 */

export const CHORD_TIMEOUT_MS = 1500;

const CODE_TO_KEY = (() => {
  const map = {
    Backquote: '`',
    Quote: "'",
    Comma: ',',
    Minus: '-',
    Equal: '=',
    NumpadAdd: '+',
    NumpadSubtract: '-',
    Numpad0: '0',
  };
  for (let c = 65; c <= 90; c++) map[`Key${String.fromCharCode(c)}`] = String.fromCharCode(c + 32);
  for (let d = 0; d <= 9; d++) map[`Digit${d}`] = String(d);
  return map;
})();

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'OS']);

/** Tecla lógica normalizada (minúscula) ou null. */
export function keyId(e) {
  const k = e?.key;
  if (typeof k === 'string' && k.length === 1 && k.charCodeAt(0) < 128 && k !== ' ') {
    return k.toLowerCase();
  }
  return CODE_TO_KEY[e?.code] ?? null;
}

function isTerminalToggleKey(e, isMac) {
  const k = keyId(e);
  if (k === '`' || k === "'") return true;
  // Teclado ISO no macOS: a tecla à esquerda do 1 chega como IntlBackslash.
  if (isMac && e.code === 'IntlBackslash') return true;
  // Tecla morta no lugar do backquote (US-International, ABNT2 com Shift etc.).
  return e.code === 'Backquote';
}

/**
 * Converte um KeyboardEvent (ou objeto equivalente) no id da ação global, ou null.
 */
export function matchShortcut(e, { isMac = false } = {}) {
  if (!e || MODIFIER_KEYS.has(e.key)) return null;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const shift = !!e.shiftKey;
  const alt = !!e.altKey;
  const k = keyId(e);

  if (ctrl && !alt) {
    // Ctrl+PageUp/PageDown: sessão anterior/seguinte (app.js só age com foco no terminal).
    if (!shift && e.key === 'PageUp') return 'terminal.prev';
    if (!shift && e.key === 'PageDown') return 'terminal.next';
    if (shift) {
      // Ctrl+Shift+` (US: '~'; ABNT2: '"' na tecla Quote) cria um terminal novo.
      if (k === '~' || (k === '"' && e.code === 'Quote') || isTerminalToggleKey(e, isMac)) return 'terminal.new';
      // Ctrl+Shift+5 divide (layout US entrega '%'; e.code cobre os demais).
      if (k === '%' || e.code === 'Digit5' || e.code === 'Numpad5') return 'terminal.split';
      if (k === 'a') return 'ai.focus';
      if (k === 'p') return 'palette.commands';
      if (k === 'e') return 'view.explorer';
      if (k === 'f') return 'view.search';
      if (k === 'g') return 'view.git';
      if (k === 'x') return 'view.modules';
      if (k === 'v') return 'markdown.previewSide';
      if (k === '+') return 'zoom.in';
      return null;
    }
    if (k === 'l') return 'ai.sendSelection';
    if (k === 'p') return 'palette.quickOpen';
    if (k === 'w') return 'tab.close';
    if (k === 'f') return 'editor.find';
    if (k === 'h') return 'editor.replace';
    if (k === 'g') return 'editor.gotoLine';
    if (k === 'b') return 'sidebar.toggle';
    if (k === ',') return 'settings.open';
    if (k === '=' || k === '+') return 'zoom.in';
    if (k === '-') return 'zoom.out';
    if (k === '0') return 'zoom.reset';
    if (isTerminalToggleKey(e, isMac)) return 'terminal.toggle';
    return null;
  }

  if (!ctrl && alt) {
    if (shift && k === 'f') return 'editor.format';
    if (!shift && k === 'z') return 'editor.toggleWordWrap';
  }
  return null;
}

/** Ações que continuam valendo com foco no terminal ou em inputs. */
export const GLOBAL_IN_EDITABLE = new Set([
  'palette.quickOpen',
  'palette.commands',
  'terminal.toggle',
  'terminal.new',
  'terminal.split',
  'terminal.prev',
  'terminal.next',
  'settings.open',
  'sidebar.toggle',
]);

export function shouldHandleInTarget(action, inEditable) {
  if (!action) return false;
  return !inEditable || GLOBAL_IN_EDITABLE.has(action);
}

/**
 * true se o alvo é terminal (xterm) ou campo de texto fora do Monaco.
 * O textarea interno do Monaco NÃO conta: atalhos de editor devem funcionar nele.
 */
export function isEditableTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.closest('.xterm')) return true;
  if (target.closest('.monaco-editor')) return false;
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

export function isMonacoTarget(target) {
  return !!(target && typeof target.closest === 'function' && target.closest('.monaco-editor'));
}

/** Segunda tecla de um chord iniciado por Ctrl+K. */
export function matchChordSecond(e) {
  const k = keyId(e);
  if (k === 's') return 'shortcuts.show';
  if (k === 'w') return 'tabs.closeAll';
  return null;
}

/**
 * Estado do chord Ctrl+K. feed(e) devolve:
 *  - { handled: false } → evento não pertence a chord, processar normalmente
 *  - { handled: true, action: 'chord.start' } → Ctrl+K iniciou o chord
 *  - { handled: true, action: 'shortcuts.show' | 'tabs.closeAll' | null } → segunda tecla
 *    (null = combinação desconhecida; o chord é descartado e a tecla ignorada)
 * O chord expira após timeoutMs ou na próxima tecla não-modificadora.
 */
export function createChord({ timeoutMs = CHORD_TIMEOUT_MS, now = () => Date.now() } = {}) {
  let startedAt = null;
  return {
    get pending() {
      return startedAt !== null && now() - startedAt <= timeoutMs;
    },
    clear() { startedAt = null; },
    feed(e) {
      if (!e || MODIFIER_KEYS.has(e.key)) return { handled: false, action: null };
      if (startedAt !== null) {
        const expired = now() - startedAt > timeoutMs;
        startedAt = null;
        if (!expired) return { handled: true, action: matchChordSecond(e) };
      }
      const ctrl = !!(e.ctrlKey || e.metaKey);
      if (ctrl && !e.shiftKey && !e.altKey && keyId(e) === 'k') {
        startedAt = now();
        return { handled: true, action: 'chord.start' };
      }
      return { handled: false, action: null };
    },
  };
}
