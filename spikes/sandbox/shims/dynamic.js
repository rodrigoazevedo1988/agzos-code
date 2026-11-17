// next/dynamic: vira React.lazy + Suspense (ssr: false é irrelevante no sandbox).
import { createElement, lazy, Suspense } from 'react';

export default function dynamic(loader, opts = {}) {
  const L = lazy(() => loader().then((m) => ({ default: m.default || m })));
  return (p) => createElement(Suspense, { fallback: opts.loading ? createElement(opts.loading) : null }, createElement(L, p));
}
