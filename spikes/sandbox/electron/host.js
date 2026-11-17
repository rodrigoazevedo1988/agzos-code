/* global esbuild, AGZ, spike */
'use strict';
const scenario = new URLSearchParams(location.search).get('scenario');
const now = () => performance.now();
const r1 = (x) => +x.toFixed(1);

// Monta N iframes sandbox (srcdoc) e espera o "ready" de cada um.
window.mountIframes = (html, n) =>
  new Promise((resolve) => {
    const msgs = [];
    const t0 = now();
    addEventListener('message', function on(e) {
      if (e.data && e.data.type === 'agz-sandbox:ready') {
        msgs.push({ ...e.data, ms: r1(now() - t0) });
        if (msgs.length === n) {
          removeEventListener('message', on);
          resolve(msgs);
        }
      }
    });
    for (let i = 0; i < n; i++) {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts'); // sem allow-same-origin: origem opaca
      f.srcdoc = html;
      document.body.appendChild(f);
    }
  });

async function text(p) {
  const t = await spike.readFile(p);
  if (t == null) throw new Error('não li ' + p);
  return t;
}

async function bench() {
  const { spike: S } = await spike.paths();
  const root = S + '/fixture';
  const io = { readFile: (p) => spike.readFile(p) };
  const out = {};

  // frio: ler o .wasm (IPC), compilar, iniciar worker, 1º build
  const t0 = now();
  const res = await fetch('../node_modules/esbuild-wasm/esbuild.wasm').catch(() => null);
  let wasmModule;
  if (res && res.ok) {
    wasmModule = await WebAssembly.compileStreaming(res);
    out.wasmLoad = 'fetch(file://)+compileStreaming';
  } else {
    out.wasmLoad = 'fetch falhou';
  }
  const tCompiled = now();
  await esbuild.initialize({ wasmModule, worker: true });
  const tInit = now();

  const run = async (react) => {
    const stats = { reads: 0, aliasHits: [], nodeModules: new Set(), tsconfig: null };
    const s = now();
    const r = await esbuild.build(
      AGZ.buildOptions({ projectRoot: root, shimsDir: S + '/shims', componentPath: root + '/src/components/Dashboard.tsx', mode: 'virtual', io, react, stats }),
    );
    return { ms: now() - s, kb: r.outputFiles[0].contents.length / 1024, reads: stats.reads, nm: [...stats.nodeModules] };
  };

  if (new URLSearchParams(location.search).get('warmup') === '1') {
    // pré-aquecimento no boot do app (fora do caminho do usuário): 1 transform de TSX trivial
    const w = now();
    await esbuild.transform('export const A = (p: {x: number}) => <div className="p-1">{p.x}</div>;', { loader: 'tsx', jsx: 'automatic' });
    out.warmupTransformMs = r1(now() - w);
    const w2 = now();
    await esbuild.build({ stdin: { contents: 'import x from "./a"; console.log(x)', loader: 'tsx' }, bundle: true, write: false,
      plugins: [{ name: 'v', setup(b) { b.onResolve({ filter: /.*/ }, (a) => ({ path: a.path, namespace: 'v' })); b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: 'export default <b>1</b>', loader: 'tsx' })); } }] });
    out.warmupBuildMs = r1(now() - w2);
  }
  const tFirst = now();
  const first = await run('external');
  out.firstAfterInitMs = r1(now() - tFirst);
  out.wasmCompileMs = r1(tCompiled - t0);
  out.initializeMs = r1(tInit - tCompiled);
  out.firstBuildMs = r1(first.ms);
  out.coldTotalMs = r1(tInit - t0 + first.ms); // sem o warmup
  out.firstReads = first.reads;
  const warm = [];
  for (let i = 0; i < 20; i++) warm.push((await run('external')).ms);
  warm.sort((a, b) => a - b);
  out.warmExternalMedianMs = r1(warm[10]);
  out.warmExternalP95Ms = r1(warm[18]);
  const full = [];
  for (let i = 0; i < 6; i++) full.push((await run('bundle')).ms);
  full.sort((a, b) => a - b);
  out.reactBundledFirstMs = r1(full[0]);
  out.reactBundledMedianMs = r1(full[3]);
  out.heapUsedMB = r1(performance.memory.usedJSHeapSize / 1048576);
  spike.result(out);
}

// ---------- Tailwind no iframe ----------
const PROBE = `
<script>window.__t0 = performance.now(); window.onerror = (m) => parent.postMessage({type:'tw', err: String(m)}, '*'); window.onunhandledrejection = (e) => parent.postMessage({type:'tw', err: 'rejection: ' + String(e.reason && e.reason.message || e.reason)}, '*');</script>`;
const PROBE_END = `
<script>
(function poll(){
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Novo cliente'));
  const rootDiv = document.querySelector('#root > div');
  const cs = btn && getComputedStyle(btn);
  const ok = cs && cs.backgroundColor === 'rgb(31, 111, 235)';
  const el = performance.now() - window.__t0;
  if (ok || el > 8000) {
    parent.postMessage({type:'tw', ok, styledMs: el, bg: cs && cs.backgroundColor, radius: cs && cs.borderRadius,
      pad: rootDiv && getComputedStyle(rootDiv).paddingTop, agz: !!document.querySelector('.bg-agz'),
      styleTags: document.querySelectorAll('style').length}, '*');
  } else requestAnimationFrame(poll);
})();
</script>`;

const THEME_V4 = `@theme {
  --color-brand-50: #eef7ff; --color-brand-500: #1f6feb; --color-brand-900: #0b2a5b;
  --color-agz: #ff5a1f; --spacing-18: 4.5rem; --radius-xl2: 1.25rem;
}`;

