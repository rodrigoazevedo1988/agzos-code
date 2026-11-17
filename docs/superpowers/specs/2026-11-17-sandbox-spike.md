# Spike do Sandbox de Componentes — resultado

Data: 2026-11-17 · Tarefa 15 do plano `2026-11-17-modulos-nativos-1.1.0` · Código: `spikes/sandbox/` (sem dependências; `npm install` dentro da pasta para reproduzir).

## Veredito

**Viável**, com uma condição: compilar com **esbuild nativo no processo Node do app** (main ou `utilityProcess`), e não com `esbuild-wasm` no renderer. O wasm não atinge 500 ms a frio (1,9–3,4 s no renderer). O nativo compila o componente em ~40 ms a quente e 91–231 ms a frio.

Arquitetura sugerida:

1. **Compilação (utilityProcess):** esbuild nativo + plugin `agz-sandbox` (shims `next/*`, React dos shims resolvido a partir do projeto). Os aliases do `tsconfig` o esbuild nativo já resolve sozinho.
2. **React em bundle separado (vendor):** gerado 1x por projeto a partir do React do próprio projeto, com cache por hash do lockfile. Custo: ~190–230 ms, 1,1 MB em dev. O componente vira um bundle de ~25 KB, que lê `window.__AGZ_VENDOR__`.
3. **Tailwind:** usar o `tailwindcss` **do próprio projeto** no mesmo utilityProcess (via `createRequire(projeto)`), com o `tailwind.config` real. O `content` são só os arquivos do metafile do esbuild. Custo: 57–73 ms a quente. Cache em disco: 0 MB embutidos. Fallback sem `node_modules`: `@tailwindcss/browser` (281 KB) com `@theme` traduzido.
4. **Isolamento:** `iframe sandbox="allow-scripts"` (sem `allow-same-origin`), com `srcdoc` e CSP `default-src 'none'` dentro do renderer do editor. O Chromium do Electron 32 já põe o iframe sandbox **em processo próprio**. Cada preview adicional custa ~5–8 MB PSS, contra ~35 MB numa `WebContentsView`.

**MB a embutir:** ~11,4 MB (Linux x64) / ~11,7 MB (Windows x64) do binário do esbuild (4,7 MB gzip no instalador), mais ~15 KB de shims e plugin. Opcionalmente, 0,28 MB do `@tailwindcss/browser` como fallback. Total: **≈ 12 MB por plataforma**.

## Ambiente e método

- VPS Linux 6.8, 12 vCPU, 48 GB, **sem display** (`xvfb-run -a`). Load average de 4,3–6,2 durante as medições, com swap em uso. Os números têm ruído, por isso trago faixas e repetições.
- Node 22.23.5. Electron 32.3.3, o binário do projeto (`/var/www/agzos-code/node_modules/electron/dist/electron`), rodando com `--no-sandbox --disable-gpu` porque o processo roda como root sem GPU.
- Versões: esbuild/esbuild-wasm 0.28.2, React 19.2.0, tailwindcss 3.4.19, @tailwindcss/browser 4.3.5, Play CDN v3.4.17 (baixado de `cdn.tailwindcss.com/3.4.17`).
- Fixture (`spikes/sandbox/fixture/`): `Dashboard.tsx` com **379 linhas** e 5 imports locais. Quatro desses imports usam alias (`@/components/ui/Button`, `~ui/Card`, `@/lib/format`, `@/hooks/useToggle`) e um é relativo (`./StatTile`). Usa também `clsx` (node_modules), `next/link`, `next/image`, `next/navigation`, `useReducer`/`useMemo` e TS com tipos. `tsconfig.json` em JSONC (comentários, vírgula final) com 2 aliases. `tailwind.config.js` com cores, spacing e radius customizados. `LegacyNav.tsx` exercita `next/router`, `next/head`, `next/dynamic` e `next/link` com objeto.
- Os arquivos `out-*` são gerados com `npm run prep:bundles && npm run prep:gen && npm run prep:play` dentro de `spikes/sandbox`.
- "Frio" = processo novo: `require` + `initialize` (wasm) + 1º build. "Quente" = builds seguintes no mesmo processo (mediana/p95).

