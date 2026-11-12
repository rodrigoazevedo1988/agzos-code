const http = require('node:http');

function startFakeOpenAI({ reply = 'Olá do fake', status = 200 } = {}) {
  const requests = [];
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

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      for (let index = 0; index < reply.length; index += 3) {
        const content = reply.slice(index, index + 3);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      res.write('data: [DONE]\n\n');
      res.end();
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
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((err) => err ? closeReject(err) : closeResolve());
        })
      });
    });
  });
}

module.exports = { startFakeOpenAI };