async function tw() {
  const { spike: S } = await spike.paths();
  const vendor = await text(S + '/out-vendor.js');
  const comp = await text(S + '/out-Dashboard-external.js');
  const css3 = await text(S + '/out-tw3.css');
  const play = await text(S + '/vendor-dl/tailwind-play-3.4.17.js');
  const tw4 = await text(S + '/node_modules/@tailwindcss/browser/dist/index.global.js');
  const cfg = await text(S + '/electron/gen/twcfg.js');
  const js = (s) => `<script>${s.replace(/<\/script/g, '<\\/script')}</script>`;
  const app = `<div id="root"></div>${js(vendor)}${js(comp)}`;
  const variants = {
    'v3-node-css-pregerado': `${PROBE}<style>${css3}</style>${app}${PROBE_END}`,
    'v3-play-cdn+config': `${PROBE}${js(play)}${js(cfg + ';tailwind.config = __twcfg.default || __twcfg;')}${app}${PROBE_END}`,
    'v4-browser+@theme': `${PROBE}${js(tw4)}<style type="text/tailwindcss">${THEME_V4}</style>${app}${PROBE_END}`,
    'v4-browser+@config': `${PROBE}${js(tw4)}<style type="text/tailwindcss">@config "./tailwind.config.js";</style>${app}${PROBE_END}`,
  };
  const out = {};
  for (const [name, body] of Object.entries(variants)) {
    out[name] = [];
    for (let i = 0; i < 3; i++) {
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
      const r = await new Promise((resolve) => {
        const errs = [];
        const f = document.createElement('iframe');
        const t0 = now();
        const on = (e) => {
          if (e.source !== f.contentWindow || !e.data || e.data.type !== 'tw') return;
          if (e.data.err) return void errs.push(e.data.err);
          removeEventListener('message', on);
          resolve({ ...e.data, type: undefined, styledMs: r1(e.data.styledMs), hostMs: r1(now() - t0), errs });
        };
        addEventListener('message', on);
        f.setAttribute('sandbox', 'allow-scripts');
        f.srcdoc = html;
        document.body.appendChild(f);
      });
      out[name].push(r);
      document.querySelectorAll('iframe').forEach((f) => f.remove());
    }
    out[name + ' (KB do runtime)'] = { 'v3-node-css-pregerado': r1(css3.length / 1024), 'v3-play-cdn+config': r1(play.length / 1024), 'v4-browser+@theme': r1(tw4.length / 1024), 'v4-browser+@config': r1(tw4.length / 1024) }[name];
  }
  spike.result(out);
}

// ---------- Shims next/* (pergunta 3) ----------
async function shims() {
  const { spike: S } = await spike.paths();
  const vendor = await text(S + '/out-vendor.js');
  const js = (s) => `<script>${s.replace(/<\/script/g, '<\\/script')}</script>`;
  const test = (comp, script) => new Promise((resolve) => {
    const nav = [];
    const f = document.createElement('iframe');
    const on = (e) => {
      if (e.source !== f.contentWindow) return;
      if (e.data.type === 'agz-sandbox:navigate') nav.push(e.data.kind + ' ' + e.data.href);
      if (e.data.type === 'shim-result') { removeEventListener('message', on); f.remove(); resolve({ ...e.data.r, navigateMsgs: nav }); }
      if (e.data.type === 'agz-sandbox:error') { removeEventListener('message', on); resolve({ error: e.data.message.slice(0, 300) }); }
    };
    addEventListener('message', on);
    f.setAttribute('sandbox', 'allow-scripts');
    f.srcdoc = `<!doctype html><meta charset=utf-8><script>window.__AGZ_SANDBOX__={pathname:'/customers',search:'?q=ana',params:{id:'7'}}</script><div id=root></div>${js(vendor)}${js(comp)}<script>${script}</script>`;
    document.body.appendChild(f);
  });
  const wait = `const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));`;
  const dash = await test(await text(S + '/out-Dashboard-external.js'), `${wait}(async()=>{await sleep(300);
    const r={}; r.inputValue=document.querySelector('input[placeholder]').value; r.rowsComQ=document.querySelectorAll('tbody tr').length;
    r.pathShown=document.querySelector('h1+p').textContent.split(' ')[0];
    const a=document.querySelector('a[href="/settings"]'); a.click(); await sleep(100);
    r.locationAposLink=location.href; r.pathAposLink=document.querySelector('h1+p').textContent.split(' ')[0];
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Novo cliente').click(); await sleep(100);
    r.pathAposPush=document.querySelector('h1+p').textContent.split(' ')[0];
    r.imgs=[...document.querySelectorAll('img')].slice(0,1).map(i=>i.getAttribute('src')+' '+i.width+'x'+i.height);
    parent.postMessage({type:'shim-result', r},'*')})()`);
  const legacy = await test(await text(S + '/out-LegacyNav-external.js'), `${wait}(async()=>{await sleep(300);
    const r={}; r.asPath=document.querySelector('[data-testid=path]').textContent;
    r.linkHref=document.querySelector('[data-testid=link]').getAttribute('href');
    r.lazyRendered=document.body.textContent.includes('lazy');
    document.querySelector('[data-testid=push]').click(); await sleep(100);
    r.asPathAposPush=document.querySelector('[data-testid=path]').textContent;
    parent.postMessage({type:'shim-result', r},'*')})()`);
  spike.result({ dashboard: dash, legacyNav: legacy });
}

if (scenario === 'shims') shims().catch((e) => spike.result({ error: String(e && e.stack || e) }));
if (scenario === 'bench') bench().catch((e) => spike.result({ error: String(e && e.stack || e) }));
if (scenario === 'tw') tw().catch((e) => spike.result({ error: String(e && e.stack || e) }));