## 1. esbuild-wasm compila em < 500 ms?

**A frio, não. A quente, sim na mediana, mas o p95 passa de 500 ms no renderer.** O nativo é ~4–7× mais rápido.

### Node (processo novo, 5 repetições; React externo)

Comando: `for i in 1 2 3 4 5; do node bench-esbuild.js --engine <e> --mode <m> --react <r> --runs 1; done` (campo `coldTotalMs`).

| Motor | Modo | React | Frio (5 execuções, ms) |
|---|---|---|---|
| esbuild nativo | fs | externo | 160,8 · 230,7 · 133,2 · 91,0 · 103,7 |
| esbuild nativo | fs | no bundle | 276,2 · 263,3 · 247,7 · 360,8 · 273,6 |
| esbuild-wasm (Node) | fs | externo | 968,6 · 1386,2 · 1685,4 · 1364,9 · 1268,9 |
| esbuild-wasm (Node) | virtual (plugin lê tudo) | externo | 1073,3 · 1867,7 · 904,1 · 940,7 · 1029,5 |

### Node (quente; 30 builds, mediana / p95 em ms)

Comandos: `node bench-esbuild.js --engine <e> --mode <m> --react <r> --runs 30` (com `build()` novo a cada vez). Com `--ctx`, usa `context().rebuild()` e o cache do plugin persiste.

| Motor / modo | React externo `build()` | React externo `--ctx` | React no bundle `build()` |
|---|---|---|---|
| nativo / fs | **42,9 / 70,4** | 37,8 / 93,8 | 199,4 / 277,6 |
| wasm / fs | 284,5 / 466,6 | 192,8 / 496,1 | 969,8 / 1284,9 |
| wasm / virtual | 141,2 / 196,0 | 107,4 / 191,9 | 678,4 / 946,7 |

- Saída: 24,8 KB (React externo) contra 1.122 KB (React no bundle, dev).
- Bundle vendor (React + react-dom/client + jsx-runtime, 1.112 KB). Comando: `node bench-esbuild.js --engine <e> --react external --vendor --runs 5`. Nativo: 1º build 231,6 ms, mediana 187,5 ms. Wasm: 1º build 1.866 ms, mediana 933 ms.
- RAM do serviço do esbuild nativo (processo filho) após 10 builds: **24,6 MB RSS**. Comando: `node mem-esbuild.js`.

### Renderer do Electron (esbuild-wasm `browser.min.js`, `worker: true`, arquivos via IPC)

Comando: `xvfb-run -a .../electron --no-sandbox --disable-gpu electron/main.js --scenario bench [--warmup 1]` (3 execuções de cada).

| | Sem aquecimento (3 execuções) | Com aquecimento no boot (3 execuções) |
|---|---|---|
| `fetch` + `compileStreaming` do .wasm | 216 · 112 · 109 ms | 125 · 133 · 107 ms |
| `initialize` | 65 · 42 · 34 ms | 49 · 47 · 35 ms |
| aquecimento (transform TSX trivial + mini-build) | — | 1099+174 · 1142+258 · 1606+284 ms |
| **1º build do Dashboard** | **2693 · 3242 · 2207 · 1793 ms** | **908 · 971 · 1027 ms** |
| quente, mediana / p95 (20 builds) | 325/918 · 239/804 · 196/506 · 156/452 | 188/333 · 161/566 · 181/462 |
| React no bundle, mediana | 693–870 ms | 692–902 ms |
| heap JS do renderer | 25–34 MB | 28–34 MB |

O primeiro build no renderer é dominado pelo aquecimento do JIT do wasm (Go). Mesmo pré-aquecendo no boot do app, o 1º build real fica perto de 1 s.

## 2. Aliases do tsconfig e node_modules do projeto

**Funciona.**

