/**
 * Importador de configurações do VS Code e Cursor para o Agzos Code.
 * Sem dependência do Electron para facilitar testes unitários.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Remove comentários (// e /* *\/) e trailing commas de um texto JSONC,
 * preservando literais de string (inclusive escapes como \" e \\).
 */
function stripJsonComments(str) {
  const src = String(str);
  const len = src.length;
  let out = '';
  let i = 0;

  while (i < len) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '"') {
      // Copia a string literal inteira, respeitando escapes.
      let j = i + 1;
      while (j < len) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '"') { j += 1; break; }
        j += 1;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? len : end + 2;
      // Mantém separação entre tokens adjacentes.
      out += ' ';
      continue;
    }

    if (ch === ',') {
      // Trailing comma: próximo caractere significativo (fora de comentários) é } ou ].
      let j = i + 1;
      while (j < len) {
        if (/\s/.test(src[j])) { j += 1; continue; }
        if (src[j] === '/' && src[j + 1] === '/') {
          j += 2;
          while (j < len && src[j] !== '\n' && src[j] !== '\r') j += 1;
          continue;
        }
        if (src[j] === '/' && src[j + 1] === '*') {
          const end = src.indexOf('*/', j + 2);
          j = end === -1 ? len : end + 2;
          continue;
        }
        break;
      }
      if (src[j] === '}' || src[j] === ']') {
        i += 1;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

function parseJsonc(content) {
  const sanitized = stripJsonComments(content);
  return JSON.parse(sanitized);
}

function getVSCodeSettingsPath(editor = 'vscode', platform = process.platform, home = os.homedir()) {
  const isCursor = editor === 'cursor';
  const name = isCursor ? 'Cursor' : 'Code';

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', name, 'User', 'settings.json');
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, name, 'User', 'settings.json');
  }
  // Linux e outros
  return path.join(home, '.config', name, 'User', 'settings.json');
}

function mapVSCodeSettings(vscodeSettings) {
  const out = {};
  const importedKeys = [];

  if (!vscodeSettings || typeof vscodeSettings !== 'object') {
    return { mapped: out, importedKeys };
  }

  if (typeof vscodeSettings['editor.fontSize'] === 'number') {
    out.fontSize = vscodeSettings['editor.fontSize'];
    importedKeys.push('fontSize');
  }

  out.editor = {};

  if (typeof vscodeSettings['editor.fontFamily'] === 'string') {
    out.editor.fontFamily = vscodeSettings['editor.fontFamily'];
    importedKeys.push('editor.fontFamily');
  }

  if (typeof vscodeSettings['editor.tabSize'] === 'number') {
    out.editor.tabSize = vscodeSettings['editor.tabSize'];
    importedKeys.push('editor.tabSize');
  }

  if (typeof vscodeSettings['editor.insertSpaces'] === 'boolean') {
    out.editor.insertSpaces = vscodeSettings['editor.insertSpaces'];
    importedKeys.push('editor.insertSpaces');
  }

  if (typeof vscodeSettings['editor.wordWrap'] === 'string') {
    out.editor.wordWrap = vscodeSettings['editor.wordWrap'];
    importedKeys.push('editor.wordWrap');
  }

  if (typeof vscodeSettings['editor.lineNumbers'] === 'string') {
    out.editor.lineNumbers = vscodeSettings['editor.lineNumbers'];
    importedKeys.push('editor.lineNumbers');
  }

  if (vscodeSettings['editor.minimap.enabled'] !== undefined) {
    out.editor.minimap = Boolean(vscodeSettings['editor.minimap.enabled']);
    importedKeys.push('editor.minimap');
  }

  if (typeof vscodeSettings['workbench.colorTheme'] === 'string') {
    const theme = vscodeSettings['workbench.colorTheme'].toLowerCase();
    out.theme = theme.includes('light') ? 'agzos-light' : 'agzos-dark';
    importedKeys.push('theme');
  }

  return { mapped: out, importedKeys };
}

function importFromVSCode({ editor = 'vscode', platform = process.platform, home = os.homedir(), filePath } = {}) {
  const targetPath = filePath || getVSCodeSettingsPath(editor, platform, home);

  if (!fs.existsSync(targetPath)) {
    return { ok: false, reason: 'not_found', path: targetPath, imported: [] };
  }

  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    const parsed = parseJsonc(raw);
    const { mapped, importedKeys } = mapVSCodeSettings(parsed);
    return { ok: true, path: targetPath, mapped, imported: importedKeys };
  } catch (err) {
    return { ok: false, reason: 'parse_error', error: err.message, path: targetPath, imported: [] };
  }
}

module.exports = {
  stripJsonComments,
  parseJsonc,
  getVSCodeSettingsPath,
  mapVSCodeSettings,
  importFromVSCode,
};
