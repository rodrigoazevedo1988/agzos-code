// Shim mínimo de next/router (Pages Router).
import { createElement } from 'react';
import { navigate, useRoute, getRoute } from './_state.js';

const listeners = {};
const events = {
  on: (e, f) => ((listeners[e] ||= new Set()).add(f)),
  off: (e, f) => listeners[e] && listeners[e].delete(f),
  emit: (e, ...a) => listeners[e] && listeners[e].forEach((f) => f(...a)),
};

function snapshot(r) {
  return {
    pathname: r.pathname,
    asPath: r.pathname + r.search,
    route: r.pathname,
    query: { ...Object.fromEntries(new URLSearchParams(r.search)), ...(r.params || {}) },
    basePath: '',
    isReady: true,
    isFallback: false,
    isPreview: false,
    locale: undefined,
    events,
    push: async (h) => (events.emit('routeChangeStart', h), navigate(typeof h === 'string' ? h : h.pathname, 'push'), events.emit('routeChangeComplete', h), true),
    replace: async (h) => (navigate(typeof h === 'string' ? h : h.pathname, 'replace'), true),
    back: () => {},
    reload: () => {},
    prefetch: () => Promise.resolve(),
    beforePopState: () => {},
  };
}

export const useRouter = () => snapshot(useRoute());
export function withRouter(C) {
  return (p) => createElement(C, { ...p, router: snapshot(useRoute()) });
}
const Router = new Proxy({}, { get: (_, k) => snapshot(getRoute())[k] });
export default Router;
