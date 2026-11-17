import { formatPercent } from '@/lib/format';

export interface Stat {
  label: string;
  value: string;
  delta: number;
}

export function StatTile({ stat }: { stat: Stat }) {
  const up = stat.delta >= 0;
  return (
    <div className="rounded-xl2 bg-brand-50 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-900">{stat.value}</p>
      <p className={up ? 'text-emerald-600 text-sm' : 'text-red-600 text-sm'}>{formatPercent(stat.delta)}</p>
    </div>
  );
}
