const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = (name) => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts', name)).href);

const TOP = ['Arquivo', 'Editar', 'Seleção', 'Ver', 'Ir', 'Executar', 'Terminal', 'Ajuda'];
const ENGLISH = /^(File|Edit|Selection|View|Go|Run|Help|New|Open|Save|Close|Undo|Redo|Cut|Copy|Paste|Find|Replace)\b/;

function* walk(items, depth = 1) {
  for (const item of items) {
    yield { item, depth };
    if (item.submenu) yield* walk(item.submenu, depth + 1);
  }
}

test('menu-model: 8 menus na ordem do VS Code, em pt-BR', async () => {
  const { MENUS } = await load('menu-model.js');
  assert.deepEqual(MENUS.map((m) => m.label), TOP);
  for (const menu of MENUS) {
    assert.ok(menu.id && typeof menu.id === 'string');
    assert.ok(Array.isArray(menu.items) && menu.items.length > 0, `${menu.label} sem itens`);
  }
});

test('menu-model: mnemônicos únicos no topo e em cada nível, contidos no label', async () => {
  const { MENUS, mnemonicsFor } = await load('menu-model.js');
  const top = MENUS.map((m) => m.mnemonic.toLowerCase());
  assert.equal(new Set(top).size, top.length);
  for (const m of MENUS) assert.ok(m.label.toLowerCase().includes(m.mnemonic.toLowerCase()), m.label);

  const check = (items, where) => {
    const map = mnemonicsFor(items);
    const letters = [...map.values()].map((x) => x.letter);
    assert.equal(new Set(letters).size, letters.length, `mnemônicos repetidos em ${where}`);
    for (const [item, { index }] of map) {
      assert.equal(item.label[index].toLowerCase(), map.get(item).letter, item.label);
    }
    for (const item of items) if (item.submenu) check(item.submenu, `${where} › ${item.label}`);
  };
  for (const m of MENUS) check(m.items, m.label);
});

test('menu-model: todo item tem run, comingSoon ou submenu; Em breve não tem run', async () => {
  const { MENUS } = await load('menu-model.js');
  for (const menu of MENUS) {
    for (const { item } of walk(menu.items)) {
      if (item.type === 'separator') continue;
      assert.ok(typeof item.label === 'string' && item.label.trim(), `item sem label em ${menu.label}`);
      assert.doesNotMatch(item.label, ENGLISH, `label em inglês: ${item.label}`);
      const kinds = [!!item.run, !!item.comingSoon, Array.isArray(item.submenu)].filter(Boolean).length;
      assert.ok(kinds >= 1, `${item.label} sem ação`);
      if (item.comingSoon) {
        assert.equal(item.run, undefined, `${item.label} é Em breve e tem run`);
        assert.equal(item.submenu, undefined, `${item.label} é Em breve e tem submenu`);
      }
    }
  }
});

test('menu-model: ids únicos em todos os níveis', async () => {
  const { MENUS } = await load('menu-model.js');
  const ids = [];
  for (const menu of MENUS) {
    ids.push(menu.id);
    for (const { item } of walk(menu.items)) if (item.type !== 'separator') ids.push(item.id);
  }
  assert.ok(ids.every((id) => typeof id === 'string' && id));
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, []);
});

test('menu-model: sem separadores nas pontas nem duplicados', async () => {
  const { MENUS } = await load('menu-model.js');
  const check = (items, where) => {
    assert.notEqual(items[0].type, 'separator', where);
    assert.notEqual(items[items.length - 1].type, 'separator', where);
    items.forEach((it, i) => {
      if (it.type === 'separator') assert.notEqual(items[i + 1]?.type, 'separator', where);
      if (it.submenu) check(it.submenu, `${where} › ${it.label}`);
    });
  };
  for (const m of MENUS) check(m.items, m.label);
});

test('menu-model: itens de editor ficam desabilitados sem editor ativo', async () => {
  const { MENUS, findItem } = await load('menu-model.js');
  const selectAll = findItem(MENUS, 'selection.selectAll');
  assert.equal(selectAll.run, 'monaco:editor.action.selectAll');
  assert.equal(selectAll.enabled({ hasEditor: false }), false);
  assert.equal(selectAll.enabled({ hasEditor: true }), true);
});

test('menu-model: toggles leem o contexto', async () => {
  const { MENUS, findItem } = await load('menu-model.js');
  const ctx = (editor) => ({ hasEditor: true, settings: { editor } });
  assert.equal(findItem(MENUS, 'file.autoSave').checked(ctx({ autoSave: 'off' })), false);
  assert.equal(findItem(MENUS, 'file.autoSave').checked(ctx({ autoSave: 'afterDelay' })), true);
  assert.equal(findItem(MENUS, 'view.wordWrap').checked(ctx({ wordWrap: 'on' })), true);
  assert.equal(findItem(MENUS, 'view.minimap').checked(ctx({})), true);
  assert.equal(findItem(MENUS, 'view.minimap').checked(ctx({ minimap: false })), false);
  assert.equal(findItem(MENUS, 'selection.columnMode').checked(ctx({ columnSelection: true })), true);
  assert.equal(findItem(MENUS, 'selection.multiCursorCtrl').checked(ctx({ multiCursorModifier: 'ctrlCmd' })), true);
});

test('menu-model: Executar só tem Em breve além de Executar Arquivo Ativo', async () => {
  const { MENUS } = await load('menu-model.js');
  const run = MENUS.find((m) => m.id === 'run');
  const real = [...walk(run.items)].map((x) => x.item).filter((i) => i.type !== 'separator' && !i.comingSoon);
  assert.deepEqual(real.map((i) => i.id), ['run.activeFile']);
});

test('mnemonicsFor: prefere a primeira letra das palavras e ignora separadores/Em breve iguais', async () => {
  const { mnemonicsFor } = await load('menu-model.js');
  const items = [{ id: 'a', label: 'Salvar' }, { type: 'separator' }, { id: 'b', label: 'Salvar Como…' }, { id: 'c', label: 'Sair' }];
  const map = mnemonicsFor(items);
  assert.equal(map.get(items[0]).letter, 's');
  assert.equal(map.get(items[2]).letter, 'c');
  assert.equal(map.size, 3);
  assert.notEqual(map.get(items[3]).letter, 's');
});

test('nextIndex: pula separadores e circula', async () => {
  const { nextIndex } = await load('menu-model.js');
  const items = [{ id: 'a' }, { type: 'separator' }, { id: 'b' }, { id: 'c' }];
  assert.equal(nextIndex(items, 0, 1), 2);
  assert.equal(nextIndex(items, 3, 1), 0);
  assert.equal(nextIndex(items, 0, -1), 3);
  assert.equal(nextIndex(items, -1, 1), 0);
});

test('accelLabel: Ctrl vira ⌘ no mac', async () => {
  const { accelLabel } = await load('menu-model.js');
  assert.equal(accelLabel('Ctrl+Shift+N', false), 'Ctrl+Shift+N');
  assert.equal(accelLabel('Ctrl+Shift+N', true), '⌘+Shift+N');
  assert.equal(accelLabel('', true), '');
});
