const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSeed } = require('../../src/main/modules/snippets/seed');
const { LANGUAGES } = require('../../src/main/modules/snippets/store');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Confere aninhamento das tags (HTML parseável e bem formado). */
function checkBalanced(html) {
  const stack = [];
  const re = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    const tag = m[1].toLowerCase();
    if (m[0].startsWith('</')) {
      const top = stack.pop();
      if (top !== tag) return `fechou </${tag}> mas esperava </${top}>`;
    } else if (!VOID.has(tag) && !/\/\s*>$/.test(m[0])) {
      stack.push(tag);
    }
  }
  return stack.length ? `não fechou: ${stack.join(', ')}` : null;
}

const seed = loadSeed();

test('seed: cerca de 20 snippets com ids únicos e campos válidos', () => {
  assert.ok(seed.length >= 20 && seed.length <= 24, `tem ${seed.length}`);
  const ids = new Set(seed.map((s) => s.id));
  assert.equal(ids.size, seed.length);
  for (const s of seed) {
    assert.match(s.id, /^[a-z0-9-]+$/);
    assert.ok(s.name && s.category, s.id);
    assert.ok(LANGUAGES.includes(s.language), s.id);
    assert.ok(Array.isArray(s.tags));
    assert.ok(s.body.length > 100, `${s.id}: corpo curto`);
  }
});

test('seed: categorias da spec', () => {
  const count = (c) => seed.filter((s) => s.category === c).length;
  assert.equal(count('Hero'), 3);
  assert.equal(count('CTA'), 3);
  assert.equal(count('Formulário'), 3);
  assert.equal(count('Pricing'), 2);
  assert.equal(count('Prova social'), 2);
  assert.equal(count('Features'), 2);
  assert.equal(count('FAQ'), 1);
  assert.equal(count('Rodapé'), 2);
  assert.equal(count('Navbar'), 2);
  assert.equal(count('Card de produto'), 1);
  assert.equal(count('Banner de cookies'), 1);
});

for (const s of seed) {
  test(`seed ${s.id}: HTML bem formado, sem script/handlers/imagens externas`, () => {
    assert.equal(checkBalanced(s.body), null);
    assert.doesNotMatch(s.body, /<script/i);
    assert.doesNotMatch(s.body, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(s.body, /javascript:/i);
    assert.doesNotMatch(s.body, /<img[^>]+src=["']?https?:/i);
    assert.doesNotMatch(s.body, /url\(\s*["']?https?:/i);
    assert.doesNotMatch(s.body, /<(iframe|object|embed|link|meta|style)\b/i);
  });

  test(`seed ${s.id}: identidade via variáveis e acessibilidade básica`, () => {
    assert.match(s.body, /\{\{cor_primaria\}\}/);
    assert.doesNotMatch(s.body, /#D10A11|#0E0E0E/i, 'cores fixas devem vir de variáveis');
    for (const img of s.body.match(/<img\b[^>]*>/gi) || []) assert.match(img, /\balt=/);
    for (const svg of s.body.match(/<svg\b[^>]*>/gi) || []) assert.match(svg, /aria-hidden="true"|role="img"/);
    // Todo input visível tem rótulo (label for= ou aria-label).
    for (const input of s.body.match(/<(input|select|textarea)\b[^>]*>/gi) || []) {
      if (/type="(hidden|submit)"/.test(input)) continue;
      const id = /\bid="([^"]+)"/.exec(input)?.[1];
      const labelled = /aria-label=/.test(input) || (id && s.body.includes(`for="${id}"`));
      assert.ok(labelled, `${s.id}: campo sem rótulo: ${input}`);
    }
    // Responsivo: usa breakpoints do Tailwind.
    assert.match(s.body, /\b(sm|md|lg):/);
  });
}
