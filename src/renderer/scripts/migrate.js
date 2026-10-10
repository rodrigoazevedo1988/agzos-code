/**
 * Migração de outros editores (VS Code, Cursor, Sublime, Atom).
 *
 * Stub: a implementação real é Fase 1 do roadmap.
 * Hoje detecta os paths de configuração e copia o que dá.
 */

import { toast } from './toast.js';

const HOME = window.agzos?.fs?.homeDir ? null : null; // preenchido em runtime

async function getHome() {
  return await window.agzos.fs.homeDir();
}

const EDITOR_PATHS = {
  vscode: {
    darwin: 'Library/Application Support/Code/User',
    win32: 'AppData/Roaming/Code/User',
    linux: '.config/Code/User',
    files: ['settings.json', 'keybindings.json', 'snippets'],
  },
  cursor: {
    darwin: 'Library/Application Support/Cursor/User',
    win32: 'AppData/Roaming/Cursor/User',
    linux: '.config/Cursor/User',
    files: ['settings.json', 'keybindings.json'],
  },
  sublime: {
    darwin: 'Library/Application Support/Sublime Text/Packages/User',
    win32: 'AppData/Roaming/Sublime Text/Packages/User',
    linux: '.config/sublime-text/Packages/User',
    files: ['Preferences.sublime-settings', 'Default (Linux).sublime-keymap'],
  },
  atom: {
    darwin: '.atom',
    win32: '.atom',
    linux: '.atom',
    files: ['config.cson', 'keymap.cson', 'snippets.cson'],
  },
};

function getEditorPath(editor, platform, home) {
  const p = EDITOR_PATHS[editor];
  if (!p) return null;
  const rel = p[platform] || p.linux;
  return `${home}/${rel}`;
}

export async function migrateFrom(editor) {
  const home = await getHome();
  const platform = window.agzos?.app?.info?.()?.platform || 'linux';
  const source = getEditorPath(editor, platform, home);
  if (!source) return false;
  try {
    const exists = await window.agzos.fs.exists(source);
    if (!exists) {
      toast(`Configurações de ${editor} não encontradas em ${source}.`, 'info');
      return false;
    }
    // Stub: apenas confirma que achou. Cópia real fica pra Fase 1.
    toast(`Encontramos configs de ${editor} em ${source}. A importação completa virá na próxima release.`, 'info', 5000);
    return true;
  } catch (e) {
    console.error('migrate error', e);
    return false;
  }
}
