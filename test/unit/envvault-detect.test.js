const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { detectSecrets, shannon } = require('../../src/main/modules/envvault/detect');
const { scanStagedDiff, isRealEnvFile, scanStaged } = require('../../src/main/modules/envvault/staged');

// Valores SINTÉTICOS montados em tempo de execução (nada de chave real no repositório,
// e nada que um scanner de push reconheça no código-fonte do teste).
const j = (...parts) => parts.join('');
const RAND = 'Q7r2M9k4T8w1P6z3B5n0Y4c8H2j6L1x9V3d7F5g0S8a2';
const UP = 'Z3Q7R2M9K4T8W1P6';
const FAKE = {
  aws: j('AK', 'IA', UP),
  awsTemp: j('AS', 'IA', UP),
  awsSecret: j('aws_secret_access_key = ', 'wJa1rXUt9nFEMIK7MDE3NGbPxR8fiCY2Q4zW6vLk'),
  stripeLive: j('sk_', 'live_', RAND.slice(0, 24)),
  stripeRestricted: j('rk_', 'live_', RAND.slice(0, 24)),
  stripeTest: j('sk_', 'test_', RAND.slice(0, 24)),
  openaiProj: j('sk-', 'proj-', RAND),
  openaiLegacy: j('sk-', RAND.slice(0, 44)),
  anthropic: j('sk-', 'ant-', 'api03-', RAND),
  github: j('gh', 'p_', RAND.slice(0, 36)),
  githubOauth: j('gh', 'o_', RAND.slice(0, 36)),
  githubPat: j('github_', 'pat_', '11ABCDEFG0', RAND),
  google: j('AI', 'za', 'Sy', RAND.slice(0, 33)),
  slack: j('xo', 'xb-', '1234567890-', RAND.slice(0, 20)),
  privateKey: j('-----BEGIN ', 'RSA PRIVATE KEY-----'),
  urlCreds: j('postgres://admin:', 'Hj7Kq2Lm9Np4@db.exemplo.com:5432/app'),
};
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => j('eyJ', b64u({ alg: 'HS256', typ: 'JWT' }).slice(3), '.', b64u(payload), '.', RAND.slice(0, 43));

const rules = (text, opts) => detectSecrets(text, opts).map((f) => f.rule);

test('detecta cada padrão embutido', () => {
  const cases = [
    [`KEY=${FAKE.aws}`, 'aws-access-key'],
    [`KEY=${FAKE.awsTemp}`, 'aws-access-key'],
    [FAKE.awsSecret, 'aws-secret-key'],
    [`STRIPE=${FAKE.stripeLive}`, 'stripe'],
    [`STRIPE=${FAKE.stripeRestricted}`, 'stripe'],
    [`STRIPE=${FAKE.stripeTest}`, 'stripe'],
    [`OPENAI=${FAKE.openaiProj}`, 'openai'],
    [`OPENAI=${FAKE.openaiLegacy}`, 'openai'],
    [`ANTHROPIC=${FAKE.anthropic}`, 'anthropic'],
    [`GH=${FAKE.github}`, 'github'],
    [`GH=${FAKE.githubOauth}`, 'github'],
    [`GH=${FAKE.githubPat}`, 'github'],
    [`GOOGLE=${FAKE.google}`, 'google-api-key'],
    [`SLACK=${FAKE.slack}`, 'slack'],
    [FAKE.privateKey, 'private-key'],
    [`DATABASE_URL=${FAKE.urlCreds}`, 'url-credentials'],
    [`SUPABASE_KEY=${jwt({ iss: 'supabase', role: 'service_role' })}`, 'jwt'],
    [`MY_SERVICE_SECRET=${RAND.slice(0, 24)}`, 'generic-secret'],
    [`db_password: "${RAND.slice(4, 24)}"`, 'generic-secret'],
  ];
  for (const [text, rule] of cases) {
    assert.deepEqual(rules(text), [rule], `${rule} em ${text.slice(0, 12)}`);
  }
});

