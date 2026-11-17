const { test } = require('node:test');
const assert = require('node:assert/strict');
const { confirmQuit } = require('../../src/main/lib/quit-confirm');

function deps({ response = 1, checked = false, confirm = true, dirty = 0 } = {}) {
  const calls = { dialogs: [], saved: [] };
  return {
    calls,
    dialog: {
      showMessageBox: async (_win, opts) => {
        calls.dialogs.push(opts);
        return { response, checkboxChecked: checked };
      },
    },
    parent: {},
    getSettings: () => ({ window: { confirmBeforeQuit: confirm } }),
    disableConfirm: () => calls.saved.push(false),
    countDirty: async () => dirty,
  };
}

test('pergunta "Sair do Agzos Code?" com Sair/Cancelar (padrão Cancelar) e checkbox', async () => {
  const d = deps({ response: 1 });
  assert.equal(await confirmQuit(d), false);
  const opts = d.calls.dialogs[0];
  assert.equal(opts.message, 'Sair do Agzos Code?');
  assert.deepEqual(opts.buttons, ['Sair', 'Cancelar']);
  assert.equal(opts.defaultId, 1);
  assert.equal(opts.cancelId, 1);
  assert.equal(opts.checkboxLabel, 'Não perguntar novamente');
  assert.deepEqual(d.calls.saved, []);
});

test('Sair confirma; com "não perguntar" grava a setting', async () => {
  const d = deps({ response: 0 });
  assert.equal(await confirmQuit(d), true);
  assert.deepEqual(d.calls.saved, []);
  const d2 = deps({ response: 0, checked: true });
  assert.equal(await confirmQuit(d2), true);
  assert.deepEqual(d2.calls.saved, [false]);
});

test('Cancelar com "não perguntar" marcado não grava nada', async () => {
  const d = deps({ response: 1, checked: true });
  assert.equal(await confirmQuit(d), false);
  assert.deepEqual(d.calls.saved, []);
});

test('confirmBeforeQuit false e sem não salvos: sai sem perguntar', async () => {
  const d = deps({ confirm: false });
  assert.equal(await confirmQuit(d), true);
  assert.equal(d.calls.dialogs.length, 0);
});

test('com arquivos não salvos: uma pergunta só, sempre (mesmo com confirmBeforeQuit false), sem checkbox', async () => {
  const d = deps({ confirm: false, dirty: 2, response: 1 });
  assert.equal(await confirmQuit(d), false);
  assert.equal(d.calls.dialogs.length, 1);
  const opts = d.calls.dialogs[0];
  assert.equal(opts.message, 'Sair do Agzos Code?');
  assert.match(opts.detail, /2 arquivos com alterações não salvas/);
  assert.equal(opts.checkboxLabel, undefined);
  assert.deepEqual(opts.buttons, ['Sair sem salvar', 'Cancelar']);
  const d2 = deps({ dirty: 1, response: 0 });
  assert.equal(await confirmQuit(d2), true);
  assert.match(d2.calls.dialogs[0].detail, /1 arquivo com alterações não salvas/);
});
