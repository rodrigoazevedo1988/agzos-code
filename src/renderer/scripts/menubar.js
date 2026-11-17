/**
 * Barra de menus in-app (Windows/Linux). No macOS fica escondida: lá vale o
 * menu nativo do sistema (main.js).
 *
 * Modelo: menu-model.js (puro). Ações: comandos da paleta (runCommand) ou
 * ações do Monaco ('monaco:<id>') — o menu não tem lógica própria.
 *
 * Teclado: Alt sozinho foca a barra; Alt+letra abre o menu; ←/→ trocam de menu
 * (→ abre submenu, ← fecha), ↑/↓ andam nos itens, Enter/Espaço executa, Esc fecha,
 * letra sublinhada executa o item. Nunca rouba teclas do terminal (xterm).
 */

import { MENUS, mnemonicsFor, nextIndex, resolveAccel, accelLabel } from './menu-model.js';
import { runCommand } from './command-palette.js';
import { runMonacoAction } from './menu-actions.js';
import { isMenuMnemonicKey } from './keymap.js';

const State = window.AgzosState;

let bar = null;
let titles = [];
let openIndex = -1;          // menu aberto (-1 = nenhum)
let focusIndex = -1;         // título com foco de teclado (barra focada sem menu aberto)
let keyboardMode = false;    // sublinha mnemônicos e mostra foco
let panels = [];             // pilha: [{ el, items, active, rows }]
let restoreFocusEl = null;   // elemento com foco antes de a barra ganhar o teclado
let altArmed = false;        // Alt pressionado sem outra tecla no meio
let submenuTimer = null;

const isOpen = () => openIndex >= 0;
const inTerminal = (el) => !!el?.closest?.('.xterm');
const blocked = () => State.onboardingActive || State.welcomeOpen;

/* -------------------------------------------------------------------------- */
/*  Contexto (habilitado/marcado)                                              */
/* -------------------------------------------------------------------------- */
function buildContext() {
  const panel = document.getElementById('bottom-panel');
  return {
    hasEditor: !!State.activePath,
    untitled: typeof State.activePath === 'string' && State.activePath.startsWith('untitled:'),
    hasWorkspace: !!State.workspaceRoot,
    openCount: State.files?.size || 0,
    recentFolders: Array.isArray(State.settings?.recentFolders) ? State.settings.recentFolders : [],
    settings: State.settings || {},
    sidebarVisible: !document.body.classList.contains('sidebar-hidden'),
    panelVisible: !!panel && !panel.hidden,
    statusBarVisible: State.settings?.workbench?.statusBarVisible !== false,
    platform: State.platform,
  };
}

function basename(p) {
  return String(p).split(/[\\/]/).filter(Boolean).pop() || p;
}

/** Expande itens dinâmicos (pastas recentes) em itens concretos. */
function expand(items, ctx) {
  const out = [];
  for (const item of items) {
    if (item.dynamic === 'recentFolders') {
      if (!ctx.recentFolders.length) {
        out.push({ id: `${item.id}.empty`, label: 'Nenhuma pasta recente', disabled: true });
      } else {
        ctx.recentFolders.slice(0, 10).forEach((folder, i) => out.push({
          id: `${item.id}.${i}`, label: basename(folder), detail: folder, run: item.run, args: [folder],
        }));
      }
      continue;
    }
    out.push(item);
  }
  return out;
}

const isEnabled = (item, ctx) => !item.comingSoon && !item.disabled && (typeof item.enabled !== 'function' || !!item.enabled(ctx));
const isSelectable = (item) => item && item.type !== 'separator';

/* -------------------------------------------------------------------------- */
/*  Render                                                                     */
/* -------------------------------------------------------------------------- */
function labelWithMnemonic(label, index) {
  const frag = document.createDocumentFragment();
  if (index == null || index < 0) {
    frag.append(label);
    return frag;
  }
  const u = document.createElement('span');
  u.className = 'mb-mnemonic';
  u.textContent = label[index];
  frag.append(label.slice(0, index), u, label.slice(index + 1));
  return frag;
}

