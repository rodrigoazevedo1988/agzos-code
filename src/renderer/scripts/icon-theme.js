/**
 * Icon Theme system for Agzos Code.
 * Supports:
 *  - 'lucide-color': Modern Lucide SVG icons with language-specific colors
 *  - 'lucide-minimal': Clean monochrome Lucide outline icons
 *  - 'badges': Compact technical badge chips (Seti style)
 *  - 'emoji': Classic expressive emojis
 */

import { lucideIcon } from './lucide.js';

export const ICON_THEMES = [
  { id: 'lucide-color', label: 'Lucide Moderno (Colorido)' },
  { id: 'lucide-minimal', label: 'Lucide Minimalista' },
  { id: 'badges', label: 'Badges Técnicos (Seti)' },
  { id: 'emoji', label: 'Emoji Clássico' },
];

export const SPECIAL_FOLDERS = {
  '.git': { icon: 'folder-git', color: '#f05032' },
  '.github': { icon: 'folder-git', color: '#f05032' },
  'node_modules': { icon: 'folder-code', color: '#64748b' },
  'src': { icon: 'folder-code', color: '#38bdf8' },
  'lib': { icon: 'folder-code', color: '#38bdf8' },
  'app': { icon: 'folder-code', color: '#38bdf8' },
  'test': { icon: 'folder-check', color: '#10b981' },
  'tests': { icon: 'folder-check', color: '#10b981' },
  '__tests__': { icon: 'folder-check', color: '#10b981' },
  'dist': { icon: 'folder-archive', color: '#a855f7' },
  'build': { icon: 'folder-archive', color: '#a855f7' },
  'out': { icon: 'folder-archive', color: '#a855f7' },
  'docs': { icon: 'folder-bookmark', color: '#3b82f6' },
  'doc': { icon: 'folder-bookmark', color: '#3b82f6' },
  '.vscode': { icon: 'folder-cog', color: '#0284c7' },
  'tools': { icon: 'folder-cog', color: '#f59e0b' },
};

