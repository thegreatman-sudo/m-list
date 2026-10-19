import { useEffect, useMemo, useState } from 'react';
import {
  ConciergeBell, Bell, ClipboardList, Plus, Minus, X,
  Hand, GlassWater, Sparkles, Utensils, MessageCircle, ReceiptText,
} from 'lucide-react';
import { supabase, OUTLET_ID, DEMO_TENANT_ID } from '@/lib/supabase';
import type {
  Area, MenuItem, MenuCategory, MenuModifier, Order, OrderItem,
  RestaurantTable, ServiceRequest,
} from '@/types';
import {
  cn, formatIDR, formatTime, formatDuration, elapsedSeconds,
  serviceRequestReasonLabel, serviceRequestReasonIcon, tableStatusLabel,
} from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import { Button, Modal, Badge, Spinner } from '@/components/ui';
import { FloorMap, TableStatusLegend } from '@/components/FloorMap';
import { CartLine, cartTotal, lineTotal, placeOrder } from '@/lib/orders';
import { ensureSessionAndBill } from '@/lib/billing';

export function WaiterApp() {
  const now = useNow(1000);
  const [areas, setAreas] = useState<Area[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [takingOrder, setTakingOrder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  const load = async () => {
    const [a, t, o, i, r] = await Promise.all([
      supabase.from('areas').select('*').eq('outlet_id', OUTLET_ID).is('archived_at', null).order('sort_order'),
      supabase.from('tables').select('*').eq('outlet_id', OUTLET_ID).order('label'),
      supabase.from('orders').select('*').eq('outlet_id', OUTLET_ID).gte('created_at', new Date(Date.now() - 12 * 3600e3).toISOString()).order('created_at', { ascending: false }),
      supabase.from('order_items').select('*').eq('outlet_id', OUTLET_ID).gte('created_at', new Date(Date.now() - 12 * 3600e3).toISOString()),
      supabase.from('service_requests').select('*').eq('outlet_id', OUTLET_ID).neq('status', 'done').order('created_at', { ascending: false }),
    ]);
    setAreas((a.data as Area[]) ?? []);
    setTables((t.data as RestaurantTable[]) ?? []);
    setOrders((o.data as Order[]) ?? []);
    setItems((i.data as OrderItem[]) ?? []);
    setRequests((r.data as ServiceRequest[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('waiter_all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_requests' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const openRequestsByTable = useMemo(() => {
    const map = new Map<string, ServiceRequest>();
    for (const rq of requests) if (!map.has(rq.table_id)) map.set(rq.table_id, rq);
    return map;
  }, [requests]);

  const tableStats = useMemo(() => {
    // per order
    const byOrder: Record<string, { total: number; ready: number; running: number }> = {};
    for (const it of items) {
      if (!byOrder[it.order_id]) byOrder[it.order_id] = { total: 0, ready: 0, running: 0 };
      if (it.status !== 'voided' && it.status !== 'rejected') {
        const modSum = (it.modifiers ?? []).reduce((s, m) => s + m.price_delta_minor, 0);
        byOrder[it.order_id].running += (it.unit_price_minor + modSum) * it.quantity;
        byOrder[it.order_id].total += 1;
      }
      if (it.status === 'ready') byOrder[it.order_id].ready += 1;
    }
    const byTable: Record<string, { running: number; ready: number; open: number }> = {};
    for (const o of orders) {
      if (o.status === 'voided') continue;
      const s = byOrder[o.id] ?? { running: 0, ready: 0 };
      if (!byTable[o.table_id]) byTable[o.table_id] = { running: 0, ready: 0, open: 0 };
      byTable[o.table_id].running += s.running;
      byTable[o.table_id].ready += s.ready;
      if (o.status !== 'closed') byTable[o.table_id].open += 1;
    }
    return { byTable };
  }, [orders, items]);

  const readyItems = useMemo(() => items.filter((it) => it.status === 'ready'), [items]);

  const ackRequest = async (rq: ServiceRequest) => {
    await supabase
      .from('service_requests')
      .update({ status: 'on_the_way', acknowledged_by: 'Dina (waiter)', acknowledged_at: new Date().toISOString() })
      .eq('id', rq.id);
    showToast('On the way');
  };

  const doneRequest = async (rq: ServiceRequest) => {
    await supabase
      .from('service_requests')
      .update({ status: 'done', resolved_at: new Date().toISOString() })
      .eq('id', rq.id);
  };

  const serveItem = async (it: OrderItem) => {
    await supabase.from('order_items').update({ status: 'served', updated_at: new Date().toISOString() }).eq('id', it.id);
  };

  const markCleaning = async (t: RestaurantTable) => {
    await supabase.from('tables').update({ status: 'cleaning', updated_at: new Date().toISOString() }).eq('id', t.id);
    setSelected(null);
  };

  const markAvailable = async (t: RestaurantTable) => {
    await supabase.from('tables').update({ status: 'available', updated_at: new Date().toISOString() }).eq('id', t.id);
    setSelected(null);
  };

  if (loading) {
    return <div className="py-32 text-center"><Spinner className="h-8 w-8" /></div>;
  }

  return (
    <div className="min-h-screen pb-40">
      {/* Header */}
      <div className="sticky top-14 z-30 border-b border-ink-600 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto max-w-[1200px] px-4 py-3 flex items-center gap-3">
          <ConciergeBell size={20} className="text-sky2-400" />
          <h1 className="font-display font-bold text-lg">Waiter app</h1>
          <span className="ml-auto text-sm text-ink-400">{tables.length} tables</span>
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 py-5 space-y-8">
        {/* Bell calls */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Bell size={16} className="text-saffron-500" />
            <h2 className="font-display font-semibold">Guest calls</h2>
            {requests.length > 0 && <Badge className="bg-rose2-500/15 text-rose2-400 border-rose2-500/30">{requests.length} open</Badge>}
          </div>
          {requests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-600 p-5 text-sm text-ink-400">No open calls. New calls alert here within 2 seconds.</div>
          ) : (
            <div className="space-y-2">
              {requests.map((rq) => {
                const tb = tables.find((x) => x.id === rq.table_id);
                return (
                  <div
                    key={rq.id}
                    className="rounded-2xl border border-saffron-500/50 bg-ink-800 p-4 flex flex-wrap items-center gap-3 df-pulse"
                  >
                    <div className="h-10 w-10 rounded-full bg-saffron-500/15 text-saffron-400 flex items-center justify-center">
                      <ReasonGlyph name={serviceRequestReasonIcon[rq.reason]} />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <div className="font-semibold text-sm">
                        Table {tb?.label ?? '—'} · {serviceRequestReasonLabel[rq.reason]}
                      </div>
                      <div className="text-xs text-ink-400">
                        {formatTime(rq.created_at)} · {formatDuration(elapsedSeconds(rq.created_at, now))} waiting
                        {rq.detail ? ` · "${rq.detail}"` : ''}
                      </div>
                    </div>
                    {rq.status === 'sent' ? (
                      <Button size="sm" onClick={() => ackRequest(rq)}>Acknowledge</Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => doneRequest(rq)}>Mark done</Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Ready on the pass */}
        {readyItems.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList size={16} className="text-emerald2-400" />
              <h2 className="font-display font-semibold">Ready to serve</h2>
            </div>
            <div className="space-y-2">
              {readyItems.map((it) => {
                const o = orders.find((x) => x.id === it.order_id);
                const tb = o ? tables.find((x) => x.id === o.table_id) : undefined;
                return (
                  <div key={it.id} className="rounded-2xl border border-emerald2-500/40 bg-ink-800 p-4 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold">
                        {it.quantity}× {it.name}
                      </div>
                      <div className="text-xs text-ink-400">
                        Table {tb?.label ?? '—'} · order #{o?.order_number}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => serveItem(it)}>Mark served</Button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Floor map */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-display font-semibold">My tables</h2>
          </div>
          <FloorMap
            tables={tables}
            areas={areas}
            selectedTableId={selected?.id}
            onSelectTable={setSelected}
            pulseTableIds={new Set(openRequestsByTable.keys())}
          />
          <div className="mt-4">
            <TableStatusLegend />
          </div>
        </section>
      </div>

      {/* Table detail drawer */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Table ${selected.label}` : ''}
      >
        {selected && (() => {
          const tableOrders = orders.filter((o) => o.table_id === selected.id && o.status !== 'voided' && o.status !== 'closed');
          const orderIds = tableOrders.map((o) => o.id);
          const tableItems = items.filter((i) => orderIds.includes(i.order_id) && i.status !== 'voided' && i.status !== 'rejected');
          const running = tableStats.byTable[selected.id]?.running ?? 0;
          const call = openRequestsByTable.get(selected.id);
          return (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <Badge className="bg-ink-600 text-ink-200 border-ink-500">{tableStatusLabel[selected.status]}</Badge>
                {call && (
                  <Badge className="bg-saffron-500/15 text-saffron-400 border-saffron-500/30">
                    {serviceRequestReasonLabel[call.reason]} · {formatDuration(elapsedSeconds(call.created_at, now))}
                  </Badge>
                )}
              </div>

              <div className="rounded-xl bg-ink-700/60 p-4 flex items-center justify-between">
                <span className="text-sm text-ink-300">Running total</span>
                <span className="font-display font-bold text-lg">{formatIDR(running)}</span>
              </div>

              {tableItems.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">On this table</div>
                  <div className="space-y-1.5">
                    {tableItems.map((it) => (
                      <div key={it.id} className="flex items-center justify-between text-sm">
                        <span>
                          <span className="font-semibold">{it.quantity}×</span> {it.name}
                          <span className="ml-2 text-xs text-ink-400 capitalize">{it.status}</span>
                        </span>
                        {it.status === 'ready' ? (
                          <button onClick={() => serveItem(it)} className="text-xs font-semibold text-emerald2-400 hover:underline">Mark served</button>
                        ) : (
                          <span className="text-xs text-ink-400 capitalize">{it.status}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  onClick={() => { setTakingOrder(true); }}
                >
                  <Plus size={15} /> Take order
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await ensureSessionAndBill(DEMO_TENANT_ID, OUTLET_ID, selected.id);
                    showToast('Bill sent to POS');
                    setSelected(null);
                  }}
                >
                  <ReceiptText size={15} /> Send bill to POS
                </Button>
                <Button variant="secondary" onClick={() => markCleaning(selected)}>Mark cleaning</Button>
                <Button variant="ghost" onClick={() => markAvailable(selected)}>Mark available</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Take order modal */}
      {takingOrder && selected && (
        <TakeOrderModal
          table={selected}
          onClose={() => setTakingOrder(false)}
          onDone={(num) => {
            setTakingOrder(false);
            showToast(`Order #${num} sent to the kitchen`);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 df-slide-up">
          <div className="rounded-full bg-ink-700 border border-ink-500 px-4 py-2 text-sm shadow-card">{toast}</div>
        </div>
      )}
    </div>
  );
}

function ReasonGlyph({ name }: { name: string }) {
  const p = { size: 18 };
  switch (name) {
    case 'Hand': return <Hand {...p} />;
    case 'ReceiptText': return <ReceiptText {...p} />;
    case 'GlassWater': return <GlassWater {...p} />;
    case 'Sparkles': return <Sparkles {...p} />;
    case 'Utensils': return <Utensils {...p} />;
    default: return <MessageCircle {...p} />;
  }
}

function TakeOrderModal({
  table, onClose, onDone,
}: {
  table: RestaurantTable;
  onClose: () => void;
  onDone: (orderNumber: number) => void;
}) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [modifiers, setModifiers] = useState<MenuModifier[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<MenuItem | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase
      .from('menu_categories')
      .select('*')
      .eq('outlet_id', OUTLET_ID)
      .order('sort_order')
      .then(({ data }) => setCategories((data as MenuCategory[]) ?? []));
    supabase
      .from('menu_items')
      .select('*')
      .eq('outlet_id', OUTLET_ID)
      .order('sort_order')
      .then(({ data }) => setItems((data as MenuItem[]) ?? []));
    supabase
      .from('menu_modifiers')
      .select('*, options:menu_modifier_options(*)')
      .then(({ data }) => setModifiers((data as MenuModifier[]) ?? []));
  }, []);

  const modsByItem = useMemo(() => {
    const m: Record<string, MenuModifier[]> = {};
    for (const mod of modifiers) {
      if (!m[mod.item_id]) m[mod.item_id] = [];
      m[mod.item_id].push(mod);
    }
    return m;
  }, [modifiers]);

  const addLine = (item: MenuItem) => {
    const mods = modsByItem[item.id] ?? [];
    if (mods.some((m) => m.required)) setCustomizing(item);
    else setCart((c) => [...c, { item, quantity: 1, modifiers: [], notes: '', unitPriceMinor: item.price_minor }]);
  };

  const submit = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    const r = await ensureSessionAndBill(DEMO_TENANT_ID, OUTLET_ID, table.id);
    if ('error' in r) {
      setSubmitting(false);
      return;
    }
    const res = await placeOrder({ tenantId: DEMO_TENANT_ID, outletId: OUTLET_ID, tableId: table.id, sessionId: r.session.id, lines: cart, source: 'waiter', notes });
    setSubmitting(false);
    if (res.ok) onDone(res.orderNumber);
  };

  const value = cartTotal(cart);

  return (
    <Modal open onClose={onClose} title={`Order for Table ${table.label}`} maxWidth="max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {categories.map((c) => (
            <div key={c.id}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mt-3 mb-1.5">{c.name}</div>
              {items.filter((i) => i.category_id === c.id && i.available && !i.sold_out && !i.auto_sold_out).map((i) => (
                <button
                  key={i.id}
                  onClick={() => addLine(i)}
                  className="w-full flex items-center justify-between rounded-lg border border-ink-600 bg-ink-700 hover:bg-ink-600 p-2.5 text-left transition-colors"
                >
                  <span className="text-sm font-medium">{i.name}</span>
                  <span className="text-xs text-saffron-400">{formatIDR(i.price_minor)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="text-sm font-semibold">Ticket</div>
          {cart.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-600 p-5 text-sm text-ink-400 text-center">Tap menu items to add them.</div>
          ) : (
            <div className="space-y-1.5">
              {cart.map((l, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-lg bg-ink-700/70 px-3 py-2 text-sm">
                  <span>{l.quantity}× {l.item.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-ink-200">{formatIDR(lineTotal(l))}</span>
                    <button onClick={() => setCart((c) => c.filter((_, i) => i !== idx))} className="text-ink-400 hover:text-rose2-400">
                      <X size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Kitchen notes (e.g. table 5 in a hurry)"
            rows={2}
            className="w-full rounded-xl bg-ink-700 border border-ink-600 p-3 text-sm focus:border-saffron-500 focus:outline-none resize-none"
          />
          <Button full size="lg" disabled={cart.length === 0 || submitting} onClick={submit}>
            {submitting ? <Spinner /> : `Send order · ${formatIDR(value)}`}
          </Button>
        </div>
      </div>

      {customizing && (
        <QuickCustomize
          item={customizing}
          modifiers={modsByItem[customizing.id] ?? []}
          onClose={() => setCustomizing(null)}
          onAdd={(line) => {
            setCart((c) => [...c, line]);
            setCustomizing(null);
          }}
        />
      )}
    </Modal>
  );
}

function QuickCustomize({
  item, modifiers, onClose, onAdd,
}: {
  item: MenuItem;
  modifiers: MenuModifier[];
  onClose: () => void;
  onAdd: (l: CartLine) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const m of modifiers) init[m.id] = m.options.filter((o) => o.is_default).map((o) => o.id);
    return init;
  });

  const toggle = (modId: string, optId: string, max: number) => {
    setSelected((prev) => {
      const cur = prev[modId] ?? [];
      if (cur.includes(optId)) return { ...prev, [modId]: cur.filter((x) => x !== optId) };
      if (max === 1) return { ...prev, [modId]: [optId] };
      return { ...prev, [modId]: [...cur, optId] };
    });
  };

  const flatMods = modifiers.flatMap((m) =>
    (selected[m.id] ?? []).map((oid) => {
      const o = m.options.find((x) => x.id === oid)!;
      return { name: `${m.name}: ${o.name}`, price_delta_minor: o.price_delta_minor };
    })
  );
  const modSum = flatMods.reduce((s, m) => s + m.price_delta_minor, 0);
  const total = (item.price_minor + modSum) * quantity;
  const valid = modifiers.every((m) => (selected[m.id] ?? []).length >= m.min_select);

  return (
    <Modal open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {modifiers.map((m) => (
          <div key={m.id}>
            <div className="font-medium text-sm mb-2">{m.name} {m.required ? '' : '(optional)'}</div>
            <div className="flex flex-wrap gap-1.5">
              {m.options.map((o) => {
                const checked = (selected[m.id] ?? []).includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(m.id, o.id, m.max_select)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
                      checked ? 'bg-saffron-600 border-saffron-600 text-white' : 'border-ink-500 text-ink-200 hover:bg-ink-700'
                    )}
                  >
                    {o.name}{o.price_delta_minor > 0 ? ` +${formatIDR(o.price_delta_minor)}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          rows={2}
          className="w-full rounded-xl bg-ink-700 border border-ink-600 p-3 text-sm resize-none focus:border-saffron-500 focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-700 p-1">
            <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="h-9 w-9 rounded-lg hover:bg-ink-600 flex items-center justify-center"><Minus size={15} /></button>
            <span className="font-semibold w-5 text-center">{quantity}</span>
            <button onClick={() => setQuantity((q) => q + 1)} className="h-9 w-9 rounded-lg hover:bg-ink-600 flex items-center justify-center"><Plus size={15} /></button>
          </div>
          <Button disabled={!valid} onClick={() => onAdd({ item, quantity, modifiers: flatMods, notes, unitPriceMinor: item.price_minor })}>
            Add · {formatIDR(total)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
