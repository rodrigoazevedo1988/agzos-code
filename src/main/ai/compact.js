/**
 * Compactar conversa do Agzos IA (como o /compact do Claude Code).
 *
 * - estimateTokens(messages): estimativa barata (caracteres / 4) do que vai ao modelo,
 *   contando texto, partes de texto, argumentos de tool calls e saídas de ferramentas.
 *   Imagens contam um valor fixo (IMAGE_CHARS), não os bytes em base64.
 * - compactToolOutputs(messages, { keep }): usada no laço do agente. Troca o conteúdo
 *   das saídas de ferramenta antigas (todas menos as últimas `keep`) por
 *   `[saída compactada: <primeira linha>… (N caracteres)]`, sem chamar o modelo.
 *   Não remove nem reordena mensagens, então os pares tool_call/tool_result exigidos
 *   pelos providers (OpenAI e Anthropic) continuam válidos. Não muta a entrada.
 * - buildSummaryMessages(messages): pedido de resumo (prompt em pt-BR) para o modelo
 *   atual, usado por ai:summarize (compactação manual e automática antes do pedido).
 */

const KEEP_TOOL_OUTPUTS = 10;
const IMAGE_CHARS = 4000; // ~1000 tokens por imagem
const COMPACTED_RE = /^\[saída compactada: /;
const MAX_FIRST_LINE = 120;

const SUMMARY_PROMPT = `Você vai compactar a conversa abaixo entre o usuário e o Agzos IA (assistente de código do editor Agzos Code).
Escreva um resumo em português do Brasil que substitua a conversa: depois dele, só o resumo e as próximas mensagens vão para o modelo. Não perca o fio da tarefa.

Use exatamente estas seções (omita uma seção só se ela ficar vazia):

## Objetivo
O que o usuário quer, em 1 a 3 frases.

## Decisões
Escolhas técnicas e combinados com o usuário (o que fazer e o que não fazer).

## Arquivos alterados
Um item por arquivo: \`caminho/do/arquivo\` — o que mudou.

## Estado atual
Onde a tarefa parou: o que já funciona, o que foi testado.

## Pendências e próximos passos
Lista do que falta, na ordem.

## Trechos essenciais
Só o indispensável para continuar: mensagens de erro exatas, comandos usados, nomes de funções/variáveis, valores. Use blocos de código curtos.

Regras: seja conciso e factual; não invente nada que não esteja na conversa; não inclua chaves de API, senhas ou tokens; não responda ao usuário nem continue a tarefa — escreva só o resumo.`;

const SUMMARY_REQUEST = 'Resuma a conversa acima seguindo as instruções do sistema. Responda só com o resumo.';

function contentChars(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return content == null ? 0 : String(content).length;
  let n = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') n += String(part.text || '').length;
    else if (part.type === 'image' || part.type === 'image_url') n += IMAGE_CHARS;
  }
  return n;
}

/** Tokens estimados (caracteres / 4, arredondado para cima). */
function estimateTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    chars += contentChars(m.content);
    if (Array.isArray(m.toolCalls)) {
      for (const call of m.toolCalls) chars += String(call?.name || '').length + JSON.stringify(call?.input ?? {}).length;
    }
  }
  return Math.ceil(chars / 4);
}

function placeholder(text) {
  const first = (text.split('\n').find((line) => line.trim()) || '').trim();
  const clipped = first.length > MAX_FIRST_LINE ? first.slice(0, MAX_FIRST_LINE) : first;
  return `[saída compactada: ${clipped}… (${text.length} caracteres)]`;
}

/**
 * Compacta as saídas de ferramenta antigas. → { messages (novo array), removedChars }.
 */
function compactToolOutputs(messages, { keep = KEEP_TOOL_OUTPUTS } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const toolIndexes = [];
  list.forEach((m, i) => { if (m && m.role === 'tool') toolIndexes.push(i); });
  const old = new Set(toolIndexes.slice(0, Math.max(0, toolIndexes.length - Math.max(0, keep))));
  let removedChars = 0;
  const out = list.map((m, i) => {
    if (!old.has(i)) return m;
    const text = String(m.content ?? '');
    if (COMPACTED_RE.test(text)) return m;
    const short = placeholder(text);
    if (short.length >= text.length) return m;
    removedChars += text.length - short.length;
    return { ...m, content: short };
  });
  return { messages: out, removedChars };
}

/** Mensagens do pedido de resumo: instruções + conversa (sem system do renderer) + pedido. */
function buildSummaryMessages(messages) {
  const conversation = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
  return [
    { role: 'system', content: SUMMARY_PROMPT },
    ...conversation,
    { role: 'user', content: SUMMARY_REQUEST },
  ];
}

module.exports = {
  estimateTokens, compactToolOutputs, buildSummaryMessages, SUMMARY_PROMPT, SUMMARY_REQUEST, KEEP_TOOL_OUTPUTS, IMAGE_CHARS,
};
