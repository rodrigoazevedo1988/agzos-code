// Estado de rota compartilhado pelos shims next/*. O host (Agzos) pode preencher
// window.__AGZ_SANDBOX__ = { pathname, search, params } antes de montar o componente.
// Navegação nunca sai do iframe: vira postMessage para o host (que só mostra um aviso).
import { useSyncExternalStore } from 'react';

const g = typeof window !== 'undefined' ? window : globalThis;
const st = (g.__AGZ_SANDBOX__ = Object.assign({ pathname: '/', search: '', params: {} }, g.__AGZ_SANDBOX__));
const subs = new Set();

export function getRoute() {
  return st;
}

export function navigate(href, kind = 'push') {
  const url = new URL(String(href), 'http://sandbox.local' + st.pathname);
  st.pathname = url.pathname;
  st.search = url.search;
  st.version = (st.version || 0) + 1;
  try {
    g.parent && g.parent !== g && g.parent.postMessage({ type: 'agz-sandbox:navigate', kind, href: String(href) }, '*');
  } catch {}
  subs.forEach((f) => f());
}

export function useRoute() {
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => st.version || 0,
  );
  return st;
}
