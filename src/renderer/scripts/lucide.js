/**
 * Lucide icons — helper.
 *
 * Carrega o sprite SVG do Lucide e expõe:
 *   - lucideIcon(name, options) → cria <svg><use href="#name"/></svg>
 *   - lucideIcon.replace(el, name, options) → troca conteúdo de um elemento
 *   - lucideIcon.ready → Promise que resolve quando o sprite está no DOM
 *
 * O sprite é injetado uma vez no <body> como um <svg> invisível.
 */

const LUCIDE_PATH = 'vendor/lucide/sprite.svg';

let readyPromise = null;

function ensureSprite() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    // Tenta via fetch primeiro (CSP restritiva bloqueia? cai pro fallback)
    let svgText = null;
    try {
      const res = await fetch(LUCIDE_PATH);
      if (res.ok) svgText = await res.text();
    } catch {}
    if (!svgText) {
      // Fallback: usa XMLHttpRequest
      svgText = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', LUCIDE_PATH, true);
        xhr.onload = () => resolve(xhr.responseText);
        xhr.onerror = () => reject(new Error('Falha ao carregar sprite do Lucide'));
        xhr.send();
      });
    }
    // Extrai <defs>...</defs> do sprite e injeta no DOM
    const m = svgText.match(/<defs>([\s\S]*?)<\/defs>/);
    if (!m) {
      console.error('[Lucide] Sprite não contém <defs>');
      return;
    }
    const container = document.createElement('div');
    container.id = 'lucide-sprite';
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    // Container SVG invisível com os <symbol>s
    container.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${m[1]}</svg>`;
    document.body.insertBefore(container, document.body.firstChild);
  })();
  return readyPromise;
}

/**
 * Cria um <svg> que referencia um <symbol> do sprite carregado.
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
  svg.setAttribute('class', `icon ${cls}`);
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

export const lucideIcon = Object.assign(icon, { replace, ready: ensureSprite });
window.lucideIcon = lucideIcon; // expõe global pra uso em handlers inline
