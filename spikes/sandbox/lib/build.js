'use strict';
// Monta as opções de build do Sandbox (compartilhado por Node e renderer).
const { createSandboxPlugin } = require('./resolver.js');

const VENDOR_IDS = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

function entryCode(componentPath) {
  return `
import { createElement, Component } from 'react';
import { createRoot } from 'react-dom/client';
import * as M from ${JSON.stringify(componentPath)};
const C = M.default || Object.values(M).find((v) => typeof v === 'function');
class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { parent.postMessage({ type: 'agz-sandbox:error', message: String(err && err.stack || err) }, '*'); }
  render() { return this.state.err ? createElement('pre', { style: { color: 'red' } }, String(this.state.err)) : this.props.children; }
}
createRoot(document.getElementById('root')).render(
  createElement(Boundary, null, createElement(C, (window.__AGZ_SANDBOX__ || {}).props || {}))
);
window.__AGZ_RENDERED__ = true;
`;
}

// React externo: lê de window.__AGZ_VENDOR__ (bundle vendor gerado 1x por projeto e cacheado).
const vendorExternalPlugin = {
  name: 'vendor-external',
  setup(build) {
    const re = new RegExp('^(' + VENDOR_IDS.map((s) => s.replace(/[/-]/g, '\\$&')).join('|') + ')$');
    build.onResolve({ filter: re }, (a) => ({ path: a.path, namespace: 'vendor' }));
    build.onLoad({ filter: /.*/, namespace: 'vendor' }, (a) => ({
      contents: `module.exports = window.__AGZ_VENDOR__[${JSON.stringify(a.path)}];`,
      loader: 'js',
    }));
  },
};

function vendorEntry() {
  return VENDOR_IDS.map((id, i) => `import * as m${i} from ${JSON.stringify(id)};`).join('\n') +
    `\nwindow.__AGZ_VENDOR__ = {${VENDOR_IDS.map((id, i) => `${JSON.stringify(id)}: m${i}`).join(',')}};`;
}

function buildOptions({ projectRoot, shimsDir, componentPath, mode, io, react = 'bundle', stats, sourcemap = false, vendor = false }) {
  const plugins = [];
  if (react === 'external' && !vendor) plugins.push(vendorExternalPlugin);
  plugins.push(createSandboxPlugin({ projectRoot, shimsDir, mode, io, stats }));
  return {
    stdin: { contents: vendor ? vendorEntry() : entryCode(componentPath), resolveDir: projectRoot, loader: 'jsx', sourcefile: 'agz-entry.jsx' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    jsx: 'automatic',
    jsxDev: false,
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"development"' },
    sourcemap: sourcemap ? 'inline' : false,
    logLevel: 'silent',
    plugins,
  };
}

module.exports = { buildOptions, entryCode, VENDOR_IDS };