function renderTitles() {
  bar.replaceChildren();
  titles = MENUS.map((menu, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mb-title';
    btn.id = `menubar-${menu.id}`;
    btn.dataset.menu = menu.id;
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.tabIndex = -1;
    const idx = menu.label.toLowerCase().indexOf(menu.mnemonic.toLowerCase());
    btn.append(labelWithMnemonic(menu.label, idx));
    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // não tira o foco do editor
      if (openIndex === i) close();
      else openMenu(i, { keyboard: false });
    });
    btn.addEventListener('mouseenter', () => {
      if (isOpen() && openIndex !== i) openMenu(i, { keyboard: false });
    });
    bar.append(btn);
    return btn;
  });
}

function renderPanel(items, ctx) {
  const el = document.createElement('div');
  el.className = 'mb-dropdown';
  el.setAttribute('role', 'menu');
  if (keyboardMode) el.classList.add('mb-keyboard');
  const mn = mnemonicsFor(items);
  const isMac = ctx.platform === 'darwin';
  const rows = items.map((item, idx) => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'mb-sep';
      sep.setAttribute('role', 'separator');
      el.append(sep);
      return sep;
    }
    const row = document.createElement('div');
    row.className = 'mb-item';
    row.dataset.id = item.id;
    const enabled = isEnabled(item, ctx);
    const checkable = typeof item.checked === 'function';
    const checked = checkable && !!item.checked(ctx);
    row.setAttribute('role', checkable ? 'menuitemcheckbox' : 'menuitem');
    if (checkable) row.setAttribute('aria-checked', String(checked));
    if (!enabled) {
      row.classList.add('disabled');
      row.setAttribute('aria-disabled', 'true');
    }
    if (item.comingSoon) {
      row.classList.add('coming-soon');
      row.title = item.hint ? `Em breve — ${item.hint}` : 'Em breve — ainda não disponível no Agzos Code';
    } else if (item.detail) {
      row.title = item.detail;
    }

    const check = document.createElement('span');
    check.className = 'mb-check';
    check.textContent = checked ? '✓' : '';
    const label = document.createElement('span');
    label.className = 'mb-label';
    label.append(labelWithMnemonic(item.label, mn.get(item)?.index));
    const right = document.createElement('span');
    right.className = 'mb-right';
    if (item.comingSoon) {
      const pill = document.createElement('span');
      pill.className = 'mb-soon';
      pill.textContent = 'Em breve';
      right.append(pill);
    } else if (item.submenu) {
      row.classList.add('has-submenu');
      row.setAttribute('aria-haspopup', 'menu');
      right.classList.add('mb-arrow');
      right.textContent = '›';
    } else {
      right.classList.add('mb-accel');
      right.textContent = accelLabel(resolveAccel(item.accel, ctx.platform), isMac);
    }
    row.append(check, label, right);

    row.addEventListener('mouseenter', () => onHover(el, idx));
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      activate(el, idx, { viaMouse: true });
    });
    el.append(row);
    return row;
  });
  return { el, items, rows, active: -1, mnemonics: mn };
}

