/**
 * Anexos do Agzos IA (imagens, texto/código, PDF).
 *
 * O renderer manda os bytes (imagens já redimensionadas no canvas: ≤ 1568 px no maior
 * lado e ~1 MB); aqui o arquivo é classificado, validado e guardado processado em
 * `userData/chat-attachments/<hash>` (+ `<hash>.json` com os metadados). O histórico só
 * guarda o descritor ({ id, kind, name, size, … } + miniatura pequena gerada no renderer),
 * nunca os bytes. Na hora de enviar ao modelo, `buildContent` expande as referências.
 *
 * Tipos:
 *   image  png/jpg/gif/webp → parte { type: 'image' } (visão)
 *   text   texto/código (extensão conhecida ou conteúdo sem binário), até 200 KB
 *   pdf    texto extraído com pdfjs-dist (até 50 páginas / 200 KB de texto)
 *   resto  recusado com mensagem clara (DOCX/XLSX… estão no backlog)
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const LIMITS = {
  imageBytes: 1.5 * 1024 * 1024,
  textBytes: 200 * 1024,
  pdfBytes: 30 * 1024 * 1024,
  pdfPages: 50,
  pdfChars: 200 * 1024,
};

const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'svg', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro',
  'py', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'm', 'dart', 'lua',
  'r', 'pl', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'proto', 'dockerfile', 'makefile',
  'gradle', 'properties', 'lock', 'gitignore', 'editorconfig', 'tf', 'hcl', 'ex', 'exs', 'erl', 'hs', 'clj', 'elm', 'zig', 'nim',
]);
const UNSUPPORTED_LABEL = {
  docx: 'Documentos do Word (DOCX)', doc: 'Documentos do Word (DOC)', xlsx: 'Planilhas do Excel (XLSX)', xls: 'Planilhas do Excel (XLS)',
  pptx: 'Apresentações (PPTX)', ppt: 'Apresentações (PPT)', odt: 'Documentos ODT', ods: 'Planilhas ODS',
};

class AttachmentError extends Error {
  constructor(message) { super(message); this.name = 'AttachmentError'; this.userMessage = message; }
}

function extOf(name) {
  const base = path.basename(String(name || '')).toLowerCase();
  if (base === 'dockerfile' || base === 'makefile') return base;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : (dot === 0 ? base.slice(1) : '');
}

function looksLikeText(buf) {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.length < buf.length ? sample.subarray(0, Math.max(0, sample.length - 4)) : sample);
    return true;
  } catch { return false; }
}

function sniffImage(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Classifica sem gravar: { kind, mime } ou lança AttachmentError. */
function classify(name, bytes) {
  const ext = extOf(name);
  const image = sniffImage(bytes);
  if (image || IMAGE_EXT[ext]) {
    if (!image) throw new AttachmentError(`"${name}" não parece uma imagem válida.`);
    return { kind: 'image', mime: image };
  }
  if (ext === 'pdf' || bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf' };
  if (UNSUPPORTED_LABEL[ext]) {
    throw new AttachmentError(`${UNSUPPORTED_LABEL[ext]} ainda não são suportados — veja o backlog. Exporte como PDF ou texto e anexe de novo.`);
  }
  if (TEXT_EXT.has(ext) || looksLikeText(bytes)) return { kind: 'text', mime: 'text/plain' };
  throw new AttachmentError(`Tipo de arquivo ainda não suportado: "${name}" — veja o backlog. Anexe imagens (PNG, JPG, GIF, WebP), texto/código ou PDF.`);
}

function createAttachmentStore({ dir, extractPdf = (...args) => require('./pdf-text').extractPdfText(...args), now = Date.now } = {}) {
  const fileFor = (id) => path.join(dir, id);
  const metaFor = (id) => path.join(dir, `${id}.json`);
  const validId = (id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);

  /** bytes: Buffer | Uint8Array | ArrayBuffer. → descritor { id, kind, name, mime, size, truncated?, note? } */
  async function save({ name, bytes }) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);
    const safeName = path.basename(String(name || 'anexo')).slice(0, 120) || 'anexo';
    if (!buf.length) throw new AttachmentError(`"${safeName}" está vazio.`);
    const { kind, mime } = classify(safeName, buf);
    let stored = buf;
    let truncated = false;
    let note = '';
    if (kind === 'image') {
      if (buf.length > LIMITS.imageBytes) throw new AttachmentError(`A imagem "${safeName}" é grande demais (máx. ~1,5 MB depois de reduzida).`);
    } else if (kind === 'text') {
      if (buf.length > LIMITS.textBytes) {
        stored = Buffer.from(buf.subarray(0, LIMITS.textBytes).toString('utf8').replace(/�+$/, ''), 'utf8');
        truncated = true;
        note = `Arquivo cortado em 200 KB (tinha ${Math.round(buf.length / 1024)} KB).`;
      }
    } else if (kind === 'pdf') {
      if (buf.length > LIMITS.pdfBytes) throw new AttachmentError(`O PDF "${safeName}" é grande demais (máx. 30 MB).`);
      let result;
      try {
        result = await extractPdf(buf, { maxPages: LIMITS.pdfPages, maxChars: LIMITS.pdfChars });
      } catch (err) {
        throw new AttachmentError(`Não foi possível ler o PDF "${safeName}": ${err.message || err}`);
      }
      if (!result.text.replace(/--- Página \d+ ---/g, '').trim()) {
        throw new AttachmentError(`O PDF "${safeName}" não tem texto extraível (provavelmente é digitalizado).`);
      }
      stored = Buffer.from(result.text, 'utf8');
      truncated = !!result.truncated;
      if (truncated) note = `PDF cortado: ${result.pages} de ${result.totalPages} páginas (limite de 50 páginas / 200 KB de texto).`;
    }
    const id = createHash('sha256').update(kind).update('\0').update(stored).digest('hex').slice(0, 32);
    const meta = { id, kind, name: safeName, mime, size: buf.length, ...(truncated ? { truncated, note } : {}) };
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(fileFor(id))) fs.writeFileSync(fileFor(id), stored);
    fs.writeFileSync(metaFor(id), JSON.stringify({ ...meta, createdAt: now() }));
    return meta;
  }

  function read(id) {
    if (!validId(id)) throw new AttachmentError('Anexo inválido.');
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaFor(id), 'utf8')); } catch { throw new AttachmentError('Anexo não encontrado (pode ter sido limpo).'); }
    return { meta, data: fs.readFileSync(fileFor(id)) };
  }

  /**
   * Texto do usuário + anexos → conteúdo neutro (string se não houver imagem).
   * Anexo ausente vira um aviso em texto (não derruba o envio).
   */
  function buildContent(text, attachments) {
    const list = Array.isArray(attachments) ? attachments.filter((a) => a && validId(a.id)) : [];
    if (!list.length) return typeof text === 'string' ? text : '';
    const parts = [];
    const blocks = [];
    const images = [];
    for (const ref of list) {
      let item;
      try { item = read(ref.id); } catch (err) {
        blocks.push(`[Anexo "${ref.name || ref.id}" indisponível: ${err.message}]`);
        continue;
      }
      const { meta, data } = item;
      if (meta.kind === 'image') images.push({ type: 'image', mediaType: meta.mime, data: data.toString('base64') });
      else {
        const label = meta.kind === 'pdf' ? 'PDF anexado (texto extraído)' : 'Arquivo anexado';
        const fence = data.includes('```') ? '~~~~' : '```';
        const name = typeof ref.name === 'string' && ref.name ? path.basename(ref.name) : meta.name;
        blocks.push(`${label}: ${name}${meta.note ? ` — ${meta.note}` : ''}\n${fence}\n${data.toString('utf8')}\n${fence}`);
      }
    }
    const body = [typeof text === 'string' ? text : '', ...blocks].filter(Boolean).join('\n\n');
    if (!images.length) return body;
    if (body) parts.push({ type: 'text', text: body });
    return [...parts, ...images];
  }

  /** Apaga anexos que nenhum histórico referencia (e com mais de `graceMs`, para não pegar anexos ainda não enviados). */
  function gc(referenced, { graceMs = 6 * 60 * 60 * 1000 } = {}) {
    let removed = 0;
    let names;
    try { names = fs.readdirSync(dir); } catch { return 0; }
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (!validId(id) || referenced.has(id)) continue;
      let stat;
      try { stat = fs.statSync(path.join(dir, name)); } catch { continue; }
      if (now() - stat.mtimeMs < graceMs) continue;
      try { fs.rmSync(path.join(dir, name), { force: true }); if (!name.endsWith('.json')) removed++; } catch { /* segue */ }
    }
    return removed;
  }

  return { save, read, buildContent, gc, dir };
}

module.exports = { createAttachmentStore, classify, AttachmentError, LIMITS };
