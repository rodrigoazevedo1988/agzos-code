/**
 * Conteúdo multimodal no formato neutro (agente e chat):
 *
 *   content: string | Array<{ type: 'text', text } | { type: 'image', mediaType, data }>
 *
 * `data` é base64 (sem o prefixo data:). Cada provider converte para o seu formato:
 *   OpenAI-compatível: [{ type: 'text', text }, { type: 'image_url', image_url: { url: 'data:…' } }]
 *   Anthropic:         [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type, data } }]
 */

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Normaliza: string fica string; lista válida vira lista de partes; o resto vira ''. */
function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') parts.push({ type: 'text', text: part.text });
    else if (part.type === 'image' && IMAGE_TYPES.includes(part.mediaType) && typeof part.data === 'string' && part.data) {
      parts.push({ type: 'image', mediaType: part.mediaType, data: part.data });
    }
  }
  if (parts.every((p) => p.type === 'text')) return parts.map((p) => p.text).join('\n\n');
  return parts;
}

/** Só o texto (para títulos, resumos, logs). */
function contentText(content) {
  const value = normalizeContent(content);
  if (typeof value === 'string') return value;
  return value.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n');
}

function hasImages(content) {
  return Array.isArray(content) && content.some((p) => p && p.type === 'image');
}

function toOpenAIContent(content) {
  const value = normalizeContent(content);
  if (typeof value === 'string') return value;
  return value.map((p) => (p.type === 'text'
    ? { type: 'text', text: p.text }
    : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } }));
}

function toAnthropicContent(content) {
  const value = normalizeContent(content);
  if (typeof value === 'string') return value;
  return value.map((p) => (p.type === 'text'
    ? { type: 'text', text: p.text }
    : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }));
}

/**
 * Erro do provider por causa de imagem (modelo sem visão) → code 'vision_unsupported'
 * e mensagem clara. Só olha erros 400/404/415/422 que citam imagem/visão.
 */
const VISION_MESSAGE = 'Este modelo não aceita imagens. Troque para um modelo com visão (ex.: GPT-4o, Claude, Llama 3.2 Vision) ou remova a imagem e tente de novo.';
function markVisionUnsupported(err, { hadImages = true } = {}) {
  if (!hadImages || !err) return err;
  const status = err.status;
  const text = String(err.message || err.userMessage || '');
  if ([400, 404, 415, 422].includes(status) && /image|vision|multimodal|image_url|imagem/i.test(text)) {
    err.code = 'vision_unsupported';
    err.message = VISION_MESSAGE;
    err.userMessage = VISION_MESSAGE;
  }
  return err;
}

module.exports = {
  IMAGE_TYPES, normalizeContent, contentText, hasImages, toOpenAIContent, toAnthropicContent,
  markVisionUnsupported, VISION_MESSAGE,
};
