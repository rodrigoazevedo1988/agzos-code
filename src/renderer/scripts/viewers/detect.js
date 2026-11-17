/**
 * Detecção do visualizador por extensão — módulo puro (sem DOM), testável em Node.
 *
 * 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'docx' | 'sheet' | 'external' | 'text'
 *
 * - 'markdown' abre no editor (é texto) com pré-visualização opcional.
 * - 'text' é o padrão: o editor ainda checa se o conteúdo é binário.
 * - 'external': o Chromium não renderiza → tela "Abrir no app padrão".
 */

const GROUPS = {
  image: ['png', 'apng', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'svg'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'weba'],
  pdf: ['pdf'],
  markdown: ['md', 'markdown'],
  docx: ['docx', 'doc', 'odt', 'rtf'],
  sheet: ['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'],
  external: [
    // imagens que o Chromium não decodifica
    'heic', 'heif', 'tiff', 'tif', 'psd', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'xcf', 'ai', 'eps',
    // apresentações
    'pptx', 'ppt', 'odp', 'key', 'pages', 'numbers',
    // compactados, executáveis, fontes, bancos e outros binários comuns
    'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'zst', 'jar', 'war', 'apk', 'aab', 'ipa',
    'exe', 'msi', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'lib', 'class', 'pyc', 'wasm', 'node',
    'dmg', 'iso', 'img', 'deb', 'rpm', 'appimage',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'sqlite', 'sqlite3', 'db', 'mdb', 'accdb',
    'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'wma', 'aiff', 'aif', 'mid', 'midi',
    'blend', 'fbx', 'glb', 'obj3d', 'sketch', 'fig',
  ],
};

const BY_EXT = new Map();
for (const [kind, exts] of Object.entries(GROUPS)) for (const e of exts) BY_EXT.set(e, kind);

/** Extensão em minúsculas ('' se não houver; dotfiles como .env não têm extensão). */
export function extOf(filePath) {
  const base = String(filePath || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function detectViewer(filePath) {
  return BY_EXT.get(extOf(filePath)) || 'text';
}

/** Tipos que abrem numa aba de visualização (sem modelo Monaco). */
export function isViewerKind(kind) {
  return kind !== 'text' && kind !== 'markdown';
}