function place(el, { left, top, alignRightOf } = {}) {
  document.body.append(el);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = el.getBoundingClientRect();
  let x = left;
  let y = top;
  if (x + r.width > vw - 4) x = alignRightOf != null ? Math.max(4, alignRightOf - r.width) : Math.max(4, vw - r.width - 4);
  if (y + r.height > vh - 4) y = Math.max(4, vh - r.height - 4);
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

/* -------------------------------------------------------------------------- */
/*  Abrir / fechar                                                             */
/* -------------------------------------------------------------------------- */
function closePanelsFrom(level) {
  clearTimeout(submenuTimer);
  while (panels.length > level) {
    const p = panels.pop();
    p.el.remove();
    if (p.parentRow) {
      p.parentRow.classList.remove('open');
      p.parentRow.setAttribute('aria-expanded', 'false');
    }
  }
}

function openMenu(i, { keyboard = false, focusFirst = false } = {}) {
  const menu = MENUS[i];
  if (!menu) return;
  if (!isOpen() && !bar.contains(document.activeElement)) rememberFocus();
  closePanelsFrom(0);
  titles.forEach((t, j) => {
    t.classList.toggle('open', j === i);
    t.setAttribute('aria-expanded', String(j === i));
  });
  openIndex = i;
  focusIndex = i;
  keyboardMode = keyboard;
  bar.classList.toggle('mb-keyboard', keyboardMode);
  const ctx = buildContext();
  const panel = renderPanel(expand(menu.items, ctx), ctx);
  panel.el.id = 'menubar-dropdown';
  const r = titles[i].getBoundingClientRect();
  place(panel.el, { left: r.left, top: r.bottom + 2 });
  panels = [panel];
  if (focusFirst) setActive(panel, nextIndex(panel.items, -1, 1));
  // Recentes podem ter mudado no main (workspace:open): atualiza e redesenha
  if (menu.id === 'file') refreshRecent(i);
}

async function refreshRecent(i) {
  try {
    const s = await window.agzos.settings.load();
    const fresh = Array.isArray(s?.recentFolders) ? s.recentFolders : [];
    const before = JSON.stringify(State.settings.recentFolders || []);
    if (JSON.stringify(fresh) === before) return;
    State.settings.recentFolders = fresh;
    if (openIndex === i && panels.length === 1) {
      const active = panels[0].active;
      openMenu(i, { keyboard: keyboardMode });
      if (active >= 0) setActive(panels[0], active);
    }
  } catch { /* sem settings: mantém a lista atual */ }
}

function openSubmenu(level, idx, { focusFirst = false } = {}) {
  const parent = panels[level];
  const item = parent?.items[idx];
  if (!item?.submenu || !isEnabled(item, buildContext())) return;
  if (panels[level + 1]?.parentIndex === idx) {
    if (focusFirst) setActive(panels[level + 1], nextIndex(panels[level + 1].items, -1, 1));
    return;
  }
  closePanelsFrom(level + 1);
  const ctx = buildContext();
  const panel = renderPanel(expand(item.submenu, ctx), ctx);
  panel.el.classList.add('mb-submenu');
  panel.parentIndex = idx;
  panel.parentRow = parent.rows[idx];
  panel.parentRow.classList.add('open');
  panel.parentRow.setAttribute('aria-expanded', 'true');
  const rr = panel.parentRow.getBoundingClientRect();
  const pr = parent.el.getBoundingClientRect();
  place(panel.el, { left: pr.right - 2, top: rr.top - 5, alignRightOf: pr.left + 2 });
  panels.push(panel);
  if (focusFirst) setActive(panel, nextIndex(panel.items, -1, 1));
}

function rememberFocus() {
  const el = document.activeElement;
  restoreFocusEl = el && el !== document.body && !bar.contains(el) ? el : null;
}

function restoreFocus() {
  const el = restoreFocusEl;
  restoreFocusEl = null;
  if (el && document.contains(el) && typeof el.focus === 'function') el.focus();
  else if (bar.contains(document.activeElement)) document.activeElement.blur();
}

/** Fecha menus e tira o foco da barra. */
export function close({ restore = true } = {}) {
  closePanelsFrom(0);
  openIndex = -1;
  focusIndex = -1;
  keyboardMode = false;
  if (!bar) return;
  bar.classList.remove('mb-keyboard', 'mb-focused');
  titles.forEach((t) => {
    t.classList.remove('open', 'focused');
    t.setAttribute('aria-expanded', 'false');
  });
  if (restore) restoreFocus();
  else restoreFocusEl = null;
}

/** Alt sozinho: foca o primeiro título (sem abrir o menu). */
function focusBar(i = 0) {
  if (!bar.contains(document.activeElement)) rememberFocus();
  closePanelsFrom(0);
  openIndex = -1;
  keyboardMode = true;
  focusIndex = i;
  bar.classList.add('mb-keyboard', 'mb-focused');
  titles.forEach((t, j) => {
    t.classList.toggle('focused', j === i);
    t.classList.remove('open');
    t.setAttribute('aria-expanded', 'false');
  });
  titles[i].focus({ preventScroll: true });
}

/* -------------------------------------------------------------------------- */
/*  Itens                                                                      */
/* -------------------------------------------------------------------------- */
function setActive(panel, idx) {
  panel.rows.forEach((row, j) => row.classList?.toggle('active', j === idx));
  panel.active = idx;
  panel.rows[idx]?.scrollIntoView?.({ block: 'nearest' });
}

function onHover(el, idx) {
  const level = panels.findIndex((p) => p.el === el);
  if (level < 0) return;
  const panel = panels[level];
  const item = panel.items[idx];
  if (!isSelectable(item)) return;
  setActive(panel, idx);
  clearTimeout(submenuTimer);
  if (item.submenu) {
    submenuTimer = setTimeout(() => openSubmenu(level, idx), 120);
  } else if (panels.length > level + 1) {
    submenuTimer = setTimeout(() => closePanelsFrom(level + 1), 200);
  }
}

function activate(el, idx, { viaMouse = false } = {}) {
  const level = panels.findIndex((p) => p.el === el);
  if (level < 0) return;
  const item = panels[level].items[idx];
  if (!isSelectable(item)) return;
  const ctx = buildContext();
  if (item.submenu) {
    openSubmenu(level, idx, { focusFirst: !viaMouse });
    return;
  }
  if (!isEnabled(item, ctx) || !item.run) return; // Em breve / desabilitado: não executa
  execute(item);
}

function execute(item) {
  close({ restore: true });
  const run = item.run;
  if (typeof run === 'function') { run(); return; }
  if (run.startsWith('monaco:')) runMonacoAction(run.slice('monaco:'.length));
  else runCommand(run, ...(item.args || []));
}

/* -------------------------------------------------------------------------- */
/*  Teclado                                                                    */
/* -------------------------------------------------------------------------- */
function stop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
}

