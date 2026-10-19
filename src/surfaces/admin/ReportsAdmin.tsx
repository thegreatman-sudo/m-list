import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, ReceiptText, Users, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Order, Outlet } from '@/types';
import { formatCompactIDR } from '@/lib/format';
import { Spinner, EmptyState } from '@/components/ui';

export function ReportsAdmin() {
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
    const [out, o, i, p, r] = await Promise.all([
      supabase.from('outlets').select('*').limit(1).maybeSingle(),
      supabase.from('orders').select('*').gte('created_at', since).order('created_at', { ascending: false }),
      supabase.from('order_items').select('*').gte('created_at', since),
      supabase.from('payments').select('*').gte('created_at', since),
      supabase.from('reservations').select('*').gte('booking_date', new Date(Date.now() - 30 * 24 * 3600e3).toISOString().slice(0, 10)),
    ]);
    if (out.data) setOutlet(out.data as Outlet);
    setOrders((o.data as Order[]) ?? []);
    setItems((i.data as ItemRow[]) ?? []);
    setPayments((p.data as PaymentRow[]) ?? []);
    setReservations((r.data as ReservationRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    if (!outlet) return null;
    const valid = orders.filter((o) => o.status !== 'voided');
    const itemsByOrder = new Map<string, ItemRow[]>();
    for (const it of items) {
      if (it.status === 'voided' || it.status === 'rejected') continue;
      const arr = itemsByOrder.get(it.order_id) ?? [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    }
    let sales = 0;
    for (const o of valid) {
      for (const it of itemsByOrder.get(o.id) ?? []) {
        const modSum = (it.modifiers ?? []).reduce((s, m) => s + m.price_delta_minor, 0);
        sales += (it.unit_price_minor + modSum) * it.quantity;
      }
    }
    const byHour = new Map<number, { orders: number; sales: number }>();
    for (const o of valid) {
      const h = new Date(o.created_at).getHours();
      const cur = byHour.get(h) ?? { orders: 0, sales: 0 };
      cur.orders += 1;
      cur.sales += (itemsByOrder.get(o.id) ?? []).reduce((s, it) => s + (it.unit_price_minor + (it.modifiers ?? []).reduce((ss, m) => ss + m.price_delta_minor, 0)) * it.quantity, 0);
      byHour.set(h, cur);
    }
    const bySource = new Map<string, number>();
    for (const o of valid) bySource.set(o.source, (bySource.get(o.source) ?? 0) + 1);
    // top items
    const itemTotals = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const o of valid) {
      for (const it of itemsByOrder.get(o.id) ?? []) {
        const cur = itemTotals.get(it.item_id) ?? { name: it.name, qty: 0, revenue: 0 };
        cur.qty += it.quantity;
        cur.revenue += (it.unit_price_minor + (it.modifiers ?? []).reduce((s, m) => s + m.price_delta_minor, 0)) * it.quantity;
        itemTotals.set(it.item_id, cur);
      }
    }
    const top = [...itemTotals.values()].sort((a, b) => b.revenue - a.revenue);
    const methodTotals = new Map<string, number>();
    for (const p of payments) if (p.status === 'completed') methodTotals.set(p.method, (methodTotals.get(p.method) ?? 0) + p.amount_minor);
    const noShows = reservations.filter((r) => r.status === 'no_show').length;
    const covers = reservations.filter((r) => !['cancelled'].includes(r.status)).reduce((s, r) => s + r.party_size, 0);
    return { sales, orders: valid.length, byHour, bySource, top, methodTotals, noShows, covers };
  }, [outlet, orders, items, payments, reservations]);

  if (loading || !stats) {
    return <div className="py-24 text-center"><Spinner className="h-8 w-8" /></div>;
  }

  const maxHour = Math.max(1, ...Array.from(stats.byHour.values()).map((v) => v.sales));
  const avg = stats.orders > 0 ? Math.round(stats.sales / stats.orders) : 0;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Sales (30 days)" value={formatCompactIDR(stats.sales)} icon={<ReceiptText size={16} />} />
        <Kpi label="Orders" value={String(stats.orders)} icon={<Users size={16} />} />
        <Kpi label="Average order value" value={formatCompactIDR(avg)} icon={<TrendingUp size={16} />} />
        <Kpi label="Reservation covers" value={String(stats.covers)} icon={<Clock size={16} />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sales by hour */}
        <section className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
          <h2 className="font-display font-semibold mb-4">Sales by hour</h2>
          {stats.byHour.size === 0 ? (
            <EmptyState title="No sales yet" />
          ) : (
            <div className="space-y-2">
              {Array.from(stats.byHour.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([hour, v]) => (
                  <div key={hour} className="flex items-center gap-3">
                    <span className="w-10 text-xs text-ink-400 font-mono">{String(hour).padStart(2, '0')}:00</span>
                    <div className="flex-1 h-5 bg-ink-700 rounded-md overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-saffron-600 to-saffron-400 rounded-md"
                        style={{ width: `${Math.max(2, (v.sales / maxHour) * 100)}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-xs text-ink-200">{formatCompactIDR(v.sales)}</span>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* Channel mix */}
        <section className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
          <h2 className="font-display font-semibold mb-4">Orders by channel</h2>
          {stats.bySource.size === 0 ? (
            <EmptyState title="No orders yet" />
          ) : (
            <div className="space-y-3">
              {Array.from(stats.bySource.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([src, count]) => (
                  <div key={src}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize">{src === 'qr' ? 'QR scan (guest phone)' : src}</span>
                      <span className="text-ink-400">{count}</span>
                    </div>
                    <div className="h-2 bg-ink-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald2-500 rounded-full"
                        style={{ width: `${(count / stats.orders) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              <div className="pt-2 border-t border-ink-600 mt-2 text-xs text-ink-400">
                Target: 60% of dine-in orders placed from QR within 3 months of go-live.
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Top sellers */}
      <section className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
        <h2 className="font-display font-semibold mb-4">Best sellers (30 days)</h2>
        {stats.top.length === 0 ? (
          <EmptyState title="No sales yet" />
        ) : (
          <div className="space-y-1.5">
            {stats.top.slice(0, 10).map((t, i) => (
              <div key={t.name} className="flex items-center gap-3 text-sm">
                <span className="w-6 text-ink-500 font-mono">{i + 1}</span>
                <span className="flex-1">{t.name}</span>
                <span className="text-ink-400">{t.qty}×</span>
                <span className="w-24 text-right text-ink-200">{formatCompactIDR(t.revenue)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type ItemRow = {
  order_id: string;
  item_id: string;
  name: string;
  quantity: number;
  unit_price_minor: number;
  modifiers: { name: string; price_delta_minor: number }[];
  status: string;
};
type PaymentRow = { method: string; amount_minor: number; status: string };
type ReservationRow = { party_size: number; status: string };

function Kpi({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
      <div className="flex items-center gap-2 text-ink-400 text-xs uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="font-display text-2xl font-bold mt-1.5">{value}</div>
    </div>
  );
}
