/**
 * Rótulos de interface em pt-BR.
 */

const PERF_LABELS = {
  economy: 'Economia',
  balanced: 'Balanceado',
  high: 'Alta performance',
};

export function perfLabel(mode) {
  return PERF_LABELS[mode] || PERF_LABELS.balanced;
}
