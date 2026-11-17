// Shim mínimo de next/navigation (App Router).
import { useMemo } from 'react';
import { navigate, useRoute, getRoute } from './_state.js';

const router = {
  push: (h) => navigate(h, 'push'),
  replace: (h) => navigate(h, 'replace'),
  back: () => {},
  forward: () => {},
  refresh: () => {},
  prefetch: () => Promise.resolve(),
};

export const useRouter = () => router;
export const usePathname = () => useRoute().pathname;
export function useSearchParams() {
  const r = useRoute();
  return useMemo(() => new URLSearchParams(r.search), [r.search]);
}
export const useParams = () => useRoute().params || {};
export const useSelectedLayoutSegment = () => getRoute().pathname.split('/').filter(Boolean)[0] ?? null;
export const useSelectedLayoutSegments = () => getRoute().pathname.split('/').filter(Boolean);
export function notFound() {
  throw new Error('NEXT_NOT_FOUND (sandbox)');
}
export function redirect(href) {
  navigate(href, 'replace');
  throw new Error('NEXT_REDIRECT (sandbox): ' + href);
}
export const permanentRedirect = redirect;
export const RedirectType = { push: 'push', replace: 'replace' };
