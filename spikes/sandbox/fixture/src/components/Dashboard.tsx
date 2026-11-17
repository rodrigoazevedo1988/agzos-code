'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { Button } from '@/components/ui/Button';
import { Card } from '~ui/Card';
import { StatTile, type Stat } from './StatTile';
import { formatMoney, initials, type Currency } from '@/lib/format';
import { useToggle } from '@/hooks/useToggle';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'pro' | 'team';
  mrr: number;
  status: 'active' | 'trial' | 'churned';
  avatar?: string;
  createdAt: string;
}

type SortKey = 'name' | 'mrr' | 'createdAt';
type SortDir = 'asc' | 'desc';

interface TableState {
  query: string;
  plan: Customer['plan'] | 'all';
  status: Customer['status'] | 'all';
  sortKey: SortKey;
  sortDir: SortDir;
  page: number;
  pageSize: number;
  selected: Set<string>;
}

type Action =
  | { type: 'query'; value: string }
  | { type: 'plan'; value: TableState['plan'] }
  | { type: 'status'; value: TableState['status'] }
  | { type: 'sort'; key: SortKey }
  | { type: 'page'; value: number }
  | { type: 'toggleRow'; id: string }
  | { type: 'toggleAll'; ids: string[] }
  | { type: 'clearSelection' };

// ---------------------------------------------------------------------------
// Dados fictícios
// ---------------------------------------------------------------------------

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Heitor', 'Iara', 'João'];
const LAST = ['Silva', 'Souza', 'Costa', 'Lima', 'Rocha', 'Alves', 'Pereira', 'Gomes'];
const PLANS: Customer['plan'][] = ['free', 'pro', 'team'];
const STATUSES: Customer['status'][] = ['active', 'trial', 'churned'];