function onMenuKey(e) {
  const level = panels.length - 1;
  const panel = panels[level];
  const key = e.key;
  if (key === 'Escape') {
    stop(e);
    if (panels.length > 1) {
      closePanelsFrom(level);
      return;
    }
    // Esc com menu aberto pelo teclado volta para a barra; pelo mouse, fecha tudo
    if (keyboardMode) focusBar(openIndex);
    else close();
    return;
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    stop(e);
    keyboardMode = true;
    panels.forEach((p) => p.el.classList.add('mb-keyboard'));
    bar.classList.add('mb-keyboard');
    setActive(panel, nextIndex(panel.items, panel.active, key === 'ArrowDown' ? 1 : -1));
    return;
  }
  if (key === 'ArrowRight') {
    stop(e);
    const item = panel.items[panel.active];
    if (item?.submenu) { openSubmenu(level, panel.active, { focusFirst: true }); return; }
    openMenu((openIndex + 1) % MENUS.length, { keyboard: true, focusFirst: true });
    return;
  }
  if (key === 'ArrowLeft') {
    stop(e);
    if (panels.length > 1) { closePanelsFrom(level); return; }
    openMenu((openIndex - 1 + MENUS.length) % MENUS.length, { keyboard: true, focusFirst: true });
    return;
  }
  if (key === 'Home' || key === 'End') {
    stop(e);
    setActive(panel, nextIndex(panel.items, key === 'Home' ? -1 : 0, key === 'Home' ? 1 : -1));
    return;
  }
  if (key === 'Enter' || key === ' ') {
    stop(e);
    if (panel.active >= 0) activate(panel.el, panel.active);
    return;
  }
  if (key === 'Tab') {
    stop(e);
    close();
    return;
  }
  if (key === 'Alt') {
    stop(e);
    return;
  }
  // Alt+letra com menu aberto: troca de menu
  const top = isMenuMnemonicKey(e);
  if (top) {
    const i = MENUS.findIndex((m) => m.mnemonic.toLowerCase() === top);
    if (i >= 0) {
      stop(e);
      altArmed = false;
      openMenu(i, { keyboard: true, focusFirst: true });
      return;
    }
  }
  // Letra sublinhada no menu aberto
  const letter = /^[a-z]$/i.test(key) ? key.toLowerCase() : (/^Key([A-Z])$/.exec(e.code || '')?.[1]?.toLowerCase() || null);
  if (letter && !e.ctrlKey && !e.metaKey) {
    stop(e);
    for (const [item, m] of panel.mnemonics) {
      if (m.letter !== letter) continue;
      const idx = panel.items.indexOf(item);
      setActive(panel, idx);
      activate(panel.el, idx);
      break;
    }
    return;
  }
  // Qualquer outro atalho com menu aberto: fecha e deixa seguir
  if (e.ctrlKey || e.metaKey) close();
}

