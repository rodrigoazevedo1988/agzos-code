/**
 * Exportar conversa do Agzos IA (Markdown e PDF).
 *
 * transcriptMarkdown(conversation, { root, exportedAt, timeZone }) → Markdown estável:
 * título, data, pasta, modos e modelos usados, mensagens do usuário (com anexos por
 * nome) e do assistente, e as ações do agente (ferramenta, título, resultado, +/−
 * linhas, comandos com exit code). Nada é "des-redigido": o que já veio como
 * [redigido] continua assim, e padrões óbvios de chave (sk-…, ghp_…, AKIA…) são
 * mascarados por garantia.
 *
 * transcriptHtml(markdown, title) → documento HTML para o printToPDF. O Markdown é
 * renderizado com marked; HTML cru do conteúdo é escapado (não interpretado) e a
 * janela de impressão roda sem JavaScript, com CSP sem rede.
 */

const { marked } = require('marked');

const MARKER_RE = /\n*<!--agzos-agent (\{[\s\S]*?\})-->\n*/;
const SKILL_LABELS = {
  agent: 'Agente', chat: 'Chat', plan: 'Plan', debugger: 'Debugger de Erros', 'site-builder': 'Criador de Sites', security: 'Cyber Security',
};
const STATUS = { ok: 'ok', error: 'falhou', denied: 'negado', cancelled: 'interrompido', running: 'em andamento', awaiting: 'aguardando' };
const SECRET_PATTERNS = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
];

function redactSecrets(text) {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redigido]');
  return out;
}

function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(ts, timeZone) {
  const d = new Date(Number(ts) || 0);
  if (timeZone === 'UTC') return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeTurn(content) {
  const s = String(content ?? '');
  const match = s.match(MARKER_RE);
  if (!match) return { text: s, turn: null };
  try {
    const turn = JSON.parse(match[1]);
    if (turn && Array.isArray(turn.segments) && turn.steps && typeof turn.steps === 'object') return { text: s.slice(0, match.index), turn };
  } catch { /* marcador corrompido: usa o texto */ }
  return { text: s.replace(MARKER_RE, '\n\n'), turn: null };
}

function relTo(text, root) {
  const s = String(text ?? '');
  if (!root) return s;
  return s.split(`${root.replace(/[\\/]+$/, '')}/`).join('').split(`${root.replace(/[\\/]+$/, '')}\\`).join('');
}

function stepLine(step, root) {
  const meta = step.meta || {};
  const bits = [STATUS[step.status] || step.status || '?'];
  if (Number(meta.added) || Number(meta.removed)) bits.push(`+${Number(meta.added) || 0} −${Number(meta.removed) || 0}`);
  if (meta.created) bits.push('novo');
  if (meta.deleted) bits.push('apagado');
  if (Number.isFinite(meta.exitCode)) bits.push(`exit ${meta.exitCode}`);
  const title = step.tool === 'run_command' ? `$ ${step.input?.command ?? step.title ?? ''}` : relTo(step.title || step.tool, root);
  const summary = step.summary && !/^(ok)?$/i.test(step.summary) ? ` — ${relTo(step.summary, root).replace(/\s+/g, ' ').slice(0, 200)}` : '';
  return `- \`${step.tool}\` · ${title.replace(/`/g, "'")} — ${bits.join(', ')}${summary}`;
}

function turnMarkdown(turn, root) {
  const out = [];
  let actions = [];
  const flush = () => {
    if (!actions.length) return;
    out.push(`**Ações do agente**\n\n${actions.join('\n')}`);
    actions = [];
  };
  for (const seg of turn.segments) {
    if (seg.t === 'text') { flush(); if (seg.text?.trim()) out.push(seg.text.trim()); }
    else if (seg.t === 'steer') {
      flush();
      const quoted = String(seg.text || '').split('\n').map((l) => `> ${l}`).join('\n');
      out.push(`> **Você** _(enviada durante a execução)_\n${quoted}`);
    } else if (seg.t === 'step') {
      const step = turn.steps[seg.id];
      if (step) actions.push(stepLine(step, root));
    }
  }
  flush();
  const changes = turn.done?.changes || [];
  if (changes.length) {
    out.push(`**Arquivos alterados**${turn.undone ? ' (desfeito)' : ''}\n\n${changes.map((c) => `- \`${relTo(c.path, root)}\` (+${c.added || 0} −${c.removed || 0})`).join('\n')}`);
  }
  if (turn.error && turn.error.code !== 'cancelled') out.push(`_Erro: ${turn.error.message}_`);
  if (turn.cancelled || turn.error?.code === 'cancelled') out.push('_(interrompido)_');
  return out.join('\n\n');
}

function transcriptMarkdown(conversation, { root = null, exportedAt = Date.now(), timeZone } = {}) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const skills = [...new Set(messages.filter((m) => m.skill).map((m) => SKILL_LABELS[m.skill] || m.skill))];
  const models = [...new Set(messages.filter((m) => m.model).map((m) => m.model))];
  const lines = [
    `# ${conversation?.title || 'Conversa'}`,
    '',
    `- **Data:** ${formatDate(conversation?.updatedAt, timeZone)}`,
    ...(root ? [`- **Pasta:** \`${root}\``] : []),
    `- **Modo:** ${skills.join(', ') || '—'}`,
    `- **Modelo:** ${models.join(', ') || '—'}`,
    `- **Exportado do Agzos Code em:** ${formatDate(exportedAt, timeZone)}`,
    '',
    '---',
  ];
  for (const message of messages) {
    lines.push('');
    if (message.role === 'user') {
      lines.push('## Você', '', String(message.content || '').trim() || '_(sem texto)_');
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      if (attachments.length) {
        lines.push('', `**Anexos:** ${attachments.map((a) => `\`${a.name}\` (${a.kind === 'image' ? 'imagem' : a.kind === 'pdf' ? 'PDF' : 'texto'}, ${formatSize(a.size)})`).join(', ')}`);
      }
    } else {
      const label = [SKILL_LABELS[message.skill] || message.skill, message.model].filter(Boolean).join(' · ');
      lines.push(`## Agzos IA${label ? ` (${label})` : ''}`, '');
      const { text, turn } = decodeTurn(message.content);
      lines.push((turn ? turnMarkdown(turn, root) : text.trim()) || '_(sem resposta)_');
    }
  }
  lines.push('');
  return redactSecrets(lines.join('\n'));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Markdown → HTML com HTML cru escapado (o conteúdo do modelo nunca vira tag). */
