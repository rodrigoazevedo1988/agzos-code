/**
 * Biblioteca inicial de snippets (src/main/modules/snippets/seed/).
 * `seed/index.json` lista os metadados ({ id, name, category, language, tags, file });
 * o corpo de cada um fica em `seed/html/<file>` (HTML + Tailwind, legível e revisável).
 * Cores, fonte, marca e contatos vêm de variáveis ({{cor_primaria}}…), trocadas na inserção.
 */

const fs = require('node:fs');
const path = require('node:path');

const SEED_DIR = path.join(__dirname, 'seed');
let cached = null;

function loadSeed() {
  if (cached) return cached.map((s) => ({ ...s, tags: [...s.tags] }));
  const index = JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'index.json'), 'utf8'));
  cached = index.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    language: m.language || 'tailwind',
    tags: Array.isArray(m.tags) ? m.tags : [],
    body: fs.readFileSync(path.join(SEED_DIR, 'html', path.basename(m.file)), 'utf8'),
  }));
  return loadSeed();
}

module.exports = { loadSeed, SEED_DIR };