test('linha, coluna e preview (4 caracteres + …) nunca contém o valor completo', () => {
  const text = `# topo\nconst a = 1; const k = "${FAKE.aws}";\n`;
  const [f] = detectSecrets(text);
  assert.equal(f.line, 2);
  assert.equal(f.column, text.split('\n')[1].indexOf(FAKE.aws) + 1);
  assert.equal(f.preview, `${FAKE.aws.slice(0, 4)}…`);
  const all = Object.values(FAKE).map((v) => detectSecrets(`X=${v}`)).flat();
  for (const finding of all) {
    assert.equal(finding.preview.length, 5);
    assert.ok(!('value' in finding));
    for (const v of Object.values(FAKE)) assert.ok(!JSON.stringify(finding).includes(v));
  }
});

test('negativos: placeholders, referências e hashes', () => {
  const negatives = [
    'OPENAI_API_KEY=sk-test-placeholder',
    'API_KEY=your-api-key',
    'API_KEY=your_api_key_here_123456',
    'TOKEN=<TOKEN>',
    'SECRET=${API_KEY}',
    'PASSWORD=changeme',
    'PASSWORD=xxxxxxxxxxxxxxxxxxxx',
    'const key = process.env.OPENAI_API_KEY;',
    'const apiKey = config.services.openai.apiKeyValue;',
    'const token = await fetchTokenFromServer(user);',
    'id = "550e8400-e29b-41d4-a716-446655440000"',
    'SESSION_SECRET=550e8400-e29b-41d4-a716-446655440000',
    'integrity: sha512-Wb3Hx1Q0Ok2pN0mSqFQf1nJbHq0ZtYxW8o5H2k9bL3pQ7rT6uV4wX1yZ2aB3cD4eF5gH6iJ7kL8mN9oP0qR1s==',
    '"integrity": "sha512-Wb3Hx1Q0Ok2pN0mSqFQf1nJbHq0ZtYxW8o5H2k9bL3pQ7rT6uV4wX1yZ2aB3cD4eF5gH6iJ7kL8mN9oP0qR1s=="',
    'PASSWORD=short',
    'DATABASE_URL=postgres://user:password@localhost:5432/db',
    'DATABASE_URL=postgres://user:${DB_PASS}@localhost/db',
    'https://example.com/a:b',
    `ANON_KEY=${jwt({ iss: 'supabase', role: 'anon' })}`,
    'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
  ];
  for (const text of negatives) assert.deepEqual(rules(text), [], text);
});

test('lockfiles inteiros são ignorados', () => {
  const lock = `{\n  "x": { "resolved": "https://r.example/x.tgz", "token": "${RAND}" , "k": "${FAKE.aws}" }\n}`;
  for (const fileName of ['package-lock.json', 'sub/yarn.lock', 'pnpm-lock.yaml']) {
    assert.deepEqual(detectSecrets(lock, { fileName }), [], fileName);
  }
  assert.equal(detectSecrets(lock, { fileName: 'config.json' }).length > 0, true);
});

test('allowlist silencia por valor ou por sha256', () => {
  const text = `KEY=${FAKE.aws}`;
  assert.deepEqual(rules(text, { allowlist: [FAKE.aws] }), []);
  const h = crypto.createHash('sha256').update(FAKE.aws).digest('hex');
  assert.deepEqual(rules(text, { allowlist: [h] }), []);
  assert.deepEqual(rules(text, { allowlist: [`sha256:${h}`] }), []);
  assert.deepEqual(rules(text, { allowlist: ['outro'] }), ['aws-access-key']);
});

test('extraPatterns detecta (grupo 1 ou match inteiro) e ignora regex inválida', () => {
  const extra = [{ name: 'interno', regex: 'INT-([0-9]{8})' }, { name: 'quebrado', regex: '(' }];
  const [f] = detectSecrets('codigo INT-12345678 aqui', { extraPatterns: extra });
  assert.equal(f.rule, 'interno');
  assert.equal(f.preview, '1234…');
  assert.equal(f.column, 12);
  assert.deepEqual(rules('ACME_9f8e7d', { extraPatterns: [{ name: 'acme', regex: 'ACME_[0-9a-f]+' }] }), ['acme']);
});