function makeCustomers(n: number): Customer[] {
  const out: Customer[] = [];
  for (let i = 0; i < n; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const plan = PLANS[i % PLANS.length]!;
    out.push({
      id: `c_${i}`,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@exemplo.com`,
      plan,
      mrr: plan === 'free' ? 0 : plan === 'pro' ? 49 + (i % 5) * 10 : 199 + (i % 3) * 50,
      status: STATUSES[(i * 5) % STATUSES.length]!,
      avatar: i % 4 === 0 ? `/avatars/${i}.png` : undefined,
      createdAt: new Date(2026, i % 12, (i % 27) + 1).toISOString(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: TableState, action: Action): TableState {
  switch (action.type) {
    case 'query':
      return { ...state, query: action.value, page: 0 };
    case 'plan':
      return { ...state, plan: action.value, page: 0 };
    case 'status':
      return { ...state, status: action.value, page: 0 };
    case 'sort':
      return state.sortKey === action.key
        ? { ...state, sortDir: state.sortDir === 'asc' ? 'desc' : 'asc' }
        : { ...state, sortKey: action.key, sortDir: 'asc' };
    case 'page':
      return { ...state, page: Math.max(0, action.value) };
    case 'toggleRow': {
      const selected = new Set(state.selected);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { ...state, selected };
    }
    case 'toggleAll': {
      const all = action.ids.every((id) => state.selected.has(id));
      const selected = new Set(state.selected);
      for (const id of action.ids) {
        if (all) selected.delete(id);
        else selected.add(id);
      }
      return { ...state, selected };
    }
    case 'clearSelection':
      return { ...state, selected: new Set() };
    default:
      return state;
  }
}

const initialState: TableState = {
  query: '',
  plan: 'all',
  status: 'all',
  sortKey: 'createdAt',
  sortDir: 'desc',
  page: 0,
  pageSize: 8,
  selected: new Set(),
};

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function Avatar({ customer }: { customer: Customer }) {
  if (customer.avatar) {
    return (
      <Image
        src={customer.avatar}
        alt={customer.name}
        width={32}
        height={32}
        className="h-8 w-8 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
      {initials(customer.name)}
    </span>
  );
}

function StatusBadge({ status }: { status: Customer['status'] }) {
  return (
    <span
      className={clsx(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'active' && 'bg-emerald-100 text-emerald-700',
        status === 'trial' && 'bg-amber-100 text-amber-700',
        status === 'churned' && 'bg-slate-200 text-slate-600',
      )}
    >
      {status}
    </span>
  );
}

function SortHeader({ label, k, state, dispatch }: { label: string; k: SortKey; state: TableState; dispatch: (a: Action) => void }) {
  const active = state.sortKey === k;
  return (
    <th className="px-3 py-2 text-left">
      <button
        type="button"
        onClick={() => dispatch({ type: 'sort', key: k })}
        className={clsx('text-xs uppercase tracking-wide', active ? 'text-brand-900' : 'text-slate-500')}
      >
        {label} {active ? (state.sortDir === 'asc' ? '▲' : '▼') : ''}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export interface DashboardProps {
  title?: string;
  currency?: Currency;
  customers?: Customer[];
}

export default function Dashboard({ title = 'Clientes', currency = 'BRL', customers }: DashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const data = useMemo(() => customers ?? makeCustomers(42), [customers]);
  const [state, dispatch] = useReducer(reducer, initialState, (s) => ({ ...s, query: search.get('q') ?? '' }));
  const [compact, toggleCompact] = useToggle(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const q = state.query.trim().toLowerCase();
    const rows = data.filter(
      (c) =>
        (state.plan === 'all' || c.plan === state.plan) &&
        (state.status === 'all' || c.status === state.status) &&
        (!q || c.name.toLowerCase().includes(q) || c.email.includes(q)),
    );
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const av = a[state.sortKey];
      const bv = b[state.sortKey];
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [data, state.query, state.plan, state.status, state.sortKey, state.sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  const pageRows = filtered.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);

  const stats: Stat[] = useMemo(() => {
    const active = data.filter((c) => c.status === 'active');
    const mrr = active.reduce((s, c) => s + c.mrr, 0);
    return [
      { label: 'MRR', value: formatMoney(mrr, currency), delta: 0.084 },
      { label: 'Ativos', value: String(active.length), delta: 0.031 },
      { label: 'Trial', value: String(data.filter((c) => c.status === 'trial').length), delta: -0.012 },
      { label: 'Churn', value: String(data.filter((c) => c.status === 'churned').length), delta: -0.05 },
    ];
  }, [data, currency]);

  return (
    <div className="min-h-screen bg-slate-50 p-18">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-brand-900">{title}</h1>
            <p className="text-sm text-slate-500">
              {pathname} · atualizado {now.toLocaleTimeString('pt-BR')}
            </p>
          </div>
          <nav className="flex gap-3">
            <Link href="/settings" className="text-brand-500 underline">
              Configurações
            </Link>
            <Button variant="ghost" onClick={toggleCompact}>
              {compact ? 'Confortável' : 'Compacto'}
            </Button>
            <Button onClick={() => router.push('/customers/new')}>Novo cliente</Button>
          </nav>
        </header>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {stats.map((s) => (
            <StatTile key={s.label} stat={s} />
          ))}
        </div>

        <Card
          title={`${filtered.length} clientes`}
          actions={
            state.selected.size > 0 ? (
              <Button variant="danger" onClick={() => dispatch({ type: 'clearSelection' })}>
                Limpar {state.selected.size}
              </Button>
            ) : null
          }
        >
          <div className="mb-4 flex flex-wrap gap-3">
            <input
              value={state.query}
              onChange={(e) => dispatch({ type: 'query', value: e.target.value })}
              placeholder="Buscar por nome ou e-mail"
              className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <select
              value={state.plan}
              onChange={(e) => dispatch({ type: 'plan', value: e.target.value as TableState['plan'] })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">Todos os planos</option>
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={state.status}
              onChange={(e) => dispatch({ type: 'status', value: e.target.value as TableState['status'] })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">Todos os status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar página"
                    checked={pageRows.length > 0 && pageRows.every((r) => state.selected.has(r.id))}
                    onChange={() => dispatch({ type: 'toggleAll', ids: pageRows.map((r) => r.id) })}
                  />
                </th>
                <SortHeader label="Nome" k="name" state={state} dispatch={dispatch} />
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Plano</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Status</th>
                <SortHeader label="MRR" k="mrr" state={state} dispatch={dispatch} />
                <SortHeader label="Desde" k="createdAt" state={state} dispatch={dispatch} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.id} className={clsx('border-b border-slate-100 hover:bg-brand-50', compact ? 'h-9' : 'h-14')}>
                  <td className="px-3">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${c.name}`}
                      checked={state.selected.has(c.id)}
                      onChange={() => dispatch({ type: 'toggleRow', id: c.id })}
                    />
                  </td>
                  <td className="px-3">
                    <Link href={`/customers/${c.id}`} className="flex items-center gap-3">
                      <Avatar customer={c} />
                      <span>
                        <span className="block font-medium text-slate-900">{c.name}</span>
                        <span className="block text-xs text-slate-500">{c.email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 capitalize">{c.plan}</td>
                  <td className="px-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 tabular-nums">{formatMoney(c.mrr, currency)}</td>
                  <td className="px-3 text-slate-500">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>
              Página {state.page + 1} de {pageCount}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={state.page === 0} onClick={() => dispatch({ type: 'page', value: state.page - 1 })}>
                Anterior
              </Button>
              <Button
                variant="ghost"
                disabled={state.page + 1 >= pageCount}
                onClick={() => dispatch({ type: 'page', value: state.page + 1 })}
              >
                Próxima
              </Button>
            </div>
          </footer>
        </Card>
      </div>
    </div>
  );
}
