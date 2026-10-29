const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLogger, sanitize } = require('../../src/main/lib/logger');

function tmpLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-log-'));
  return path.join(dir, 'logs', 'main.log');
}

test('logger grava linha com nível e timestamp', () => {
  const file = tmpLog();
  const logger = createLogger({ filePath: file, now: () => new Date('2026-10-28T12:00:00Z') });
  logger.info('iniciou', { ok: true });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /\[2026-10-28T12:00:00\.000Z\] INFO iniciou/);
  assert.match(text, /"ok":true/);
});

test('logger redige chaves e tokens', () => {
  const file = tmpLog();
  const logger = createLogger({ filePath: file });
  logger.error('falhou com sk-SEGREDO123 e Bearer abc.def');
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.includes('sk-SEGREDO123'), false);
  assert.equal(text.includes('Bearer abc.def'), false);
  assert.match(text, /sk-\*\*\*/);
});

test('logger rotaciona quando passa do limite', () => {
  const file = tmpLog();
  const logger = createLogger({ filePath: file, maxBytes: 80, maxFiles: 3 });
  logger.info('x'.repeat(200));
  logger.info('segunda linha');
  assert.ok(fs.existsSync(file));
  assert.ok(fs.existsSync(`${file}.1`));
});

test('sanitize cobre JSON de apiKey/token', () => {
  assert.equal(sanitize('{"apiKey":"segredo","token":"abc"}'), '{"apiKey":"***","token":"***"}');
});
