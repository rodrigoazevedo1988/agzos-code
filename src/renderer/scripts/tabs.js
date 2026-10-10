/**
 * Tabs — gerencia as abas de arquivos abertos.
 */

import { openFile, closeTab } from './editor.js';
import { renderTabIcon } from './icon-theme.js';

const State = window.AgzosState;

export function renderTabs() {
  const host = document.getElementById('tabs');
  if (!host) return;
  host.replaceChildren();
  for (const [path, file] of State.files) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (file.dirty ? ' dirty' : '') + (State.activePath === path ? ' active' : '');
    tab.dataset.path = path;

    const icon = renderTabIcon(basename(path), State.settings?.iconTheme);
    tab.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = basename(path);
    label.title = path;
    tab.appendChild(label);

    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(path);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => {
      if (State.activePath !== path) openFile(path);
    });

    tab.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // middle click
        e.preventDefault();
        closeTab(path);
      }
    });

    host.appendChild(tab);
  }
}

export function focusTab(filePath) {
  renderTabs();
  const el = document.querySelector(`.tab[data-path="${cssEscape(filePath)}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}
function cssEscape(s) { return s.replace(/[\\"]/g, '\\$&'); }
