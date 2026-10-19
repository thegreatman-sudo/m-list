import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChefHat, Flame, Clock, Volume2, CheckCircle2, Play, Undo2, AlertTriangle } from 'lucide-react';
import { supabase, OUTLET_ID } from '@/lib/supabase';
import type { Order, OrderItem, RestaurantTable, MenuItem } from '@/types';
import { cn, formatTime, formatDuration, elapsedSeconds, stationLabel } from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import { Spinner, EmptyState } from '@/components/ui';

const STATIONS = ['kitchen', 'bar', 'dessert', 'coffee'] as const;
type Station = (typeof STATIONS)[number];

export function KDSApp() {
  const now = useNow(1000);
  const [station, setStation] = useState<Station>('kitchen');
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [tables, setTables] = useState<Record<string, RestaurantTable>>({});
  const [loading, setLoading] = useState(true);
  const menuById = useRef<Map<string, MenuItem>>(new Map());

  const load = async () => {
    const [o, i, t, mi] = await Promise.all([
      supabase.from('orders').select('*').eq('outlet_id', OUTLET_ID).gte('created_at', new Date(Date.now() - 12 * 3600e3).toISOString()).order('created_at', { ascending: false }),
      supabase.from('order_items').select('*').eq('outlet_id', OUTLET_ID).gte('created_at', new Date(Date.now() - 12 * 3600e3).toISOString()).order('created_at', { ascending: true }),
      supabase.from('tables').select('*').eq('outlet_id', OUTLET_ID),
      supabase.from('menu_items').select('id, name, auto_sold_out').eq('outlet_id', OUTLET_ID),
    ]);
    setOrders((o.data as Order[]) ?? []);
    setItems((i.data as OrderItem[]) ?? []);
    menuById.current = new Map(((mi.data as Pick<MenuItem, 'id' | 'name' | 'auto_sold_out'>[]) ?? []).map((m) => [m.id, m as MenuItem]));
    const map: Record<string, RestaurantTable> = {};
    for (const tb of (t.data as RestaurantTable[]) ?? []) map[tb.id] = tb;
    setTables(map);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('kds_all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const stationItems = useMemo(
    () => items.filter((it) => it.station === station && it.status !== 'served' && it.status !== 'voided' && it.status !== 'rejected'),
    [items, station]
  );

  // Inventory: menu items on open tickets that the stock engine has flagged
  // auto sold-out (ingredient hit zero) — show a low-stock alert on the KDS.
  const lowStockOnTickets = useMemo(() => {
    const names = new Set(
      stationItems
        .map((it) => menuById.current.get(it.item_id))
        .filter((mi) => mi?.auto_sold_out)
        .map((mi) => mi!.name)
    );
    return [...names];
  }, [stationItems]);

  const activeOrders = useMemo(() => {
    const ids = new Set(stationItems.map((it) => it.order_id));
    return orders.filter((o) => ids.has(o.id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [orders, stationItems]);

  const prepSummary = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const it of stationItems) totals[it.name] = (totals[it.name] ?? 0) + it.quantity;
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [stationItems]);

  const setItemStatus = async (it: OrderItem, status: OrderItem['status']) => {
    await supabase.from('order_items').update({ status, updated_at: new Date().toISOString() }).eq('id', it.id);
  };

  const bumpAll = async (order: Order, status: OrderItem['status']) => {
    const its = stationItems.filter((it) => it.order_id === order.id);
    await supabase
      .from('order_items')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', its.map((i) => i.id));
  };

  return (
    <div className="min-h-screen bg-ink-900">
      {/* Header */}
      <div className="sticky top-14 z-30 border-b border-ink-600 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-2">
            <ChefHat size={20} className="text-saffron-500" />
            <h1 className="font-display font-bold text-lg">Kitchen display</h1>
          </div>
          <div className="flex gap-1 flex-wrap">
            {STATIONS.map((s) => {
              const count = items.filter((it) => it.station === s && it.status !== 'served' && it.status !== 'voided' && it.status !== 'rejected').length;
              return (
                <button
                  key={s}
                  onClick={() => setStation(s)}
                  className={cn(
                    'px-3.5 py-2 rounded-xl text-sm font-medium transition-colors inline-flex items-center gap-1.5',
                    station === s ? 'bg-saffron-600 text-white shadow-glow' : 'bg-ink-800 border border-ink-600 text-ink-300 hover:text-ink-100'
                  )}
                >
                  {stationLabel[s]}
                  {count > 0 && (
                    <span className={cn('rounded-full text-[10px] px-1.5 py-0.5', station === s ? 'bg-black/25' : 'bg-saffron-500/20 text-saffron-400')}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2 text-sm text-ink-400">
            <Volume2 size={16} />
            <span>{activeOrders.length} open ticket{activeOrders.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {/* Low-stock alert for items on open tickets that just went sold out */}
      {lowStockOnTickets.length > 0 && (
        <div className="mx-auto max-w-[1600px] px-4 pt-4">
          <div className="rounded-xl border border-amber2-500/40 bg-amber2-500/10 px-4 py-2.5 flex items-center gap-2 text-sm text-amber2-300">
            <AlertTriangle size={16} className="shrink-0" />
            <span><span className="font-semibold">Low stock:</span> {lowStockOnTickets.join(', ')} just went sold out — tell a manager before promising more.</span>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1600px] px-4 py-5">
        {loading ? (
          <div className="py-24 text-center"><Spinner className="h-8 w-8" /></div>
        ) : activeOrders.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={44} />}
            title="All caught up"
            hint={`No open tickets for ${stationLabel[station]}. New orders appear here within seconds.`}
          />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
            {activeOrders.map((order) => (
              <TicketCard
                key={order.id}
                order={order}
                items={stationItems.filter((it) => it.order_id === order.id)}
                table={tables[order.table_id]}
                now={now}
                onItemStatus={setItemStatus}
                onBumpAll={bumpAll}
              />
            ))}
          </div>
        )}

        {/* Prep summary */}
        {prepSummary.length > 0 && (
          <div className="mt-8 rounded-2xl border border-ink-600 bg-ink-800 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Flame size={16} className="text-saffron-500" />
              <h2 className="font-display font-semibold">Prep summary — batch cook</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {prepSummary.map(([name, qty]) => (
                <span key={name} className="rounded-full bg-ink-700 border border-ink-500 px-3.5 py-1.5 text-sm">
                  <span className="font-bold text-saffron-400">{qty}×</span> {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TicketCard({
  order, items, table, now, onItemStatus, onBumpAll,
}: {
  order: Order;
  items: OrderItem[];
  table?: RestaurantTable;
  now: number;
  onItemStatus: (it: OrderItem, s: OrderItem['status']) => void;
  onBumpAll: (o: Order, s: OrderItem['status']) => void;
}) {
  const elapsed = elapsedSeconds(order.created_at, now);
  const target = 900; // station-level target: 15 min
  const timeTone = elapsed < target * 0.5 ? 'ok' : elapsed < target ? 'warn' : 'late';
  const nextAction = items.every((i) => i.status === 'ready') ? null : items.some((i) => i.status === 'received' || i.status === 'accepted') ? 'start' : 'ready';

  return (
    <div
      className={cn(
        'rounded-2xl border bg-ink-800 shadow-card df-slide-up flex flex-col',
        timeTone === 'late' ? 'border-rose2-500/60' : timeTone === 'warn' ? 'border-amber2-500/50' : 'border-ink-600'
      )}
    >
      <div className="p-4 border-b border-ink-600">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-display font-bold text-lg leading-tight">#{order.order_number}</div>
            <div className="text-xs text-ink-400">
              {table?.label ?? '—'} · {order.type === 'dine_in' ? 'Dine-in' : 'Takeaway'} · {formatTime(order.created_at)}
            </div>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-sm font-bold',
              timeTone === 'ok' && 'bg-emerald2-500/15 text-emerald2-400',
              timeTone === 'warn' && 'bg-amber2-500/15 text-amber2-400',
              timeTone === 'late' && 'bg-rose2-500/15 text-rose2-400'
            )}
          >
            <Clock size={14} />
            {formatDuration(elapsed)}
          </span>
        </div>
        {order.notes && (
          <div className="mt-2 rounded-lg bg-amber2-500/10 border border-amber2-500/30 px-2.5 py-1.5 text-xs text-amber2-400">
            Note: {order.notes}
          </div>
        )}
      </div>

      <div className="p-3 space-y-2 flex-1">
        {items.map((it) => (
          <div key={it.id} className="rounded-xl bg-ink-700/70 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm">
                <span className="font-bold text-saffron-400">{it.quantity}×</span>{' '}
                <span className="font-semibold">{it.name}</span>
                {it.allergy_alert && (
                  <span className="ml-2 inline-flex items-center rounded bg-rose2-500/20 text-rose2-400 text-[10px] font-bold px-1.5 py-0.5 uppercase">
                    Allergen
                  </span>
                )}
              </div>
            </div>
            {it.modifiers?.length > 0 && (
              <div className="mt-1 text-xs text-ink-200">{it.modifiers.map((m) => m.name).join(' · ')}</div>
            )}
            {it.notes && <div className="mt-1 text-xs text-amber2-400">"{it.notes}"</div>}
            <div className="mt-2.5 flex gap-1.5">
              <SmallBtn
                onClick={() => onItemStatus(it, 'preparing')}
                active={it.status === 'preparing'}
                disabled={it.status === 'preparing'}
                icon={<Play size={12} />}
                label="Preparing"
              />
              <SmallBtn
                onClick={() => onItemStatus(it, 'ready')}
                active={it.status === 'ready'}
                disabled={it.status === 'ready'}
                icon={<Bell size={12} />}
                label="Ready"
              />
              {it.status !== 'received' && (
                <SmallBtn onClick={() => onItemStatus(it, 'received')} icon={<Undo2 size={12} />} label="" title="Recall" />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-ink-600 flex gap-2">
        {nextAction === 'start' && (
          <button
            onClick={() => onBumpAll(order, 'preparing')}
            className="flex-1 h-11 rounded-xl bg-amber2-500/15 border border-amber2-500/40 text-amber2-400 font-semibold text-sm hover:bg-amber2-500/25 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <Play size={14} /> Start all
          </button>
        )}
        {nextAction === 'ready' && (
          <button
            onClick={() => onBumpAll(order, 'ready')}
            className="flex-1 h-11 rounded-xl bg-emerald2-500/15 border border-emerald2-500/40 text-emerald2-400 font-semibold text-sm hover:bg-emerald2-500/25 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <Bell size={14} /> All ready
          </button>
        )}
        {nextAction === null && (
          <span className="flex-1 h-11 rounded-xl bg-emerald2-500/10 border border-emerald2-500/30 text-emerald2-400 font-semibold text-sm flex items-center justify-center gap-1.5">
            <CheckCircle2 size={14} /> Waiting for waiter
          </span>
        )}
        <button
          onClick={() => onBumpAll(order, 'received')}
          className="h-11 px-3.5 rounded-xl bg-ink-700 border border-ink-600 text-ink-300 hover:text-ink-100 text-sm transition-colors inline-flex items-center gap-1.5"
          title="Recall ticket"
        >
          <Undo2 size={14} />
        </button>
      </div>
    </div>
  );
}

function SmallBtn({
  onClick, active, disabled, icon, label, title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        'h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-50',
        active
          ? 'bg-saffron-600 text-white'
          : 'bg-ink-600/80 text-ink-100 hover:bg-ink-500'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