function onBarKey(e) {
  const key = e.key;
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    stop(e);
    const n = MENUS.length;
    focusBar((focusIndex + (key === 'ArrowRight' ? 1 : -1) + n) % n);
    return;
  }
  if (key === 'ArrowDown' || key === 'Enter' || key === ' ' || key === 'ArrowUp') {
    stop(e);
    openMenu(focusIndex, { keyboard: true, focusFirst: true });
    return;
  }
  if (key === 'Escape' || key === 'Tab') {
    stop(e);
    close();
    return;
  }
  if (key === 'Alt') return;
  const letter = /^[a-z]$/i.test(key) ? key.toLowerCase() : null;
  if (letter && !e.ctrlKey && !e.metaKey) {
    const i = MENUS.findIndex((m) => m.mnemonic.toLowerCase() === letter);
    stop(e);
    if (i >= 0) openMenu(i, { keyboard: true, focusFirst: true });
    return;
  }
  close();
}

function onKeyDown(e) {
  if (!bar || bar.hidden) return;
  if (e.key !== 'Alt') altArmed = false;
  else if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat) altArmed = true;

  if (isOpen()) { onMenuKey(e); return; }
  if (focusIndex >= 0 && bar.contains(document.activeElement)) { onBarKey(e); return; }

  if (blocked() || inTerminal(e.target)) return;
  const letter = isMenuMnemonicKey(e);
  if (!letter) return;
  const i = MENUS.findIndex((m) => m.mnemonic.toLowerCase() === letter);
  if (i < 0) return;
  stop(e);
  altArmed = false;
  openMenu(i, { keyboard: true, focusFirst: true });
}

function onKeyUp(e) {
  if (!bar || bar.hidden || e.key !== 'Alt') return;
  const armed = altArmed;
  altArmed = false;
  if (!armed || blocked() || inTerminal(e.target)) return;
  stop(e);
  if (isOpen() || focusIndex >= 0) close();
  else focusBar(0);
}

function onPointerDown(e) {
  altArmed = false;
  if (!isOpen() && focusIndex < 0) return;
  const t = e.target;
  if (bar.contains(t) || panels.some((p) => p.el.contains(t))) return;
  close({ restore: false });
}

/* -------------------------------------------------------------------------- */
/*  Setup                                                                      */
/* -------------------------------------------------------------------------- */
/**
 * Monta a barra em #menubar. `visible=false` (macOS) só esconde o elemento.
 */
export function setupMenubar({ visible = true } = {}) {
  bar = document.getElementById('menubar');
  if (!bar) return null;
  if (!visible) {
    bar.hidden = true;
    return null;
  }
  bar.hidden = false;
  document.body.classList.add('has-menubar');
  renderTitles();
  // Captura em window: roda antes dos atalhos globais (document, captura) e do Monaco
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('mousedown', onPointerDown, true);
  window.addEventListener('blur', () => { altArmed = false; if (isOpen() || focusIndex >= 0) close({ restore: false }); });
  window.addEventListener('resize', () => { if (isOpen()) close({ restore: false }); });
  return { open: (id) => openMenu(MENUS.findIndex((m) => m.id === id)), close };
}
