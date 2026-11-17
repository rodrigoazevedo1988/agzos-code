/** Formatação para rodapés dos visualizadores — módulo puro. */

export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1).replace('.', ',')} ${units[i]}`;
}

export function formatDuration(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
