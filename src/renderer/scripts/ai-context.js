/** Build the private system message that carries editor and terminal context. */
export function buildContextMessage({ file, selection, terminal } = {}, {
  maxFileChars = 20000,
  maxTerminalChars = 4000,
} = {}) {
  const sections = [];

  if (file && typeof file.content === 'string' && file.content.length) {
    const content = truncate(file.content, maxFileChars);
    const language = String(file.language || '');
    sections.push(`### Arquivo: ${file.path || 'sem nome'} (${language})\n\n\`\`\`${language}\n${content}\n\`\`\``);
  }

  if (selection && typeof selection.text === 'string' && selection.text.length) {
    const start = Number.isFinite(selection.startLine) ? selection.startLine : '?';
    const end = Number.isFinite(selection.endLine) ? selection.endLine : start;
    sections.push(`### Seleção (linhas ${start}–${end})\n\n${selection.text}`);
  }

  if (typeof terminal === 'string' && terminal.length) {
    sections.push(`### Saída recente do terminal\n\n${truncate(terminal, maxTerminalChars)}`);
  }

  return sections.length ? sections.join('\n\n') : null;
}

function truncate(value, maxChars) {
  const limit = Math.max(0, Number.isFinite(maxChars) ? Math.floor(maxChars) : value.length);
  return value.length > limit ? `${value.slice(0, limit)}… (truncado)` : value;
}
