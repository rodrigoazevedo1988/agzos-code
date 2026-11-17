// Shim mínimo de next/image: <img> simples. Ignora loader/otimização.
// Caminhos absolutos ("/avatars/x.png") são reescritos para o protocolo do host que serve
// a pasta public/ do projeto (window.__AGZ_SANDBOX__.publicBase, ex. "agz-public://p/").
import { createElement, forwardRef } from 'react';
import { getRoute } from './_state.js';

const Image = forwardRef(function Image(props, ref) {
  const { src, alt = '', width, height, fill, priority, quality, placeholder, blurDataURL, loader, unoptimized, sizes, style, onLoadingComplete, ...rest } = props;
  let s = typeof src === 'object' && src ? src.src : src; // import estático { src, width, height }
  const w = width ?? (typeof src === 'object' ? src.width : undefined);
  const h = height ?? (typeof src === 'object' ? src.height : undefined);
  const base = getRoute().publicBase;
  if (base && typeof s === 'string' && s.startsWith('/')) s = base + s.slice(1);
  const st = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style } : style;
  return createElement('img', { ...rest, ref, src: s, alt, width: fill ? undefined : w, height: fill ? undefined : h, loading: priority ? 'eager' : 'lazy', style: st, sizes });
});

export default Image;
export const getImageProps = (p) => ({ props: { src: typeof p.src === 'object' ? p.src.src : p.src, alt: p.alt } });