export const FILE_MAP = {
  // JavaScript / TypeScript
  js: { icon: 'file-code', color: '#f7df1e', badge: 'JS', badgeBg: '#f7df1e', badgeFg: '#18181b', emoji: '🟨' },
  mjs: { icon: 'file-code', color: '#f7df1e', badge: 'MJS', badgeBg: '#f7df1e', badgeFg: '#18181b', emoji: '🟨' },
  cjs: { icon: 'file-code', color: '#f7df1e', badge: 'CJS', badgeBg: '#f7df1e', badgeFg: '#18181b', emoji: '🟨' },
  ts: { icon: 'file-code', color: '#3178c6', badge: 'TS', badgeBg: '#3178c6', badgeFg: '#ffffff', emoji: '🟦' },
  mts: { icon: 'file-code', color: '#3178c6', badge: 'MTS', badgeBg: '#3178c6', badgeFg: '#ffffff', emoji: '🟦' },
  cts: { icon: 'file-code', color: '#3178c6', badge: 'CTS', badgeBg: '#3178c6', badgeFg: '#ffffff', emoji: '🟦' },
  jsx: { icon: 'file-code', color: '#00bcd4', badge: 'JSX', badgeBg: '#00bcd4', badgeFg: '#18181b', emoji: '⚛️' },
  tsx: { icon: 'file-code', color: '#00bcd4', badge: 'TSX', badgeBg: '#00bcd4', badgeFg: '#18181b', emoji: '⚛️' },

  // Web
  html: { icon: 'globe', color: '#e44d26', badge: 'HTML', badgeBg: '#e44d26', badgeFg: '#ffffff', emoji: '🌐' },
  htm: { icon: 'globe', color: '#e44d26', badge: 'HTM', badgeBg: '#e44d26', badgeFg: '#ffffff', emoji: '🌐' },
  css: { icon: 'palette', color: '#264de4', badge: 'CSS', badgeBg: '#264de4', badgeFg: '#ffffff', emoji: '🎨' },
  scss: { icon: 'palette', color: '#ec4899', badge: 'SCSS', badgeBg: '#ec4899', badgeFg: '#ffffff', emoji: '🎨' },
  sass: { icon: 'palette', color: '#ec4899', badge: 'SASS', badgeBg: '#ec4899', badgeFg: '#ffffff', emoji: '🎨' },
  less: { icon: 'palette', color: '#1d365d', badge: 'LESS', badgeBg: '#1d365d', badgeFg: '#ffffff', emoji: '🎨' },

  // Data / Config
  json: { icon: 'braces', color: '#22c55e', badge: 'JSON', badgeBg: '#16a34a', badgeFg: '#ffffff', emoji: '🟩' },
  jsonc: { icon: 'braces', color: '#22c55e', badge: 'JSON', badgeBg: '#16a34a', badgeFg: '#ffffff', emoji: '🟩' },
  json5: { icon: 'braces', color: '#22c55e', badge: 'JSON5', badgeBg: '#16a34a', badgeFg: '#ffffff', emoji: '🟩' },
  yml: { icon: 'file-cog', color: '#ef4444', badge: 'YML', badgeBg: '#ef4444', badgeFg: '#ffffff', emoji: '⚙️' },
  yaml: { icon: 'file-cog', color: '#ef4444', badge: 'YAML', badgeBg: '#ef4444', badgeFg: '#ffffff', emoji: '⚙️' },
  toml: { icon: 'file-cog', color: '#94a3b8', badge: 'TOML', badgeBg: '#64748b', badgeFg: '#ffffff', emoji: '⚙️' },
  ini: { icon: 'file-cog', color: '#94a3b8', badge: 'INI', badgeBg: '#64748b', badgeFg: '#ffffff', emoji: '⚙️' },
  conf: { icon: 'file-cog', color: '#94a3b8', badge: 'CONF', badgeBg: '#64748b', badgeFg: '#ffffff', emoji: '⚙️' },
  cfg: { icon: 'file-cog', color: '#94a3b8', badge: 'CFG', badgeBg: '#64748b', badgeFg: '#ffffff', emoji: '⚙️' },
  xml: { icon: 'file-code', color: '#f59e0b', badge: 'XML', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '📰' },

  // Docs
  md: { icon: 'file-text', color: '#06b6d4', badge: 'MD', badgeBg: '#0891b2', badgeFg: '#ffffff', emoji: '📝' },
  markdown: { icon: 'file-text', color: '#06b6d4', badge: 'MD', badgeBg: '#0891b2', badgeFg: '#ffffff', emoji: '📝' },
  mdx: { icon: 'file-text', color: '#06b6d4', badge: 'MDX', badgeBg: '#0891b2', badgeFg: '#ffffff', emoji: '📝' },
  txt: { icon: 'file-text', color: '#94a3b8', badge: 'TXT', badgeBg: '#64748b', badgeFg: '#ffffff', emoji: '📄' },
  pdf: { icon: 'file-text', color: '#ef4444', badge: 'PDF', badgeBg: '#dc2626', badgeFg: '#ffffff', emoji: '📕' },
  doc: { icon: 'file-text', color: '#3b82f6', badge: 'DOC', badgeBg: '#2563eb', badgeFg: '#ffffff', emoji: '📘' },
  docx: { icon: 'file-text', color: '#3b82f6', badge: 'DOCX', badgeBg: '#2563eb', badgeFg: '#ffffff', emoji: '📘' },

  // Programming languages
  py: { icon: 'file-code', color: '#38bdf8', badge: 'PY', badgeBg: '#2563eb', badgeFg: '#ffffff', emoji: '🐍' },
  ipynb: { icon: 'file-code', color: '#f97316', badge: 'NB', badgeBg: '#ea580c', badgeFg: '#ffffff', emoji: '📓' },
  rs: { icon: 'file-code', color: '#ea580c', badge: 'RS', badgeBg: '#ea580c', badgeFg: '#ffffff', emoji: '🦀' },
  go: { icon: 'file-code', color: '#00add8', badge: 'GO', badgeBg: '#0284c7', badgeFg: '#ffffff', emoji: '🐹' },
  java: { icon: 'file-code', color: '#f59e0b', badge: 'JAVA', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '☕' },
  jar: { icon: 'file-archive', color: '#f59e0b', badge: 'JAR', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '☕' },
  c: { icon: 'file-code', color: '#5555ff', badge: 'C', badgeBg: '#4f46e5', badgeFg: '#ffffff', emoji: '⚙️' },
  cpp: { icon: 'file-code', color: '#5555ff', badge: 'C++', badgeBg: '#4f46e5', badgeFg: '#ffffff', emoji: '⚙️' },
  cc: { icon: 'file-code', color: '#5555ff', badge: 'C++', badgeBg: '#4f46e5', badgeFg: '#ffffff', emoji: '⚙️' },
  h: { icon: 'file-code', color: '#a855f7', badge: 'H', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '⚙️' },
  hpp: { icon: 'file-code', color: '#a855f7', badge: 'HPP', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '⚙️' },
  cs: { icon: 'file-code', color: '#178600', badge: 'C#', badgeBg: '#15803d', badgeFg: '#ffffff', emoji: '🔷' },
  php: { icon: 'file-code', color: '#818cf8', badge: 'PHP', badgeBg: '#6366f1', badgeFg: '#ffffff', emoji: '🐘' },
  rb: { icon: 'file-code', color: '#ef4444', badge: 'RB', badgeBg: '#dc2626', badgeFg: '#ffffff', emoji: '💎' },
  swift: { icon: 'file-code', color: '#f05138', badge: 'SW', badgeBg: '#ea580c', badgeFg: '#ffffff', emoji: '🍎' },
  kt: { icon: 'file-code', color: '#a855f7', badge: 'KT', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '🟣' },

  // Shell scripts
  sh: { icon: 'file-terminal', color: '#10b981', badge: 'SH', badgeBg: '#059669', badgeFg: '#ffffff', emoji: '🐚' },
  bash: { icon: 'file-terminal', color: '#10b981', badge: 'BASH', badgeBg: '#059669', badgeFg: '#ffffff', emoji: '🐚' },
  zsh: { icon: 'file-terminal', color: '#10b981', badge: 'ZSH', badgeBg: '#059669', badgeFg: '#ffffff', emoji: '🐚' },
  fish: { icon: 'file-terminal', color: '#10b981', badge: 'FISH', badgeBg: '#059669', badgeFg: '#ffffff', emoji: '🐚' },
  bat: { icon: 'file-terminal', color: '#38bdf8', badge: 'BAT', badgeBg: '#0284c7', badgeFg: '#ffffff', emoji: '🔵' },
  cmd: { icon: 'file-terminal', color: '#38bdf8', badge: 'CMD', badgeBg: '#0284c7', badgeFg: '#ffffff', emoji: '🔵' },
  ps1: { icon: 'file-terminal', color: '#38bdf8', badge: 'PS1', badgeBg: '#0284c7', badgeFg: '#ffffff', emoji: '🔵' },

  // Images
  png: { icon: 'file-image', color: '#a855f7', badge: 'PNG', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '🖼️' },
  jpg: { icon: 'file-image', color: '#a855f7', badge: 'JPG', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '🖼️' },
  jpeg: { icon: 'file-image', color: '#a855f7', badge: 'JPEG', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '🖼️' },
  gif: { icon: 'file-image', color: '#a855f7', badge: 'GIF', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '🖼️' },
  svg: { icon: 'file-image', color: '#f59e0b', badge: 'SVG', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '🖼️' },
  ico: { icon: 'file-image', color: '#a855f7', badge: 'ICO', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '🖼️' },
  webp: { icon: 'file-image', color: '#a855f7', badge: 'WEBP', badgeBg: '#9333ea', badgeFg: '#ffffff', emoji: '🖼️' },

  // Media
  mp3: { icon: 'file-play', color: '#ec4899', badge: 'MP3', badgeBg: '#db2777', badgeFg: '#ffffff', emoji: '🎵' },
  wav: { icon: 'file-play', color: '#ec4899', badge: 'WAV', badgeBg: '#db2777', badgeFg: '#ffffff', emoji: '🎵' },
  mp4: { icon: 'file-play', color: '#ec4899', badge: 'MP4', badgeBg: '#db2777', badgeFg: '#ffffff', emoji: '🎬' },
  webm: { icon: 'file-play', color: '#ec4899', badge: 'WEBM', badgeBg: '#db2777', badgeFg: '#ffffff', emoji: '🎬' },

  // Spreadsheets
  xls: { icon: 'file-spreadsheet', color: '#10b981', badge: 'XLS', badgeBg: '#059669', badgeFg: '#ffffff', emoji: '📗' },
  xlsx: { icon: 'file-spreadsheet', color: '#10b981', badge: 'XLSX', badgeBg: '#059669', badgeFg: '#ffffff', emoji: '📗' },
  csv: { icon: 'file-spreadsheet', color: '#10b981', badge: 'CSV', badgeBg: '#059669', badgeFg: '#ffffff', emoji: '📗' },

  // Archives
  zip: { icon: 'file-archive', color: '#f59e0b', badge: 'ZIP', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '🗜️' },
  tar: { icon: 'file-archive', color: '#f59e0b', badge: 'TAR', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '🗜️' },
  gz: { icon: 'file-archive', color: '#f59e0b', badge: 'GZ', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '🗜️' },
  rar: { icon: 'file-archive', color: '#f59e0b', badge: 'RAR', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '🗜️' },
  '7z': { icon: 'file-archive', color: '#f59e0b', badge: '7Z', badgeBg: '#d97706', badgeFg: '#ffffff', emoji: '🗜️' },

  // Database
  sql: { icon: 'database', color: '#eab308', badge: 'SQL', badgeBg: '#ca8a04', badgeFg: '#ffffff', emoji: '🗄️' },
  sqlite: { icon: 'database', color: '#eab308', badge: 'DB', badgeBg: '#ca8a04', badgeFg: '#ffffff', emoji: '🗄️' },
  db: { icon: 'database', color: '#eab308', badge: 'DB', badgeBg: '#ca8a04', badgeFg: '#ffffff', emoji: '🗄️' },
};

