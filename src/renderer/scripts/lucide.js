/**
 * Lucide icons — helper.
 *
 * O sprite é carregado como <script src="vendor/lucide/inline.js"></script>
 * no index.html, que injeta os <symbol> no <body> antes do app.js rodar.
 * Aqui só checamos se já está carregado e expomos:
 *   - lucideIcon(name, opts) → cria <svg><use href="#name"/></svg>
 *   - lucideIcon.replace(el, name, opts)
 *   - lucideIcon.ready → Promise (resolve imediato se sprite já tá, ou espera)
 */

let spriteReady = null;

function checkSpriteInDom() {
  return !!document.getElementById('lucide-sprite');
}

function waitForSprite(timeoutMs = 2000) {
  if (spriteReady) return spriteReady;
  spriteReady = new Promise((resolve) => {
    if (checkSpriteInDom()) { resolve(); return; }
    const start = Date.now();
    const tick = () => {
      if (checkSpriteInDom() || Date.now() - start > timeoutMs) { resolve(); return; }
      setTimeout(tick, 20);
    };
    tick();
  });
  return spriteReady;
}

/**
 * Cria um <svg> que referencia um <symbol> do sprite.
 * @param {string} name  nome do ícone (kebab-case: "folder", "git-branch", "panel-left-close")
 * @param {object} [opts] { size, strokeWidth, className, title }
 * @returns {SVGElement}
 */
function icon(name, opts = {}) {
  const size = opts.size || 18;
  const sw = opts.strokeWidth || 2;
  const cls = opts.className || '';
  const title = opts.title || '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(sw));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (title) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = title;
    svg.appendChild(t);
  }
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.appendChild(use);
  return svg;
}

function replace(el, name, opts) {
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(icon(name, opts));
}

export const lucideIcon = Object.assign(icon, {
  replace,
  ready: waitForSprite,
});
window.lucideIcon = lucideIcon;