- **esbuild nativo (e wasm no Node com fs) já lê `compilerOptions.paths`/`baseUrl` sozinho**, inclusive com JSONC. Verificado sem plugin nenhum pelo `metafile`. Comando: `node -e "require('esbuild').buildSync({entryPoints:['fixture/src/components/Dashboard.tsx'],bundle:true,write:false,metafile:true,jsx:'automatic',external:['react','react/*','react-dom','next/*'],logLevel:'silent'})..."`. Os 5 arquivos locais e `clsx/dist/clsx.mjs` foram resolvidos.
- **Modo virtual (wasm no browser, sem fs):** o plugin `lib/resolver.js` (8,6 KB, ~200 linhas) faz o trabalho:
  - lê `tsconfig.json`/`jsconfig.json` (JSONC);
  - aplica `paths` com curinga (prefixo mais longo vence);
  - resolve relativos com extensões e `index.*`;
  - resolve pacotes subindo `node_modules`, usando `exports` com condições `browser/import/module/default`, depois `module`/`main`.
  - Resultado no bench: 5 aliases resolvidos e os pacotes `react`, `react-dom/client`, `scheduler`, `react-dom`, `clsx` e `react/jsx-runtime`, com 19–21 leituras (React externo) ou 50 (React no bundle).
- **Armadilha encontrada:** os shims ficam fora do projeto, e o `import 'react'` deles resolvia o React da pasta do shim, o que gera duas cópias de React. A correção já está no plugin: `build.resolve(path, { resolveDir: projectRoot })` quando o importador é um shim.
- **Não implementado no modo virtual:** `extends` do tsconfig, o campo `imports` (`#alias`) do package.json, symlinks do pnpm e workspaces. Isso é mais um motivo para usar o nativo (com fs), onde o esbuild cobre tudo.

## 3. Shims de next/*

**Funcionam.** Ficam em `spikes/sandbox/shims/`, com 6,5 KB no total:

- `link`: `<a>` que chama `preventDefault` e faz `postMessage` ao host; aceita `href` objeto, `as`, `replace` e `legacyBehavior`.
- `image`: `<img>` com `fill`, import estático `{src,width,height}` e reescrita de `/x.png` para `publicBase`.
- `navigation`: `useRouter`, `usePathname`, `useSearchParams`, `useParams`, `useSelectedLayoutSegment(s)`, `notFound`, `redirect`.
- `router`: `useRouter` com `query`/`asPath`/`events`, `withRouter`, `Router` default.
- `head`: no-op.
- `dynamic`: `lazy` + `Suspense`.

O estado de rota é injetável via `window.__AGZ_SANDBOX__ = { pathname, search, params, props }`.

Teste funcional (comando: `xvfb-run -a .../electron --no-sandbox --disable-gpu electron/main.js --scenario shims`):

- **Dashboard** com `pathname:'/customers'` e `search:'?q=ana'`:
  - o `useSearchParams` preencheu o input (`"ana"`) e filtrou para 5 linhas;
  - o `usePathname` mostrou `/customers`;
  - o clique em `<Link href="/settings">` **não navegou o iframe** (`location` continuou `about:srcdoc`), atualizou o pathname para `/settings` e enviou `push /settings` ao host;
  - o `router.push('/customers/new')` atualizou para `/customers/new`;
  - o `next/image` virou `<img src="/avatars/20.png">`.
- **LegacyNav:**
  - `asPath` = `/customers?q=ana`;
  - `Link href={{pathname:'/blog',query:{p:2}}}` virou `/blog?p=2`;
  - o `next/dynamic` renderizou o componente lazy;
  - o `router.push('/x?y=1')` atualizou o `asPath` e notificou o host.

## 4. Tailwind offline no iframe

Comandos:

- Node: `node tailwind-v3-node.js --runs 10` (2 execuções).
- Iframe: `xvfb-run -a .../electron --no-sandbox --disable-gpu electron/main.js --scenario tw` (2 execuções, 3 iframes novos por variante).

Em todos os casos, "estilizado" significa que o botão primário tem `rgb(31,111,235)` (`brand-500` do config), `p-18` = 72 px e `rounded-xl2` = 20 px. O tempo é medido do início do documento do iframe até o estilo aplicado, e **inclui o render do React**.

