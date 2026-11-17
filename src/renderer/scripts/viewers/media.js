/**
 * Vídeo e áudio com os controles nativos do Chromium (streaming via Range no
 * agzos-file://). Codec sem suporte → tela de fallback.
 */

import { el, toolbar, spacer, fallbackScreen, externalButtons } from './common.js';
import { formatBytes, formatDuration } from './format.js';
import { extOf } from './detect.js';
import { toFileUrl } from './paths.js';

export function renderMedia(file, ctx, kind) {
  const media = el(kind === 'audio' ? 'audio' : 'video', { controls: true, preload: 'metadata', src: toFileUrl(file.path, file.mtime) });
  const footer = el('div', { class: 'viewer-footer', text: `${formatBytes(file.size)} · ${extOf(file.path).toUpperCase()}` });
  const stage = el('div', { class: `viewer-stage viewer-media-stage ${kind}` }, media);
  const root = el('div', { class: `viewer viewer-${kind}` }, toolbar(spacer(), ...externalButtons(file.path)), stage, footer);

  media.addEventListener('loadedmetadata', () => {
    const parts = [formatDuration(media.duration)];
    if (kind === 'video' && media.videoWidth) parts.push(`${media.videoWidth} × ${media.videoHeight}`);
    parts.push(formatBytes(file.size), extOf(file.path).toUpperCase());
    footer.textContent = parts.join(' · ');
  });
  media.addEventListener('error', () => {
    if (!root.isConnected) return;
    root.replaceWith(fallbackScreen(file, ctx, {
      kind: 'unsupported-codec',
      title: 'Formato sem pré-visualização',
      detail: 'O Chromium não reproduz este contêiner/codec (ex.: MKV/AVI com HEVC, DivX). Abra no player do sistema.',
      icon: kind === 'audio' ? 'file-music' : 'file-video-camera',
    }));
  });

  return {
    element: root,
    dispose: () => { try { media.pause(); media.removeAttribute('src'); media.load(); } catch { /* ignora */ } },
  };
}
