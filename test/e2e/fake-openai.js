/**
 * Servidor HTTP falso para testes (OpenAI-compatível + Anthropic).
 *
 * startFakeOpenAI(options) → Promise<{ baseUrl, requests, close, pushTurn, setScript, turns }>
 *
 * Opções:
 *   reply       texto do chat normal (padrão 'Olá do fake'), enviado em pedaços de 3 chars.
 *   status      se != 200, toda rota responde esse status com { error: { message: 'erro fake' } }.
 *   script      roteiro do agente: array de "turnos". Só pedidos que trazem `tools` no corpo
 *               (pedidos do agente) consomem o roteiro, um turno por pedido, em ordem.
 *               Pedidos sem `tools` (chat normal) continuam recebendo `reply`.
 *               Roteiro esgotado → responde `reply` como texto final (sem tool calls).
 *   toolsStatus se definido (ex.: 400), pedidos com `tools` recebem esse status com
 *               { error: { message: 'tools is not supported for this model' } }.
 *   delayMs     atraso entre eventos SSE (padrão 20).
 *
 * Turno: objeto ou função (body, index) => objeto, com
 *   { text?: string, toolCalls?: [{ id?, name, arguments: object|string }] }
 *   - OpenAI (POST /v1/chat/completions): texto em delta.content; cada tool call em
 *     delta.tool_calls ({index,id,type:'function',function:{name,arguments}}), com os
 *     argumentos JSON partidos em vários deltas; finish_reason 'tool_calls' ou 'stop'.
 *   - Anthropic (POST /v1/messages): mesmo roteiro em formato Anthropic
 *     (message_start, content_block_start text/tool_use, text_delta / input_json_delta,
 *     content_block_stop, message_delta stop_reason 'tool_use'|'end_turn', message_stop).
 *   id padrão: `call_<turno>_<i>` (OpenAI) / `toolu_<turno>_<i>` (Anthropic).
 *
 * Retorno:
 *   requests    [{ path, headers, body }] de todos os pedidos (body já em JSON quando possível).
 *   pushTurn(t) acrescenta um turno ao roteiro.  setScript(arr) troca o roteiro e zera o índice.
 *   turns()     quantos turnos do roteiro já foram consumidos.
 *
 * Exemplo (agente cria arquivo e responde):
 *   startFakeOpenAI({ script: [
 *     { toolCalls: [{ name: 'write_file', arguments: { path: 'a.txt', content: 'oi' } }] },
 *     { text: 'Pronto: criei a.txt.' },
 *   ] })
 */
const http = require('node:http');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function splitArgs(args) {
  const json = typeof args === 'string' ? args : JSON.stringify(args ?? {});
  if (json.length < 4) return [json];
  const cut = Math.floor(json.length / 2);
  return [json.slice(0, cut), json.slice(cut)];
}

function startFakeOpenAI({ reply = 'Olá do fake', status = 200, script = [], toolsStatus = null, delayMs = 20 } = {}) {
  const requests = [];
  let turns = Array.isArray(script) ? script.slice() : [];
  let turnIndex = 0;

  function nextTurn(body) {
    if (turnIndex >= turns.length) return { text: reply };
    const index = turnIndex++;
    const turn = turns[index];
    const value = typeof turn === 'function' ? turn(body, index) : turn;
    return { ...(value || {}), _index: index };
  }

  async function streamOpenAI(res, turn) {
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const text = turn.text || '';
    for (let index = 0; index < text.length; index += 3) {
      send({ content: text.slice(index, index + 3) });
      await wait(delayMs);
    }
    const calls = turn.toolCalls || [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const id = call.id || `call_${turn._index ?? 0}_${i}`;
      const parts = splitArgs(call.arguments);
      send({ tool_calls: [{ index: i, id, type: 'function', function: { name: call.name, arguments: parts[0] } }] });
      for (const part of parts.slice(1)) {
        await wait(delayMs);
        send({ tool_calls: [{ index: i, function: { arguments: part } }] });
      }
      await wait(delayMs);
    }
    send({}, calls.length ? 'tool_calls' : 'stop');
    res.write('data: [DONE]\n\n');
    res.end();
  }

  async function streamAnthropic(res, turn) {
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    send('message_start', { message: { id: 'msg_fake', role: 'assistant', content: [] } });
    let block = 0;
    if (turn.text) {
      send('content_block_start', { index: block, content_block: { type: 'text', text: '' } });
      for (let index = 0; index < turn.text.length; index += 3) {
        send('content_block_delta', { index: block, delta: { type: 'text_delta', text: turn.text.slice(index, index + 3) } });
        await wait(delayMs);
      }
      send('content_block_stop', { index: block });
      block++;
    }
    const calls = turn.toolCalls || [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const id = call.id || `toolu_${turn._index ?? 0}_${i}`;
      send('content_block_start', { index: block, content_block: { type: 'tool_use', id, name: call.name, input: {} } });
      for (const part of splitArgs(call.arguments)) {
        send('content_block_delta', { index: block, delta: { type: 'input_json_delta', partial_json: part } });
        await wait(delayMs);
      }
      send('content_block_stop', { index: block });
      block++;
    }
    send('message_delta', { delta: { stop_reason: calls.length ? 'tool_use' : 'end_turn' } });
    send('message_stop', {});
    res.end();
  }

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let body = rawBody;
    if (rawBody) {
      try { body = JSON.parse(rawBody); } catch {}
    }
    requests.push({ path: req.url, headers: req.headers, body });

    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'erro fake' } }));
      return;
    }

    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-1' }, { id: 'fake-2' }] }));
      return;
    }

    const isOpenAI = req.method === 'POST' && req.url === '/v1/chat/completions';
    const isAnthropic = req.method === 'POST' && req.url === '/v1/messages';
    if (isOpenAI || isAnthropic) {
      const agent = body && typeof body === 'object' && Array.isArray(body.tools);
      if (agent && toolsStatus) {
        res.writeHead(toolsStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'tools is not supported for this model' } }));
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      const turn = agent ? nextTurn(body) : { text: reply };
      if (isAnthropic) await streamAnthropic(res, turn);
      else if (agent) await streamOpenAI(res, turn);
      else {
        for (let index = 0; index < reply.length; index += 3) {
          const content = reply.slice(index, index + 3);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
          await wait(delayMs);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'rota não encontrada' } }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        pushTurn: (turn) => { turns.push(turn); },
        setScript: (next) => { turns = Array.isArray(next) ? next.slice() : []; turnIndex = 0; },
        turns: () => turnIndex,
        close: () => new Promise((closeResolve, closeReject) => {
          server.closeAllConnections?.();
          server.close((err) => err ? closeReject(err) : closeResolve());
        })
      });
    });
  });
}

module.exports = { startFakeOpenAI };
