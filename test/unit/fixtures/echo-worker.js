// Worker de teste para test/unit/worker-host.test.js (roda via child_process.fork).
const { serveWorker } = require('../../../src/main/modules/worker-host');

serveWorker({
  echo: (params) => params,
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve('acordou'), ms);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(Object.assign(new Error('cancelado'), { name: 'AbortError' }));
      });
    }),
  crash: () => process.exit(3),
  fail: () => {
    throw Object.assign(new Error('deu ruim'), { code: 'E_TESTE' });
  },
});
