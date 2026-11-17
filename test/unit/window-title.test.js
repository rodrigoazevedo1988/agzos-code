const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/window-title.js')).href);

test('título: projeto › arquivo — Agzos Code', async () => {
  const { formatWindowTitle } = await load();
  assert.equal(formatWindowTitle({ folder: '/home/u/StreamAgzos', file: '/home/u/StreamAgzos/README.md' }), 'StreamAgzos › README.md — Agzos Code');
  assert.equal(formatWindowTitle({ folder: 'C:\\Users\\R\\agzos-code\\', file: 'C:\\Users\\R\\agzos-code\\src\\app.js' }), 'agzos-code › app.js — Agzos Code');
});

test('título: só projeto, só arquivo, nada e remoto', async () => {
  const { formatWindowTitle } = await load();
  assert.equal(formatWindowTitle({ folder: '/p/site' }), 'site — Agzos Code');
  assert.equal(formatWindowTitle({ file: '/tmp/nota.md' }), 'nota.md — Agzos Code');
  assert.equal(formatWindowTitle({}), 'Agzos Code');
  assert.equal(formatWindowTitle({ folder: '/srv/app', file: '/srv/app/x.py', remoteHost: 'vps' }), 'app [SSH: vps] › x.py — Agzos Code');
});