| Variante | Lê o `tailwind.config` do projeto? | Tamanho do runtime | Tempo até estilizado (ms) |
|---|---|---|---|
| **v3 no Node** (tailwind do projeto + postcss) gera CSS e injeta `<style>` | **Sim, nativo** (incl. plugins) | 0 MB embutidos se usar o do projeto; 15,5 MB se o app embutir tailwind v3 e deps; CSS gerado 15,8 KB | iframe: 254/167/152 e 214/198/183. Geração no Node: frio 714–838 (require 292–376 + 1ª 422–462), quente **57–73** |
| v3 Play CDN (`cdn.tailwindcss.com/3.4.17`) + config bundlado em IIFE (`tailwind.config = ...`) | Sim (config JS executado no iframe) | 398 KB (123 KB gzip); não existe no npm, precisa vendorizar o download | 629/684/820 e 710/670/765 |
| v4 `@tailwindcss/browser` + `@theme` traduzido do config | Só via tradução manual para `@theme` | 281 KB (75 KB gzip) | 635/390/397 e 405/561/384 |
| v4 `@tailwindcss/browser` + `@config "./tailwind.config.js"` | **Não**: `The browser build does not support plugins or config files.` (Promise rejeitada; nenhum CSS gerado) | 281 KB | falhou (timeout 8 s) |

O custo do runtime no iframe, descontado o render do React (~150–250 ms), fica assim:

- Play CDN: **+~450–600 ms** por montagem.
- v4 browser: **+~200–350 ms** por montagem.
- CSS pré-gerado no Node: ~0 ms no iframe e 57–73 ms no Node a quente.

**Recomendação:** gerar o CSS no utilityProcess com o Tailwind **do projeto**, o que garante versão e plugins idênticos aos do projeto. Para projetos v4, o caminho equivalente é `@tailwindcss/node` do projeto compilando o `globals.css` (não medido neste spike). Para projeto sem `node_modules`, usar `@tailwindcss/browser` como fallback, apenas com o tema traduzido.

## 5. RAM: WebContentsView com partition vs iframe sandbox

Comando: `xvfb-run -a .../electron --no-sandbox --disable-gpu electron/main.js --scenario <s> --n <N>`.

- Δ = depois − antes, somando PSS/RSS de `/proc/<pid>/smaps_rollup` de todos os processos de `app.getAppMetrics()`. São 3 amostras com 1 s de intervalo, e uso a mediana.
- Documento: CSS v3 + vendor React + Dashboard (1,2 MB de HTML).
- Linha de base (host vazio): 4 processos, RSS ~450 MB, PSS 158–237 MB. O PSS oscila conforme o compartilhamento de páginas.

| Cenário | Processos depois | ΔPSS (MB) | ΔRSS (MB) | Carga até pronto |
|---|---|---|---|---|
| iframe sandbox ×1 | 5 (+1) | 44,5 · 48,1 · 49,8 | 127,7 · 127,3 · 127,9 | 253 ms |
| iframe sandbox ×3 | 5 (+1, compartilhado) | 53,7 · 64,6 | 142,5 · 143,2 | 406–564 ms |
| WebContentsView, partition própria (em memória) ×1 | 5 (+1) | 31,5 · 44,5 · 32,5 | 122,7 · 122,9 · 123,0 | 409 ms |
| WebContentsView, partition própria ×3 | 7 (+3) | 103,4 · 103,2 | 348,4 · 347,9 | 936 ms |
| WebContentsView, sessão padrão ×1 | 5 (+1) | 42,4 | 121,6 | 452 ms |
| WebContentsView, sessão padrão ×3 | 7 (+3) | 105,9 | 349,1 | 1600 ms |

Leitura dos números:

- **A primeira instância custa o mesmo nos dois modelos** (~120–128 MB RSS, ~32–50 MB PSS). O iframe sandbox sem `allow-same-origin` já roda em processo próprio no Electron 32 (OOPIF; ver `procsAfter` no JSON).
- **Cada instância extra:** o iframe custa ~+5–8 MB PSS e +~8 MB RSS, porque os iframes sandbox compartilham o mesmo processo. A WebContentsView custa ~+35 MB PSS e +~113 MB RSS (um processo por view).
- **A partition própria não tem custo de RAM mensurável** em relação à sessão padrão. Ela só isola cookies, storage e cache.

