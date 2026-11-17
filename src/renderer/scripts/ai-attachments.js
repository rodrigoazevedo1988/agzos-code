/**
 * Agzos IA — preparo de anexos no renderer.
 *
 * Imagens são reduzidas aqui (canvas): no máximo 1568 px no maior lado e ~1 MB; a
 * miniatura (≤ 96 px) vai para o histórico. Texto/PDF seguem como bytes e o main
 * classifica, extrai e guarda (window.agzos.ai.saveAttachment). O resultado é sempre
 * um descritor { id, kind, name, size, mime, thumb?, truncated?, note? }.
 *
 * Origens aceitas (sempre ação explícita do usuário): colar (Ctrl+V), arrastar do SO,
 * arrastar do Explorer (caminho conferido no guard pelo main) e o botão clipe (diálogo).
 */
import { fitImageSize, IMAGE_MAX_SIDE, IMAGE_TARGET_BYTES, IMAGE_TYPES } from './ai-chat-utils.js';

const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const THUMB_SIDE = 96;

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function imageTypeOf(name, type) {
  if (IMAGE_TYPES.includes(type)) return type;
  return IMAGE_EXT[extOf(name)] || null;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function hasAlpha(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, Math.min(width, 256), Math.min(height, 256));
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

async function makeThumb(bitmap) {
  const { width, height } = fitImageSize(bitmap.width, bitmap.height, THUMB_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

/**
 * Reduz a imagem se precisar. Mantém o original quando já cabe (preserva GIF animado).
 * @returns {Promise<{ bytes: Uint8Array, name: string, thumb: string }>}
 */
async function prepareImage(name, type, bytes) {
  const blob = new Blob([bytes], { type });
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch { throw new Error(`Não foi possível abrir a imagem "${name}".`); }
  try {
    const thumb = await makeThumb(bitmap);
    const fit = fitImageSize(bitmap.width, bitmap.height, IMAGE_MAX_SIDE);
    if (!fit.scaled && bytes.byteLength <= IMAGE_TARGET_BYTES) return { bytes, name, thumb };
    const canvas = document.createElement('canvas');
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
    const alpha = type !== 'image/jpeg' && hasAlpha(ctx, fit.width, fit.height);
    let out = null;
    if (alpha) out = await canvasToBlob(canvas, 'image/png');
    if (!out || out.size > IMAGE_TARGET_BYTES) {
      for (const quality of [0.86, 0.76, 0.66, 0.56]) {
        out = await canvasToBlob(canvas, 'image/jpeg', quality);
        if (out && out.size <= IMAGE_TARGET_BYTES) break;
      }
    }
    if (!out) throw new Error(`Não foi possível reduzir a imagem "${name}".`);
    const outName = out.type === 'image/jpeg' && !/\.jpe?g$/i.test(name) ? `${name.replace(/\.[^.]+$/, '')}.jpg` : name;
    return { bytes: new Uint8Array(await out.arrayBuffer()), name: outName, thumb };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Um arquivo (bytes) → descritor salvo no main.
 * @returns {Promise<{ ok: true, attachment } | { ok: false, error: string, name }>}
 */
export async function attachBytes({ name, type = '', bytes }) {
  const fileName = String(name || 'anexo');
  try {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const imageType = imageTypeOf(fileName, type);
    let payload = { name: fileName, bytes: data };
    let thumb = null;
    if (imageType) {
      const prepared = await prepareImage(fileName, imageType, data);
      payload = { name: prepared.name, bytes: prepared.bytes };
      thumb = prepared.thumb;
    }
    const result = await window.agzos.ai.saveAttachment(payload);
    if (!result?.ok) return { ok: false, name: fileName, error: result?.error || 'Não foi possível anexar.' };
    return { ok: true, attachment: thumb ? { ...result.attachment, thumb } : result.attachment };
  } catch (err) {
    return { ok: false, name: fileName, error: err?.message || String(err) };
  }
}

/** File/Blob do navegador (colar, arrastar do SO). */
export async function attachFile(file, fallbackName = 'imagem-colada.png') {
  const name = file.name || fallbackName;
  return attachBytes({ name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
}

/** Caminhos (Explorer) ou, sem caminhos, o diálogo nativo do clipe. */
export async function attachFromMain(paths) {
  const files = await window.agzos.ai.readAttachments(paths);
  const results = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (file.error || !file.bytes) results.push({ ok: false, name: file.name, error: file.error || 'Não foi possível ler.' });
    else results.push(await attachBytes({ name: file.name, bytes: file.bytes }));
  }
  return results;
}
