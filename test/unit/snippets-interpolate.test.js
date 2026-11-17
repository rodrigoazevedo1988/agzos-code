const { test } = require('node:test');
const assert = require('node:assert/strict');
const { interpolate, variablesMap } = require('../../src/main/modules/snippets/interpolate');

const VARS = [
  { name: 'cor_primaria', value: '#D10A11' },
  { name: 'nome_marca', value: 'Agzos' },
];

test('interpolate: troca {{nome}} pelo valor da variável', () => {
  assert.equal(interpolate('<p class="text-[{{cor_primaria}}]">{{nome_marca}}</p>', VARS),
    '<p class="text-[#D10A11]">Agzos</p>');
});

test('interpolate: aceita espaços dentro das chaves', () => {
  assert.equal(interpolate('{{ nome_marca }} e {{nome_marca  }}', VARS), 'Agzos e Agzos');
});

test('interpolate: variável desconhecida fica como está', () => {
  assert.equal(interpolate('Olá {{desconhecida}} {{nome_marca}}', VARS), 'Olá {{desconhecida}} Agzos');
});

test('interpolate: aceita objeto { nome: valor } e ignora não-texto', () => {
  assert.equal(interpolate('{{a}}-{{b}}', { a: 'x', b: 7 }), 'x-{{b}}');
});

test('interpolate: valor com $ e padrões especiais entra literal', () => {
  assert.equal(interpolate('{{p}}', [{ name: 'p', value: "R$ 10 $& $1 $'" }]), "R$ 10 $& $1 $'");
});

test('interpolate: corpo não-texto vira string vazia; sem variáveis devolve o corpo', () => {
  assert.equal(interpolate(null, VARS), '');
  assert.equal(interpolate('{{x}}'), '{{x}}');
});

test('interpolate: não interpola recursivamente o valor', () => {
  assert.equal(interpolate('{{a}}', [{ name: 'a', value: '{{b}}' }, { name: 'b', value: 'B' }]), '{{b}}');
});

test('variablesMap: última definição de um nome vence; nomes inválidos fora', () => {
  const m = variablesMap([{ name: 'a', value: '1' }, { name: 'a', value: '2' }, { name: 'x y', value: '3' }, null]);
  assert.deepEqual(Object.keys(m), ['a']);
  assert.equal(m.a, '2');
});
