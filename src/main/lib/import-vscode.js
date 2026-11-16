/**
 * Importador de configurações do VS Code e Cursor para o Agzos Code.
 * Sem dependência do Electron para facilitar testes unitários.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function stripJsonComments(str) {
  // Remove comentários de bloco e linha, e trailing commas
  return str
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n\r]*/g, '')
    .replace(/,\s*([}\]])/g, '$1');
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