function renderMarkdownSafe(markdown) {
  const renderer = new marked.Renderer();
  renderer.html = (token) => escapeHtml(typeof token === 'string' ? token : token?.text ?? token?.raw ?? '');
  const linkBase = renderer.link.bind(renderer);
  renderer.link = function link(token) {
    const href = typeof token === 'object' ? token.href : token;
    if (!/^(https?:|mailto:|#)/i.test(String(href || ''))) return escapeHtml(typeof token === 'object' ? token.text : arguments[2] || '');
    return linkBase.apply(this, arguments);
  };
  renderer.image = (token) => escapeHtml(`[imagem: ${typeof token === 'object' ? token.text || token.href : token}]`);
  return marked.parse(markdown, { renderer, gfm: true, breaks: false, async: false });
}

const PRINT_CSS = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 8pt; line-height: 1.2; }
  h2 { font-size: 12.5pt; margin: 18pt 0 6pt; padding-top: 8pt; border-top: 1px solid #e3e3e6; color: #0b5cad; }
  h3, h4 { font-size: 11pt; margin: 12pt 0 4pt; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 8pt; }
  ul, ol { padding-left: 18pt; }
  hr { border: 0; border-top: 2px solid #1d1d1f; margin: 12pt 0; }
  code { font: 9.5pt/1.4 "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; background: #f3f3f5; padding: 1pt 3pt; border-radius: 3pt; }
  pre { background: #f6f6f8; border: 1px solid #e3e3e6; border-radius: 5pt; padding: 8pt 10pt; white-space: pre-wrap; word-break: break-word; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3pt solid #c9d7ea; margin-left: 0; padding: 2pt 0 2pt 10pt; color: #3a3a3c; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e3e3e6; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  a { color: #0b5cad; text-decoration: none; }
  h2, pre, blockquote, li { break-inside: avoid-page; }
`;

function transcriptHtml(markdown, title = 'Conversa') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>
<body>${renderMarkdownSafe(markdown)}</body></html>`;
}

function exportFileName(conversation, ext) {
  const base = String(conversation?.title || 'conversa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, ' ').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'conversa';
  return `agzos-ia-${base}.${ext}`;
}

module.exports = { transcriptMarkdown, transcriptHtml, exportFileName, redactSecrets, renderMarkdownSafe };
