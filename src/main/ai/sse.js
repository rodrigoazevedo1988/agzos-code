/**
 * Agzos Code — parser de Server-Sent Events.
 *
 * Consome o corpo de uma resposta HTTP em streaming e entrega um evento por
 * vez. Implementa o essencial da especificação que os providers de IA usam:
 *
 *  - um evento termina em linha em branco;
 *  - `data:` de várias linhas é juntado com `\n`;
 *  - linhas que começam com `:` são comentários (heartbeat) e são ignoradas;
 *  - `event:` define o nome do evento;
 *  - `\r\n`, `\n` e `\r` valem como fim de linha.
 *
 * A decodificação é incremental (TextDecoder com `stream: true`) porque um
 * caractere UTF-8 pode ser cortado entre dois chunks da rede — decodificar
 * cada chunk isolado produziria U+FFFD no meio das respostas com acento.
 *
 * Sem dependência do Electron e sem I/O próprio: recebe um AsyncIterable e
 * devolve um AsyncGenerator, o que permite testar com array de chunks.
 */

/** Chave usada para saber se uma linha vazia veio depois de algum `data:`. */
const FIM_DE_LINHA = /\r\n|\n|\r/g;

/**
 * Lê Server-Sent Events de um stream.
 *
 * @param {AsyncIterable<Uint8Array|string>} stream corpo da resposta
 * @returns {AsyncGenerator<{ event: string|null, data: string }>}
 */
async function* parseSSE(stream) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let firstLine = true;
  // Um `\r` no fim do buffer pode ser a primeira metade de um `\r\n` partido
  // entre dois chunks. Guardamos a posição para só decidir quando o próximo
  // chunk chegar (ou quando o stream acabar).
  let pendingCR = false;

  let eventName = null;
  let dataLines = [];

  /**
   * Trata uma linha já completa. Devolve o evento fechado por ela, se houver.
   *
   * @param {string} rawLine linha sem o terminador
   * @returns {{ event: string|null, data: string } | null}
   */
  const handleLine = (rawLine) => {
    let line = rawLine;
    if (firstLine) {
      firstLine = false;
      // Alguns endpoints gravam BOM antes do primeiro `data:`.
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    }

    if (line === '') {
      // Linha em branco fecha o evento. Sem nenhum `data:` acumulado não há
      // evento para entregar (ex.: bloco só com `event:` ou comentário).
      if (dataLines.length === 0) {
        eventName = null;
        return null;
      }
      const evt = { event: eventName, data: dataLines.join('\n') };
      eventName = null;
      dataLines = [];
      return evt;
    }

    if (line.startsWith(':')) return null; // comentário/heartbeat

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    // Um único espaço depois dos dois-pontos é separador, não conteúdo.
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
    // `id`, `retry` e campos desconhecidos são ignorados de propósito: nenhum
    // provider de IA os usa e o consumidor não tem o que fazer com eles.

    return null;
  };

  /** Extrai e processa todas as linhas completas do buffer. */
  const drainLines = function* () {
    for (;;) {
      const match = FIM_DE_LINHA.exec(buffer);
      if (!match) {
        FIM_DE_LINHA.lastIndex = 0;
        return;
      }
      const idx = match.index;
      const isCR = match[0] === '\r';

      // `\r` no último caractere do buffer: pode virar `\r\n`. Espera mais.
      if (isCR && idx === buffer.length - 1) {
        pendingCR = true;
        FIM_DE_LINHA.lastIndex = 0;
        return;
      }
      pendingCR = false;

      const rawLine = buffer.slice(0, idx);
      buffer = buffer.slice(idx + match[0].length);
      FIM_DE_LINHA.lastIndex = 0;

      const evt = handleLine(rawLine);
      if (evt) yield evt;
    }
  };

  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    yield* drainLines();
  }

  buffer += decoder.decode();
  // No fim do stream um `\r` pendente é fim de linha de verdade.
  if (pendingCR && buffer.endsWith('\r')) buffer = buffer.slice(0, -1) + '\r\n';
  yield* drainLines();

  if (buffer !== '') {
    const evt = handleLine(buffer);
    buffer = '';
    if (evt) yield evt;
  }
  // Evento que o servidor mandou sem a linha em branco final.
  if (dataLines.length > 0) {
    yield { event: eventName, data: dataLines.join('\n') };
  }
}

module.exports = { parseSSE };
