import { useEffect, useMemo, useState } from 'react';
import {
  CreditCard, Banknote, ScanLine, Percent,
  AlertTriangle, FileSpreadsheet, Users, Split,
} from 'lucide-react';
import { supabase, OUTLET_ID, DEMO_TENANT_ID, SUPABASE_URL } from '@/lib/supabase';
import type {
  Area, Bill, Order, OrderItem, Outlet, PaymentMethod, Payment, RestaurantTable, TableSession,
} from '@/types';
import { cn, formatIDR } from '@/lib/format';
import { Button, Modal, Spinner, EmptyState } from '@/components/ui';
import { FloorMap, TableStatusLegend } from '@/components/FloorMap';
import { computeBill, ensureSessionAndBill, recalcBill } from '@/lib/billing';

export function POSApp() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [showZ, setShowZ] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [a, t, o, i, s, out] = await Promise.all([
      supabase.from('areas').select('*').eq('outlet_id', OUTLET_ID).is('archived_at', null).order('sort_order'),
      supabase.from('tables').select('*').eq('outlet_id', OUTLET_ID).order('label'),
      supabase.from('orders').select('*').eq('outlet_id', OUTLET_ID).gte('created_at', new Date(Date.now() - 12 * 3600e3).toISOString()).order('created_at', { ascending: false }),
      supabase.from('order_items').select('*').eq('outlet_id', OUTLET_ID).gte('created_at', new Date(Date.now() - 12 * 3600e3).toISOString()),
      supabase.from('table_sessions').select('*').eq('outlet_id', OUTLET_ID).gte('opened_at', new Date(Date.now() - 12 * 3600e3).toISOString()),
      supabase.from('outlets').select('*').eq('id', OUTLET_ID).maybeSingle(),
    ]);
    setAreas((a.data as Area[]) ?? []);
    setTables((t.data as RestaurantTable[]) ?? []);
    setOrders((o.data as Order[]) ?? []);
    setItems((i.data as OrderItem[]) ?? []);
    setSessions((s.data as TableSession[]) ?? []);
    if (out.data) setOutlet(out.data as Outlet);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('pos_all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bills' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const openBillsByTable = useMemo(() => {
    const map = new Map<string, { bill: Bill; items: OrderItem[]; orders: Order[] }>();
    if (!outlet) return map;
    const openSessions = sessions.filter((s) => s.status === 'open');
    for (const sess of openSessions) {
      const tableOrders = orders.filter((o) => o.session_id === sess.id && o.status !== 'voided');
      const orderIds = tableOrders.map((o) => o.id);
      const tableItems = items.filter((i) => orderIds.includes(i.order_id) && i.status !== 'voided' && i.status !== 'rejected');
      if (tableItems.length === 0) continue;
      map.set(sess.table_id, { bill: { ...emptyBill(sess) }, items: tableItems, orders: tableOrders });
    }
    return map;
  }, [sessions, orders, items, outlet]);

  const todayTotals = useMemo(() => {
    const live = [...openBillsByTable.values()];
    const subtotal = live.reduce((s, b) => s + computeBill(b.items, outlet!).subtotal, 0);
    return { openTables: live.length, subtotal };
  }, [openBillsByTable, outlet]);

  if (loading || !outlet) {
    return <div className="py-32 text-center"><Spinner className="h-8 w-8" /></div>;
  }

  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-14 z-30 border-b border-ink-600 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto max-w-[1200px] px-4 py-3 flex items-center gap-3">
          <CreditCard size={20} className="text-emerald2-400" />
          <h1 className="font-display font-bold text-lg">POS</h1>
          <span className="ml-auto text-sm text-ink-400">{todayTotals.openTables} open bills · {formatIDR(todayTotals.subtotal)} running</span>
          <Button size="sm" variant="secondary" onClick={() => setShowZ(true)}>
            <FileSpreadsheet size={14} /> Z report
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 py-5 space-y-8">
        <section>
          <h2 className="font-display font-semibold mb-3">Floor — tap a table to take payment</h2>
          <FloorMap
            tables={tables.map((t) => ({ ...t, status: openBillsByTable.has(t.id) ? 'awaiting_payment' as const : t.status }))}
            areas={areas}
            selectedTableId={selected?.id}
            onSelectTable={setSelected}
          />
          <div className="mt-4">
            <TableStatusLegend />
          </div>
        </section>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Table ${selected.label} — bill` : ''} maxWidth="max-w-xl">
        {selected && openBillsByTable.has(selected.id) && (() => {
          const bundle = openBillsByTable.get(selected.id)!;
          return <PaymentFlow table={selected} outlet={outlet} orderItems={bundle.items} onDone={() => setSelected(null)} />;
        })()}
        {selected && !openBillsByTable.has(selected.id) && (
          <EmptyState title="No open bill on this table" hint="Guests can order by scanning the table QR, or a waiter can take an order." />
        )}
      </Modal>

      <Modal open={showZ} onClose={() => setShowZ(false)} title="End of day (Z) report">
        <ZReport outlet={outlet} openBills={openBillsByTable} />
      </Modal>
    </div>
  );
}

function emptyBill(sess: TableSession): Bill {
  return {
    id: sess.id,
    session_id: sess.id,
    table_id: sess.table_id,
    outlet_id: sess.outlet_id,
    subtotal_minor: 0,
    discount_minor: 0,
    tax_minor: 0,
    service_minor: 0,
    tip_minor: 0,
    total_minor: 0,
    status: 'open',
    created_at: sess.opened_at,
    updated_at: sess.opened_at,
    closed_at: null,
  };
}

function PaymentFlow({
  table, outlet, orderItems, onDone,
}: {
  table: RestaurantTable;
  outlet: Outlet;
  orderItems: OrderItem[];
  onDone: () => void;
}) {
  const [discountPct, setDiscountPct] = useState(0);
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('qris');
  const [splitN, setSplitN] = useState(1);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = orderItems.filter((i) => i.status !== 'voided' && i.status !== 'rejected');
  const subtotal = eligible.reduce((s, i) => {
    const modSum = (i.modifiers ?? []).reduce((ss, m) => ss + m.price_delta_minor, 0);
    return s + (i.unit_price_minor + modSum) * i.quantity;
  }, 0);
  const discount = Math.round((subtotal * discountPct) / 100);
  const tip = Math.round((subtotal * tipPct) / 100);
  const bd = computeBill(eligible, outlet, discount, tip);
  const perGuest = splitN > 1 ? Math.round(bd.total / splitN) : bd.total;

  const close = async () => {
    setPaying(true);
    setError(null);
    // find open session for table
    const { data: sess } = await supabase
      .from('table_sessions')
      .select('*')
      .eq('table_id', table.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sess) {
      setError('No open session found for this table.');
      setPaying(false);
      return;
    }
    // create bill if needed, then recalc + pay
    const r = await ensureSessionAndBill(DEMO_TENANT_ID, OUTLET_ID, table.id);
    if ('error' in r) {
      setError(r.error);
      setPaying(false);
      return;
    }
    await recalcBill(r.bill.id, eligible, outlet, discount, tip);
    const { error: payErr } = await supabase.from('payments').insert({
      bill_id: r.bill.id,
      method,
      amount_minor: bd.total,
      status: 'completed',
      provider_ref: method === 'qris' ? 'QRIS-' + Math.random().toString(36).slice(2, 10).toUpperCase() : null,
    });
    if (payErr) {
      setError(payErr.message);
      setPaying(false);
      return;
    }
    await supabase.from('bills').update({ status: 'paid', closed_at: new Date().toISOString() }).eq('id', r.bill.id);
    await supabase.from('table_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', sess.id);
    await supabase.from('tables').update({ status: 'cleaning', updated_at: new Date().toISOString() }).eq('id', table.id);
    setPaying(false);
    onDone();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        {eligible.map((i) => (
          <div key={i.id} className="flex items-start justify-between text-sm">
            <span>
              <span className="font-semibold">{i.quantity}×</span> {i.name}
              {i.modifiers?.length > 0 && <span className="ml-1.5 text-xs text-ink-400">({i.modifiers.map((m) => m.name).join(', ')})</span>}
            </span>
            <span className="text-ink-200">{formatIDR((i.unit_price_minor + (i.modifiers ?? []).reduce((s, m) => s + m.price_delta_minor, 0)) * i.quantity)}</span>
          </div>
        ))}
      </div>

      {/* Discount + tip */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-ink-400 mb-1.5 inline-flex items-center gap-1"><Percent size={11} /> Bill discount</div>
          <div className="flex gap-1.5">
            {[0, 5, 10, 15].map((p) => (
              <button key={p} onClick={() => setDiscountPct(p)} className={cn('flex-1 h-9 rounded-lg text-xs font-semibold border', discountPct === p ? 'bg-emerald2-500/15 border-emerald2-500/40 text-emerald2-400' : 'border-ink-600 text-ink-300')}>{p}%</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-400 mb-1.5">Tip</div>
          <div className="flex gap-1.5">
            {[0, 5, 10].map((p) => (
              <button key={p} onClick={() => setTipPct(p)} className={cn('flex-1 h-9 rounded-lg text-xs font-semibold border', tipPct === p ? 'bg-emerald2-500/15 border-emerald2-500/40 text-emerald2-400' : 'border-ink-600 text-ink-300')}>{p}%</button>
            ))}
          </div>
        </div>
      </div>

      {/* Split */}
      <div>
        <div className="text-xs text-ink-400 mb-1.5 inline-flex items-center gap-1"><Split size={11} /> Split bill equally</div>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} onClick={() => setSplitN(n)} className={cn('flex-1 h-9 rounded-lg text-xs font-semibold border inline-flex items-center justify-center gap-1', splitN === n ? 'bg-sky2-500/15 border-sky2-500/40 text-sky2-400' : 'border-ink-600 text-ink-300')}>
              <Users size={11} /> {n}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-ink-700/60 p-4 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-ink-400">Subtotal</span><span>{formatIDR(bd.subtotal)}</span></div>
        {discount > 0 && <div className="flex justify-between text-emerald2-400"><span>Discount</span><span>-{formatIDR(discount)}</span></div>}
        <div className="flex justify-between"><span className="text-ink-400">Tax ({outlet.tax_percent}%)</span><span>{formatIDR(bd.tax)}</span></div>
        <div className="flex justify-between"><span className="text-ink-400">Service ({outlet.service_charge_percent}%)</span><span>{formatIDR(bd.service)}</span></div>
        {tip > 0 && <div className="flex justify-between"><span className="text-ink-400">Tip</span><span>{formatIDR(tip)}</span></div>}
        <div className="flex justify-between pt-2 border-t border-ink-600">
          <span className="font-display font-bold">{splitN > 1 ? `Per guest (of ${splitN})` : 'Total'}</span>
          <span className="font-display font-bold text-emerald2-400">{formatIDR(perGuest)}</span>
        </div>
      </div>

      {/* Method */}
      <div>
        <div className="text-sm font-medium mb-2">Payment method</div>
        <div className="grid grid-cols-4 gap-1.5">
          {([['cash', 'Cash', <Banknote size={16} key="c" />], ['qris', 'QRIS', <ScanLine size={16} key="q" />], ['card', 'Card', <CreditCard size={16} key="cc" />], ['voucher', 'Voucher', <Percent size={16} key="v" />]] as const).map(([m, label, icon]) => (
            <button key={m} onClick={() => setMethod(m)} className={cn('rounded-xl border py-3 flex flex-col items-center gap-1 text-xs font-semibold transition-colors', method === m ? 'border-emerald2-500/50 bg-emerald2-500/10 text-emerald2-400' : 'border-ink-600 text-ink-200 hover:bg-ink-700')}>
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-rose2-500/10 border border-rose2-500/30 px-3 py-2 text-xs text-rose2-400 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      <Button full size="lg" onClick={close} disabled={paying}>
        {paying ? <Spinner /> : `Charge ${formatIDR(perGuest)}${splitN > 1 ? ` (${splitN} splits)` : ''}`}
      </Button>
    </div>
  );
}

function ZReport({
  outlet,
  openBills,
}: {
  outlet: Outlet;
  openBills: Map<string, { items: OrderItem[]; orders: Order[] }>;
}) {
  const live = [...openBills.values()];
  const subtotal = live.reduce((s, b) => s + computeBill(b.items, outlet).subtotal, 0);
  const tax = live.reduce((s, b) => s + computeBill(b.items, outlet).tax, 0);
  const service = live.reduce((s, b) => s + computeBill(b.items, outlet).service, 0);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-400">
        Running figures for today, including bills still open on the floor. In the full product this
        report covers the closed shift: sales by method, tax, discounts, voids, refunds and tips,
        exportable to PDF or CSV.
      </p>
      <div className="rounded-xl bg-ink-700/60 p-4 space-y-1.5">
        <div className="flex justify-between"><span className="text-ink-400">Open bills</span><span>{live.length}</span></div>
        <div className="flex justify-between"><span className="text-ink-400">Sales (running)</span><span>{formatIDR(subtotal)}</span></div>
        <div className="flex justify-between"><span className="text-ink-400">Tax included</span><span>{formatIDR(tax)}</span></div>
        <div className="flex justify-between"><span className="text-ink-400">Service included</span><span>{formatIDR(service)}</span></div>
      </div>
      <Button variant="secondary" full onClick={() => window.print()}>
        <FileSpreadsheet size={14} /> Print / save as PDF
      </Button>
    </div>
  );
}
