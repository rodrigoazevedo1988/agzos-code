// Shim mínimo de next/link: <a> que não navega de verdade.
import { createElement, forwardRef, Children, cloneElement, isValidElement } from 'react';
import { navigate } from './_state.js';

function hrefToString(href) {
  if (typeof href === 'string') return href;
  if (!href) return '#';
  const q = href.query ? '?' + new URLSearchParams(href.query).toString() : '';
  return (href.pathname || '') + q + (href.hash ? '#' + href.hash : '');
}

const Link = forwardRef(function Link(props, ref) {
  const { href, as, replace, scroll, shallow, prefetch, passHref, legacyBehavior, locale, onClick, children, ...rest } = props;
  const url = hrefToString(as || href);
  const handle = (e) => {
    onClick && onClick(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    navigate(url, replace ? 'replace' : 'push');
  };
  if (legacyBehavior && isValidElement(children)) {
    return cloneElement(Children.only(children), { href: url, onClick: handle, ref });
  }
  return createElement('a', { ...rest, href: url, onClick: handle, ref }, children);
});

export default Link;