export const SPECIAL_FILES = {
  '.gitignore': { icon: 'git-branch', color: '#f05032', badge: 'GIT', badgeBg: '#f05032', badgeFg: '#ffffff', emoji: '⚪' },
  '.gitattributes': { icon: 'git-branch', color: '#f05032', badge: 'GIT', badgeBg: '#f05032', badgeFg: '#ffffff', emoji: '⚪' },
  '.gitmodules': { icon: 'git-branch', color: '#f05032', badge: 'GIT', badgeBg: '#f05032', badgeFg: '#ffffff', emoji: '⚪' },
  'package.json': { icon: 'package', color: '#e11d48', badge: 'PKG', badgeBg: '#e11d48', badgeFg: '#ffffff', emoji: '📦' },
  'package-lock.json': { icon: 'lock', color: '#94a3b8', badge: 'LOCK', badgeBg: '#64748b', badgeFg: '#ffffff', emoji: '🔒' },
  'cargo.toml': { icon: 'package', color: '#ea580c', badge: 'PKG', badgeBg: '#ea580c', badgeFg: '#ffffff', emoji: '📦' },
  'composer.json': { icon: 'package', color: '#818cf8', badge: 'PKG', badgeBg: '#6366f1', badgeFg: '#ffffff', emoji: '📦' },
  'dockerfile': { icon: 'layers', color: '#38bdf8', badge: 'DOCK', badgeBg: '#0284c7', badgeFg: '#ffffff', emoji: '🐳' },
  'license': { icon: 'shield', color: '#eab308', badge: 'LIC', badgeBg: '#ca8a04', badgeFg: '#ffffff', emoji: '📜' },
};