## Riscos

- **Cross-build Windows na VPS:** o `npm install` no Linux só baixa `@esbuild/linux-x64`. Para o instalador Windows, é preciso instalar `@esbuild/win32-x64` explicitamente (`npm i --os=win32 --cpu=x64` no stage ou dependência opcional fixa) e marcar `asarUnpack` para o binário. O padrão já existe no projeto por causa do `node-pty`.
- **Código do usuário executa no iframe**, incluindo dependências npm. Mitigações:
  - origem opaca (sem `allow-same-origin`);
  - CSP `default-src 'none'` no `srcdoc`;
  - sem `nodeIntegration`;
  - navegação via `postMessage` validado pelo host.
  
  Efeito colateral: componentes que fazem `fetch` quebram. É preciso decidir se haverá um modo "rede permitida".
- **Medição com `--no-sandbox`** (root na VPS): o sandbox de SO estava desligado. O modelo de processos é o mesmo, mas a RAM pode variar um pouco com o zygote sandboxed.
- **Ruído da VPS** (load 4–6, swap em uso): os tempos absolutos podem ser 1,5–2× melhores numa máquina de dev ociosa. As proporções entre motores se mantiveram em todas as repetições.
- **Imagens de `public/`:** o iframe opaco não carrega `file://`. É preciso registrar um protocolo (ex. `agz-public://`) com privilégios, ou inlinear como data URL. No teste, a imagem ficou quebrada de propósito.
- **React do projeto:** o vendor é gerado do React instalado no projeto. Se o projeto não tiver `node_modules`, o sandbox não roda; é preciso decidir se haverá um React embutido de fallback (+~1,1 MB dev).

## O que não funciona (ou não foi coberto)

- **Server Components / Server Actions:** `async` components, `'use server'`, `next/headers`, `cookies()`, `next/font`, `getServerSideProps`/`getStaticProps` e `fetch` com cache do Next. O sandbox é só client-side.
- **Providers do layout** (tema, i18n, React Query, Redux): o componente renderiza sem eles. É preciso um "wrapper" configurável por projeto (ex. `agzos.sandbox.tsx`).
- **CSS importado no componente:** `import './x.css'`, CSS Modules (`.module.css`, possível com o loader `local-css` do esbuild) e `import img from './x.png'` (loader `dataurl`/`file`). Nenhum foi medido.
- **Variáveis `process.env.NEXT_PUBLIC_*`:** precisam de `define` lido do `.env` (a integração com o EnvVault é natural).
- **v4 `@tailwindcss/browser`** não lê `tailwind.config.js` nem plugins (erro explícito acima).
- **Modo virtual do resolver:** sem `extends` do tsconfig, sem `imports` (#) do package.json e sem pnpm/workspaces. Isso é irrelevante se a escolha for o esbuild nativo.

## Reproduzir

```bash
cd spikes/sandbox && npm install
npm run prep:bundles && npm run prep:gen && npm run prep:play
node bench-esbuild.js --engine native --mode fs --react external --runs 30
node bench-esbuild.js --engine wasm --mode virtual --react external --runs 30 --ctx
node tailwind-v3-node.js --runs 10
node mem-esbuild.js
xvfb-run -a /var/www/agzos-code/node_modules/electron/dist/electron --no-sandbox --disable-gpu electron/main.js --scenario bench --warmup 1
xvfb-run -a /var/www/agzos-code/node_modules/electron/dist/electron --no-sandbox --disable-gpu electron/main.js --scenario tw
xvfb-run -a /var/www/agzos-code/node_modules/electron/dist/electron --no-sandbox --disable-gpu electron/main.js --scenario shims
xvfb-run -a /var/www/agzos-code/node_modules/electron/dist/electron --no-sandbox --disable-gpu electron/main.js --scenario wcv --n 3
rm -rf "$PWD/node_modules"
```