test('shannon: entropia de strings conhecidas', () => {
  assert.equal(shannon('aaaa'), 0);
  assert.equal(shannon('abcd'), 2);
  assert.ok(shannon(RAND) > 3.5);
});

const DIFF = [
  'diff --git a/config.js b/config.js',
  'index 0000000..1111111 100644',
  '--- a/config.js',
  '+++ b/config.js',
  '@@ -3,0 +4,2 @@ const x = 1;',
  '+const a = 1;',
  `+const k = "${FAKE.aws}";`,
  '@@ -20 +22 @@',
  '-const old = 1;',
  `+const gh = "${FAKE.github}";`,
  'diff --git a/package-lock.json b/package-lock.json',
  '--- a/package-lock.json',
  '+++ b/package-lock.json',
  '@@ -1,0 +1 @@',
  `+  "k": "${FAKE.aws}"`,
  'diff --git a/gone.js b/gone.js',
  'deleted file mode 100644',
  '--- a/gone.js',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  `-const k = "${FAKE.aws}";`,
  'diff --git "a/caf\\303\\251 x.js" "b/caf\\303\\251 x.js"',
  '--- "a/caf\\303\\251 x.js"',
  '+++ "b/caf\\303\\251 x.js"',
  '@@ -0,0 +1 @@',
  `+${FAKE.privateKey}`,
  '\\ No newline at end of file',
].join('\n');

test('scanStagedDiff: só linhas +, numeradas pela linha nova de cada hunk', () => {
  const out = scanStagedDiff(DIFF);
  assert.deepEqual(out.map((f) => [f.file, f.line, f.rule]), [
    ['config.js', 5, 'aws-access-key'],
    ['config.js', 22, 'github'],
    ['café x.js', 1, 'private-key'],
  ]);
  assert.ok(!JSON.stringify(out).includes(FAKE.aws));
});

test('isRealEnvFile: .env e .env.* exceto example/sample/template', () => {
  for (const p of ['.env', '.env.local', 'apps/web/.env.production', '.env.development.local']) assert.equal(isRealEnvFile(p), true, p);
  for (const p of ['.env.example', 'a/.env.sample', '.env.template', 'env.js', '.envrc', 'x.env', 'README.md']) assert.equal(isRealEnvFile(p), false, p);
});

let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-envscan-')));
  git('init', '-q');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test('scanStaged: repositório sem commits', async () => {
  fs.writeFileSync(path.join(repo, 'a.js'), `const k = "${FAKE.stripeLive}";\n`);
  fs.writeFileSync(path.join(repo, '.env'), 'A=1\n');
  fs.writeFileSync(path.join(repo, '.env.example'), 'A=\n');
  git('add', '-A');
  const r = await scanStaged(repo);
  assert.deepEqual(r.findings.map((f) => [f.file, f.line, f.rule]), [['a.js', 1, 'stripe']]);
  assert.deepEqual(r.envFiles, ['.env']);
});

test('scanStaged: detached HEAD e só o que está staged', async () => {
  fs.writeFileSync(path.join(repo, 'a.js'), 'const a = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'um');
  git('checkout', '-q', '--detach');
  fs.writeFileSync(path.join(repo, 'a.js'), `const a = 1;\nconst t = "${FAKE.anthropic}";\n`);
  fs.writeFileSync(path.join(repo, 'b.js'), `const t = "${FAKE.github}";\n`); // não staged
  git('add', 'a.js');
  const r = await scanStaged(repo);
  assert.deepEqual(r.findings.map((f) => [f.file, f.line, f.rule]), [['a.js', 2, 'anthropic']]);
  assert.deepEqual(r.envFiles, []);
});