export function getFileIconMeta(fileName = '') {
  const lowerName = fileName.toLowerCase();
  const ext = (lowerName.split('.').pop() || '').toLowerCase();

  let spec = SPECIAL_FILES[lowerName];
  if (!spec && lowerName.startsWith('.env')) {
    spec = { icon: 'file-key', color: '#eab308', badge: 'ENV', badgeBg: '#ca8a04', badgeFg: '#ffffff', emoji: '🔐' };
  }
  if (!spec && lowerName.startsWith('license')) {
    spec = { icon: 'shield', color: '#eab308', badge: 'LIC', badgeBg: '#ca8a04', badgeFg: '#ffffff', emoji: '📜' };
  }
  if (!spec && ext) {
    spec = FILE_MAP[ext];
  }
  if (!spec) {
    spec = {
      icon: 'file',
      color: '#94a3b8',
      badge: ext ? ext.slice(0, 4).toUpperCase() : 'FILE',
      badgeBg: '#475569',
      badgeFg: '#e2e8f0',
      emoji: '📄',
    };
  }
  return spec;
}

export function getFolderIconMeta(isExpanded, folderName = '') {
  const lowerName = folderName.toLowerCase();
  const special = SPECIAL_FOLDERS[lowerName];

  let iconName = isExpanded ? 'folder-open' : 'folder';
  let color = '#eab308';

  if (special) {
    iconName = isExpanded && special.icon === 'folder' ? 'folder-open' : special.icon;
    color = special.color;
  }

  return {
    icon: iconName,
    color,
    emoji: isExpanded ? '📂' : '📁',
  };
}

