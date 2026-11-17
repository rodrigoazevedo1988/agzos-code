const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModules, DEFAULT_SETTINGS } = require('../../src/main/lib/settings');

const names = (vars) => vars.map((v) => v.name);

test('snippets: padrão habilitado com as variáveis da marca Agzos', () => {
  const s = normalizeModules(undefined).snippets;
  assert.equal(s.enabled, true);
  assert.deepEqual(names(s.variables), [
    'cor_primaria', 'cor_fundo', 'cor_texto', 'cor_secundaria', 'fonte', 'nome_marca', 'url_site', 'email_contato',
  ]);
  const get = (n) => s.variables.find((v) => v.name === n).value;
  assert.equal(get('cor_primaria'), '#D10A11');
  assert.equal(get('cor_fundo'), '#0E0E0E');
  assert.equal(get('cor_texto'), '#E8E8E8');
  assert.equal(get('fonte'), 'Inter, sans-serif');
  assert.equal(get('nome_marca'), 'Agzos');
  assert.deepEqual(DEFAULT_SETTINGS.modules.snippets, normalizeModules({}).snippets);
});

test('snippets: enabled inválido volta ao padrão; variáveis do usuário ficam', () => {
  const s = normalizeModules({ snippets: { enabled: 'sim', variables: [{ name: 'cor_primaria', value: '#00F' }, { name: 'minha_var', value: 'x' }] } }).snippets;
  assert.equal(s.enabled, true);
  assert.deepEqual(s.variables, [{ name: 'cor_primaria', value: '#00F' }, { name: 'minha_var', value: 'x' }]);
});

test('snippets: variáveis inválidas são descartadas item a item; duplicadas ficam só a primeira', () => {
  const s = normalizeModules({ snippets: { enabled: false, variables: [
    { name: 'ok', value: '1' }, { name: 'com espaço', value: '2' }, { name: 'ok', value: '3' },
    { name: 'sem_valor' }, 'lixo', null, { name: 'num', value: 5 },
  ] } }).snippets;
  assert.equal(s.enabled, false);
  assert.deepEqual(s.variables, [{ name: 'ok', value: '1' }]);
});

test('snippets: variables não-array volta ao padrão; lista vazia é respeitada', () => {
  assert.equal(normalizeModules({ snippets: { variables: 'x' } }).snippets.variables.length, 8);
  assert.deepEqual(normalizeModules({ snippets: { variables: [] } }).snippets.variables, []);
});

test('snippets: normalizar não altera o padrão compartilhado', () => {
  const s = normalizeModules({}).snippets;
  s.variables[0].value = 'mudou';
  assert.equal(DEFAULT_SETTINGS.modules.snippets.variables[0].value, '#D10A11');
});