export function renderFolderIcon(isExpanded, folderName = '', theme = 'lucide-color') {
  const span = document.createElement('span');
  span.className = 'tree-icon';

  if (theme === 'emoji') {
    span.classList.add('emoji-icon');
    span.textContent = isExpanded ? '📂' : '📁';
    return span;
  }

  span.classList.add('svg-icon');
  const meta = getFolderIconMeta(isExpanded, folderName);

  if (theme === 'lucide-color' && meta.color) {
    span.style.color = meta.color;
  } else if (theme === 'badges') {
    span.style.color = '#f59e0b';
  }

  span.appendChild(lucideIcon(meta.icon, { size: 15, strokeWidth: 1.8 }));
  return span;
}

export function renderFileIcon(fileName = '', theme = 'lucide-color') {
  const span = document.createElement('span');
  span.className = 'tree-icon';

  const meta = getFileIconMeta(fileName);
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  if (theme === 'emoji') {
    span.classList.add('emoji-icon');
    span.textContent = meta.emoji || '📄';
    return span;
  }

  if (theme === 'badges') {
    span.classList.add('tree-badge');
    span.textContent = meta.badge || (ext ? ext.slice(0, 4).toUpperCase() : 'FILE');
    span.style.backgroundColor = meta.badgeBg || '#475569';
    span.style.color = meta.badgeFg || '#ffffff';
    return span;
  }

  span.classList.add('svg-icon');
  if (theme === 'lucide-color' && meta.color) {
    span.style.color = meta.color;
  }
  span.appendChild(lucideIcon(meta.icon || 'file', { size: 15, strokeWidth: 1.8 }));
  return span;
}

export function renderTabIcon(fileName = '', theme = 'lucide-color') {
  const icon = renderFileIcon(fileName, theme);
  icon.classList.add('tab-icon');
  return icon;
}
