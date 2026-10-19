import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ShoppingBag, ConciergeBell, ReceiptText, Plus, Minus, Music,
  Check, Utensils, GlassWater, Sparkles, Hand, MessageCircle, ChevronRight, Leaf, Flame, Clock,
} from 'lucide-react';
import { supabase, OUTLET_ID, DEMO_TENANT_ID } from '@/lib/supabase';
import type { Area, MenuItem, MenuCategory, MenuModifier, Outlet, Order, OrderItem, RestaurantTable, ServiceRequest } from '@/types';
import {
  cn, formatIDR, formatTime, formatDuration, isOutletOpenNow,
  serviceRequestReasonLabel, serviceRequestReasonIcon, dietaryLabel,
} from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import { Button, Modal, Badge, Spinner } from '@/components/ui';
import { QRCode } from '@/components/QRCode';
import { CartLine, cartTotal, placeOrder } from '@/lib/orders';
import { songApi, type SongGuestStatus } from '@/lib/songRequests';
import { SongRequestPanel } from '@/surfaces/guest/SongRequestPanel';
import { ensureSessionAndBill, recalcBill } from '@/lib/billing';
import { createBillPayment, payWithSnap, checkPaymentStatus } from '@/lib/midtrans';

export function GuestApp() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [pickedTable, setPickedTable] = useState<RestaurantTable | null>(null);

  useEffect(() => {
    supabase
      .from('tables')
      .select('*')
      .eq('outlet_id', OUTLET_ID)
      .order('label')
      .then(({ data }) => setTables((data as RestaurantTable[]) ?? []));
    supabase
      .from('areas')
      .select('*')
      .eq('outlet_id', OUTLET_ID)
      .is('archived_at', null)
      .order('sort_order')
      .then(({ data }) => setAreas((data as Area[]) ?? []));
  }, []);

  if (!pickedTable) {
    return <TablePicker tables={tables} areas={areas} onPick={setPickedTable} />;
  }
  return <GuestOrdering table={pickedTable} onBack={() => setPickedTable(null)} />;
}

function TablePicker({
  tables,
  areas,
  onPick,
}: {
  tables: RestaurantTable[];
  areas: Area[];
  onPick: (t: RestaurantTable) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-saffron-500/30 bg-saffron-500/10 px-3 py-1 text-xs font-medium text-saffron-400 mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-saffron-500 df-pulse" />
          Guest QR ordering · demo
        </div>
        <h1 className="font-display text-3xl font-bold">Scan a table to start</h1>
        <p className="mt-2 text-ink-300 text-sm max-w-md mx-auto">
          In the real product, a guest scans a unique QR code on the table. For this demo,
          pick a table below to land on its order page.
        </p>
      </div>
      {areas.map((area) => {
        const areaTables = tables.filter((t) => t.area_id === area.id);
        return (
          <div key={area.id} className="mb-6">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">
              {area.name}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {areaTables.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onPick(t)}
                  className="group rounded-2xl border border-ink-600 bg-ink-800 p-4 hover:border-saffron-500/50 hover:bg-ink-700 transition-all text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-display text-xl font-bold">{t.label}</div>
                    <div className="rounded-lg bg-ink-700 p-1.5 text-ink-400 group-hover:text-saffron-400 group-hover:bg-saffron-500/10 transition-colors">
                      <QRCode value={`#guest/${t.qr_token}`} size={36} />
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-ink-400">
                    {t.min_seats}-{t.max_seats} seats
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type View = 'menu' | 'tracker' | 'bill';

function GuestOrdering({ table, onBack }: { table: RestaurantTable; onBack: () => void }) {
  const now = useNow(30000);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [modifiers, setModifiers] = useState<MenuModifier[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');
  const [search, setSearch] = useState('');
  const [dietFilter, setDietFilter] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<MenuItem | null>(null);
  const [view, setView] = useState<View>('menu');
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [activeRequest, setActiveRequest] = useState<ServiceRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  const [songStatus, setSongStatus] = useState<SongGuestStatus | null>(null);
  const [songOpen, setSongOpen] = useState(false);

  const isOpen = outlet ? isOutletOpenNow(outlet.opening_hours) : true;

  // Song requests: fetch availability for this table (feature on + open).
  useEffect(() => {
    let alive = true;
    songApi.guest.status(table.qr_token).then(({ data }) => {
      if (alive) setSongStatus((data as unknown as SongGuestStatus) ?? null);
    });
    return () => { alive = false; };
  }, [table.qr_token]);

  // Load menu data
  useEffect(() => {
    supabase.from('outlets').select('*').eq('id', OUTLET_ID).maybeSingle().then(({ data }) => {
      if (data) setOutlet(data as Outlet);
    });
    supabase.from('areas').select('*').eq('id', table.area_id).maybeSingle().then(({ data }) => {
      if (data) setArea(data as Area);
    });
    supabase
      .from('menu_categories')
      .select('*')
      .eq('outlet_id', OUTLET_ID)
      .order('sort_order')
      .then(({ data }) => {
        const cats = (data as MenuCategory[]) ?? [];
        setCategories(cats);
        if (cats[0]) setActiveCat(cats[0].id);
      });
    supabase
      .from('menu_items')
      .select('*')
      .eq('outlet_id', OUTLET_ID)
      .order('sort_order')
      .then(({ data }) => setItems((data as MenuItem[]) ?? []));
    supabase
      .from('menu_modifiers')
      .select('*, options:menu_modifier_options(*)')
      .order('sort_order')
      .then(({ data }) => setModifiers((data as MenuModifier[]) ?? []));
  }, [table.area_id]);

  // Ensure session + bill on mount
  useEffect(() => {
    ensureSessionAndBill(DEMO_TENANT_ID, OUTLET_ID, table.id).then((r) => {
      if ('error' in r) return;
      setSessionId(r.session.id);
      setBillId(r.bill.id);
    });
  }, [table.id]);

  // Load existing orders for this session
  useEffect(() => {
    if (!sessionId) return;
    supabase
      .from('orders')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setOrders((data as Order[]) ?? []));
  }, [sessionId]);

  // Load order items for all session orders
  useEffect(() => {
    if (orders.length === 0) {
      setOrderItems([]);
      return;
    }
    supabase
      .from('order_items')
      .select('*')
      .in('order_id', orders.map((o) => o.id))
      .order('created_at', { ascending: true })
      .then(({ data }) => setOrderItems((data as OrderItem[]) ?? []));
  }, [orders]);

  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;

  // Realtime: new/updated orders & items for this session
  useEffect(() => {
    if (!sessionId) return;
    const ch = supabase
      .channel(`guest_${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `session_id=eq.${sessionId}` }, () => {
        supabase.from('orders').select('*').eq('session_id', sessionId).order('created_at', { ascending: false })
          .then(({ data }) => setOrders((data as Order[]) ?? []));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        const current = ordersRef.current;
        if (current.length === 0) return;
        supabase.from('order_items').select('*').in('order_id', current.map((o) => o.id)).order('created_at', { ascending: true })
          .then(({ data }) => setOrderItems((data as OrderItem[]) ?? []));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_requests', filter: `table_id=eq.${table.id}` }, () => {
        supabase.from('service_requests').select('*').eq('table_id', table.id).neq('status', 'done').order('created_at', { ascending: false }).limit(1).maybeSingle()
          .then(({ data }) => setActiveRequest((data as ServiceRequest) ?? null));
      })
      .subscribe();
    // Load active request
    supabase.from('service_requests').select('*').eq('table_id', table.id).neq('status', 'done').order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setActiveRequest((data as ServiceRequest) ?? null));
    return () => { supabase.removeChannel(ch); };
  }, [sessionId, table.id]);

  const modifiersByItem = useMemo(() => {
    const map: Record<string, MenuModifier[]> = {};
    for (const m of modifiers) {
      if (!map[m.item_id]) map[m.item_id] = [];
      map[m.item_id].push(m);
    }
    return map;
  }, [modifiers]);

  const filteredItems = useMemo(() => {
    return items.filter((i) => {
      if (i.sold_out || !i.available) return false;
      if (activeCat && i.category_id !== activeCat) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!i.name.toLowerCase().includes(q) && !(i.description ?? '').toLowerCase().includes(q)) return false;
      }
      if (dietFilter && !i.dietary_tags.includes(dietFilter)) return false;
      return true;
    });
  }, [items, activeCat, search, dietFilter]);

  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const cartValue = cartTotal(cart);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  const submitOrder = async () => {
    if (!sessionId || cart.length === 0) return;
    setSubmitting(true);
    const res = await placeOrder({
      tenantId: DEMO_TENANT_ID,
      outletId: OUTLET_ID,
      tableId: table.id,
      sessionId,
      lines: cart,
      source: 'qr',
    });
    setSubmitting(false);
    if (res.ok) {
      setCart([]);
      showToast(`Order #${res.orderNumber} sent to the kitchen`);
      setView('tracker');
    } else {
      showToast(res.error);
    }
  };

  const callWaiter = async (reason: ServiceRequest['reason'], detail?: string) => {
    const { data } = await supabase
      .from('service_requests')
      .insert({ table_id: table.id, outlet_id: OUTLET_ID, reason, detail: detail ?? null, status: 'sent' })
      .select('*')
      .single();
    if (data) {
      setActiveRequest(data as ServiceRequest);
      setBellOpen(false);
      showToast('Waiter notified');
    }
  };

  const cancelRequest = async () => {
    if (!activeRequest) return;
    await supabase.from('service_requests').update({ status: 'done', resolved_at: new Date().toISOString() }).eq('id', activeRequest.id);
    setActiveRequest(null);
  };

  return (
    <div className="min-h-screen pb-28 sm:pb-24">
      {/* Header */}
      <div className="sticky top-14 z-30 bg-ink-900/95 backdrop-blur border-b border-ink-600">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <button onClick={onBack} className="text-sm text-ink-300 hover:text-ink-100 inline-flex items-center gap-1">
              <ChevronRight size={16} className="rotate-180" /> Tables
            </button>
            <div className="text-center">
              <div className="font-display font-semibold">{outlet?.name ?? 'MenuList'}</div>
              <div className="text-xs text-ink-400">{table.label} · {area?.name}</div>
            </div>
            <div className="w-16" />
          </div>
          {!isOpen && (
            <div className="mt-2 rounded-lg bg-amber2-500/10 border border-amber2-500/30 px-3 py-2 text-xs text-amber2-400 text-center">
              We're currently closed — opening hours shown below. You can still browse the menu.
            </div>
          )}
        </div>
        {/* View tabs */}
        <div className="mx-auto max-w-3xl px-4 flex gap-1">
          {([['menu', 'Menu'], ['tracker', 'My orders'], ['bill', 'Bill & pay']] as [View, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                view === v ? 'border-saffron-500 text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-200'
              )}
            >
              {label}
              {v === 'tracker' && orders.length > 0 && (
                <span className="ml-1.5 rounded-full bg-saffron-500/20 text-saffron-400 text-[10px] px-1.5 py-0.5">{orders.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 pt-5">
        {view === 'menu' && (
          <MenuView
            categories={categories}
            activeCat={activeCat}
            setActiveCat={setActiveCat}
            search={search}
            setSearch={setSearch}
            dietFilter={dietFilter}
            setDietFilter={setDietFilter}
            items={filteredItems}
            onPick={setCustomizing}
            onAddQuick={(item) => {
              // quick add if no required modifiers
              const mods = modifiersByItem[item.id] ?? [];
              if (mods.some((m) => m.required)) {
                setCustomizing(item);
              } else {
                setCart((c) => [...c, {
                  item, quantity: 1, modifiers: [],
                  notes: '', unitPriceMinor: item.price_minor,
                }]);
                showToast(`${item.name} added`);
              }
            }}
          />
        )}
        {view === 'tracker' && (
          <TrackerView orders={orders} orderItems={orderItems} now={now} />
        )}
        {view === 'bill' && (
          <BillView
            table={table}
            sessionId={sessionId}
            billId={billId}
            outlet={outlet}
            orderItems={orderItems}
            onPaid={() => { setView('menu'); showToast('Payment received. Thank you!'); }}
          />
        )}
      </div>

      {/* Customization sheet */}
      {customizing && (
        <CustomizeSheet
          item={customizing}
          modifiers={modifiersByItem[customizing.id] ?? []}
          onClose={() => setCustomizing(null)}
          onAdd={(line) => {
            setCart((c) => [...c, line]);
            setCustomizing(null);
            showToast(`${line.item.name} added`);
          }}
        />
      )}

      {/* Bell modal */}
      <Modal open={bellOpen} onClose={() => setBellOpen(false)} title="Call a waiter">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(serviceRequestReasonLabel) as ServiceRequest['reason'][]).map((reason) => {
            const icon = serviceRequestReasonIcon[reason];
            return (
              <button
                key={reason}
                onClick={() => callWaiter(reason)}
                className="flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-700 hover:bg-ink-600 p-3 text-left transition-colors"
              >
                <ReasonIcon name={icon} />
                <span className="text-sm font-medium">{serviceRequestReasonLabel[reason]}</span>
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Active bell request banner */}
      {activeRequest && (
        <div className="fixed bottom-24 sm:bottom-20 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-md df-slide-up">
          <div className="rounded-2xl border border-saffron-500/40 bg-ink-800 p-4 shadow-card flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-saffron-500/15 text-saffron-400 flex items-center justify-center df-pulse">
              <ConciergeBell size={18} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">{serviceRequestReasonLabel[activeRequest.reason]}</div>
              <div className="text-xs text-ink-400">
                {activeRequest.status === 'sent' && 'Notified — waiting for a waiter'}
                {activeRequest.status === 'seen' && 'A waiter has seen your request'}
                {activeRequest.status === 'on_the_way' && 'Waiter is on the way'}
              </div>
            </div>
            <button onClick={cancelRequest} className="text-xs text-ink-400 hover:text-rose2-400">Cancel</button>
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-ink-600 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setBellOpen(true)}
            className="h-12 px-4 rounded-xl border border-ink-500 text-ink-100 hover:bg-ink-700 inline-flex items-center gap-2 font-medium transition-colors"
          >
            <ConciergeBell size={18} className="text-saffron-400" />
            <span className="hidden sm:inline">Call waiter</span>
          </button>
          {songStatus?.enabled && songStatus.open && (
            <button
              onClick={() => setSongOpen(true)}
              className="h-12 px-4 rounded-xl border border-ink-500 text-ink-100 hover:bg-ink-700 inline-flex items-center gap-2 font-medium transition-colors"
            >
              <Music size={18} className="text-saffron-400" />
              <span className="hidden sm:inline">Request a song</span>
            </button>
          )}
          <button
            disabled={cart.length === 0}
            onClick={() => setView('bill')}
            className="h-12 px-4 rounded-xl border border-ink-500 text-ink-100 hover:bg-ink-700 disabled:opacity-40 inline-flex items-center gap-2 font-medium transition-colors"
          >
            <ReceiptText size={18} />
            <span className="hidden sm:inline">Bill</span>
          </button>
          <Button
            full
            size="lg"
            disabled={cart.length === 0 || submitting}
            onClick={submitOrder}
          >
            <ShoppingBag size={18} />
            {cart.length === 0 ? 'Cart empty' : `Order · ${formatIDR(cartValue)}`}
            {cartCount > 0 && <span className="ml-1 rounded-full bg-white/20 text-[11px] px-1.5">{cartCount}</span>}
          </Button>
        </div>
      </div>

      {/* Song request modal */}
      {songOpen && (
        <SongRequestPanel token={table.qr_token} onClose={() => { setSongOpen(false); songApi.guest.status(table.qr_token).then(({ data }) => setSongStatus((data as unknown as SongGuestStatus) ?? null)); }} />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-28 sm:bottom-24 left-1/2 -translate-x-1/2 z-50 df-slide-up">
          <div className="rounded-full bg-ink-700 border border-ink-500 px-4 py-2 text-sm shadow-card">{toast}</div>
        </div>
      )}
    </div>
  );
}

function ReasonIcon({ name }: { name: string }) {
  const props = { size: 18, className: 'text-saffron-400' };
  switch (name) {
    case 'Hand': return <Hand {...props} />;
    case 'ReceiptText': return <ReceiptText {...props} />;
    case 'GlassWater': return <GlassWater {...props} />;
    case 'Sparkles': return <Sparkles {...props} />;
    case 'Utensils': return <Utensils {...props} />;
    default: return <MessageCircle {...props} />;
  }
}

function MenuView({
  categories, activeCat, setActiveCat, search, setSearch, dietFilter, setDietFilter,
  items, onPick, onAddQuick,
}: {
  categories: MenuCategory[];
  activeCat: string;
  setActiveCat: (s: string) => void;
  search: string;
  setSearch: (s: string) => void;
  dietFilter: string | null;
  setDietFilter: (s: string | null) => void;
  items: MenuItem[];
  onPick: (i: MenuItem) => void;
  onAddQuick: (i: MenuItem) => void;
}) {
  const diets = ['vegetarian', 'vegan', 'halal', 'gluten-free'];
  return (
    <div>
      {/* Search */}
      <div className="relative mb-3">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the menu"
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-ink-800 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
        />
      </div>
      {/* Diet filters */}
      <div className="flex gap-2 overflow-x-auto df-no-scrollbar pb-2 mb-2">
        <button
          onClick={() => setDietFilter(null)}
          className={cn(
            'px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap',
            !dietFilter ? 'bg-saffron-500/15 border-saffron-500/40 text-saffron-400' : 'border-ink-600 text-ink-300'
          )}
        >
          All
        </button>
        {diets.map((d) => (
          <button
            key={d}
            onClick={() => setDietFilter(dietFilter === d ? null : d)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap inline-flex items-center gap-1',
              dietFilter === d ? 'bg-emerald2-500/15 border-emerald2-500/40 text-emerald2-400' : 'border-ink-600 text-ink-300'
            )}
          >
            <Leaf size={12} />
            {dietaryLabel[d]}
          </button>
        ))}
      </div>
      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto df-no-scrollbar border-b border-ink-700 mb-4 -mx-4 px-4">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
              activeCat === c.id ? 'border-saffron-500 text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-200'
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      {/* Items */}
      {items.length === 0 ? (
        <div className="py-16 text-center text-ink-400 text-sm">No items match your search.</div>
      ) : (        <div className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onPick(item)}
              className="group w-full flex gap-4 rounded-2xl border border-ink-600 bg-ink-800 p-3 hover:border-saffron-500/40 text-left transition-all"
            >
              {item.photo_url && (
                <img
                  src={item.photo_url}
                  alt={item.name}
                  loading="lazy"
                  className="h-20 w-20 rounded-xl object-cover shrink-0 bg-ink-700"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold leading-tight">{item.name}</div>
                  <div className="font-display font-bold text-saffron-400 shrink-0">{formatIDR(item.price_minor)}</div>
                </div>
                {item.description && (
                  <div className="mt-1 text-sm text-ink-400 line-clamp-2">{item.description}</div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {item.dietary_tags.filter((t) => t !== 'gluten').map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-emerald2-500/10 text-emerald2-400 text-[10px] px-2 py-0.5 font-medium">
                      <Leaf size={9} /> {dietaryLabel[t] ?? t}
                    </span>
                  ))}
                  {item.allergens.length > 0 && !item.allergens.includes('none') && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose2-500/10 text-rose2-400 text-[10px] px-2 py-0.5 font-medium">
                      <Flame size={9} /> {item.allergens.slice(0, 2).join(', ')}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[10px] text-ink-400">
                    <Clock size={10} /> {Math.round(item.prep_time_seconds / 60)}m
                  </span>
                </div>
              </div>
              <div className="flex items-center self-center">
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Quick add ${item.name}`}
                  onClick={(e) => { e.stopPropagation(); onAddQuick(item); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onAddQuick(item); } }}
                  className="h-8 w-8 rounded-lg bg-saffron-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform"
                >
                  <Plus size={16} />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomizeSheet({
  item, modifiers, onClose, onAdd,
}: {
  item: MenuItem;
  modifiers: MenuModifier[];
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const m of modifiers) {
      const defaults = m.options.filter((o) => o.is_default).map((o) => o.id);
      init[m.id] = defaults;
    }
    return init;
  });

  const toggle = (modId: string, optId: string, max: number) => {
    setSelected((prev) => {
      const cur = prev[modId] ?? [];
      if (cur.includes(optId)) return { ...prev, [modId]: cur.filter((x) => x !== optId) };
      if (cur.length >= max) return { ...prev, [modId]: [optId] };
      return { ...prev, [modId]: [...cur, optId] };
    });
  };

  const selectedOptions = modifiers.map((m) => ({
    mod: m,
    opts: (selected[m.id] ?? []).map((oid) => m.options.find((o) => o.id === oid)!).filter(Boolean),
  }));
  const modSum = selectedOptions.reduce((s, so) => s + so.opts.reduce((ss, o) => ss + o.price_delta_minor, 0), 0);
  const unitPrice = item.price_minor + modSum;
  const total = unitPrice * quantity;

  const add = () => {
    const flatMods = selectedOptions.flatMap((so) => so.opts.map((o) => ({ name: `${so.mod.name}: ${o.name}`, price_delta_minor: o.price_delta_minor })));
    onAdd({
      item, quantity, modifiers: flatMods, notes, unitPriceMinor: item.price_minor,
    });
  };

  const valid = modifiers.every((m) => (selected[m.id] ?? []).length >= m.min_select);

  return (
    <Modal open onClose={onClose} title={item.name}>
      {item.photo_url && (
        <img src={item.photo_url} alt={item.name} className="w-full h-44 object-cover rounded-xl mb-4" />
      )}
      {item.description && <p className="text-sm text-ink-300 mb-4">{item.description}</p>}

      <div className="space-y-5">
        {modifiers.map((m) => (
          <div key={m.id}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm">{m.name}</div>
              <div className="text-xs text-ink-400">
                {m.required ? 'Required' : 'Optional'} · pick {m.min_select}-{m.max_select}
              </div>
            </div>
            <div className="space-y-2">
              {m.options.map((o) => {
                const checked = (selected[m.id] ?? []).includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(m.id, o.id, m.max_select)}
                    className={cn(
                      'w-full flex items-center justify-between rounded-xl border p-3 text-left transition-colors',
                      checked ? 'border-saffron-500/50 bg-saffron-500/10' : 'border-ink-600 bg-ink-700 hover:bg-ink-600'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        'h-5 w-5 rounded-md border flex items-center justify-center',
                        checked ? 'bg-saffron-600 border-saffron-600' : 'border-ink-500'
                      )}>
                        {checked && <Check size={12} className="text-white" />}
                      </span>
                      <span className="text-sm">{o.name}</span>
                    </div>
                    {o.price_delta_minor > 0 && (
                      <span className="text-xs text-saffron-400">+{formatIDR(o.price_delta_minor)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div>
          <div className="font-medium text-sm mb-2">Special notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="No onion, less spicy, etc."
            rows={2}
            className="w-full rounded-xl bg-ink-700 border border-ink-600 p-3 text-sm focus:border-saffron-500 focus:outline-none resize-none"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-700 p-1">
            <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="h-9 w-9 rounded-lg hover:bg-ink-600 flex items-center justify-center">
              <Minus size={16} />
            </button>
            <span className="font-semibold w-6 text-center">{quantity}</span>
            <button onClick={() => setQuantity((q) => q + 1)} className="h-9 w-9 rounded-lg hover:bg-ink-600 flex items-center justify-center">
              <Plus size={16} />
            </button>
          </div>
          <Button size="lg" disabled={!valid} onClick={add} className="min-w-[180px]">
            Add · {formatIDR(total)}
          </Button>
        </div>
        {!valid && <div className="text-xs text-rose2-400 text-center">Please complete all required options.</div>}
      </div>
    </Modal>
  );
}

const itemStatusFlow: Record<string, string[]> = {
  received: ['received', 'accepted', 'preparing', 'ready', 'served'],
  accepted: ['accepted', 'preparing', 'ready', 'served'],
  preparing: ['preparing', 'ready', 'served'],
  ready: ['ready', 'served'],
  served: ['served'],
  voided: [],
  rejected: [],
};

function TrackerView({ orders, orderItems, now }: { orders: Order[]; orderItems: OrderItem[]; now: number }) {
  if (orders.length === 0) {
    return (
      <div className="py-20 text-center">
        <ShoppingBag size={40} className="mx-auto text-ink-500 mb-3" />
        <div className="text-ink-200 font-medium">No orders yet</div>
        <div className="text-sm text-ink-400 mt-1">Browse the menu and send your first order.</div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {orders.map((o) => {
        const items = orderItems.filter((i) => i.order_id === o.id);
        const allServed = items.length > 0 && items.every((i) => i.status === 'served' || i.status === 'voided' || i.status === 'rejected');
        const orderElapsed = Math.floor((now - new Date(o.created_at).getTime()) / 1000);
        return (
          <div key={o.id} className="rounded-2xl border border-ink-600 bg-ink-800 p-4 df-slide-up">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-display font-bold text-lg">Order #{o.order_number}</div>
                <div className="text-xs text-ink-400">{formatTime(o.created_at)} · {formatDuration(orderElapsed)} ago</div>
              </div>
              <Badge className={cn(
                allServed ? 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30' : 'bg-saffron-500/15 text-saffron-400 border-saffron-500/30'
              )}>
                {allServed ? 'Served' : 'In progress'}
              </Badge>
            </div>
            <div className="space-y-2">
              {items.map((it) => {
                const flow = itemStatusFlow[it.status] ?? [];
                const currentIdx = flow.length > 0 ? 0 : -1;
                const stages = ['Received', 'Preparing', 'Ready', 'Served'];
                const itemStageMap: Record<string, number> = {
                  received: 0, accepted: 0, preparing: 1, ready: 2, served: 3, voided: -1, rejected: -1,
                };
                const stage = itemStageMap[it.status];
                return (
                  <div key={it.id} className="rounded-xl bg-ink-700/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm">
                        <span className="font-semibold">{it.quantity}×</span> {it.name}
                      </div>
                      {it.status === 'voided' || it.status === 'rejected' ? (
                        <Badge className="bg-rose2-500/15 text-rose2-400 border-rose2-500/30">{it.status === 'rejected' ? 'Rejected' : 'Voided'}</Badge>
                      ) : (
                        <Badge className="bg-ink-600 text-ink-200 border-ink-500">{stages[stage]}</Badge>
                      )}
                    </div>
                    {it.modifiers && it.modifiers.length > 0 && (
                      <div className="text-xs text-ink-400 mb-2">{it.modifiers.map((m) => m.name).join(' · ')}</div>
                    )}
                    {it.notes && <div className="text-xs text-amber2-400 mb-2">"{it.notes}"</div>}
                    {it.status !== 'voided' && it.status !== 'rejected' && (
                      <div className="flex items-center gap-1">
                        {stages.map((s, idx) => (
                          <div key={s} className="flex-1 flex items-center gap-1">
                            <div className={cn(
                              'h-1.5 flex-1 rounded-full',
                              idx <= stage ? 'bg-saffron-500' : 'bg-ink-600'
                            )} />
                          </div>
                        ))}
                      </div>
                    )}
                    {/* suppress unused */}
                    <span className="hidden">{currentIdx}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BillView({
  table, sessionId, billId, outlet, orderItems, onPaid,
}: {
  table: RestaurantTable;
  sessionId: string | null;
  billId: string | null;
  outlet: Outlet | null;
  orderItems: OrderItem[];
  onPaid: () => void;
}) {
  const [tipPct, setTipPct] = useState(0);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<'online' | 'cash'>('online');
  const [payState, setPayState] = useState<'idle' | 'snap_open' | 'checking' | 'failed'>('idle');
  const [payError, setPayError] = useState<string | null>(null);
  const [onlineConfigured, setOnlineConfigured] = useState<boolean | null>(null);

  const eligible = orderItems.filter((i) => i.status !== 'voided' && i.status !== 'rejected');
  const breakdown = useMemo(() => {
    if (!outlet) return null;
    const subtotal = eligible.reduce((s, i) => {
      const modSum = (i.modifiers ?? []).reduce((ss, m) => ss + m.price_delta_minor, 0);
      return s + (i.unit_price_minor + modSum) * i.quantity;
    }, 0);
    const tip = Math.round((subtotal * tipPct) / 100);
    const afterDiscount = subtotal;
    const tax = Math.round((afterDiscount * outlet.tax_percent) / 100);
    const service = Math.round((afterDiscount * outlet.service_charge_percent) / 100);
    const total = afterDiscount + tax + service + tip;
    return { subtotal, tax, service, tip, total };
  }, [eligible, outlet, tipPct]);

  // Check whether this restaurant has online payments configured
  useEffect(() => {
    if (!table.qr_token) return;
    createBillPayment({ sessionToken: table.qr_token })
      .then((r) => {
        if (r.notConfigured) {
          setOnlineConfigured(false);
          setMethod('cash');
        } else if (r.ok) {
          setOnlineConfigured(true);
        }
      })
      .catch(() => setOnlineConfigured(false));
  }, [table.qr_token]);

  const payOnline = async () => {
    if (!billId || !outlet || !breakdown || !table.qr_token) return;
    setPaying(true);
    setPayError(null);
    setPayState('idle');

    const result = await createBillPayment({
      sessionToken: table.qr_token,
      tipMinor: breakdown.tip,
    });

    if (result.notConfigured) {
      setPayError('Online payments are not available. Please pay at the counter.');
      setOnlineConfigured(false);
      setMethod('cash');
      setPaying(false);
      return;
    }
    if (!result.ok || !result.snapToken || !result.clientKey) {
      setPayError(result.error || 'Could not start payment. Please try the counter.');
      setPayState('failed');
      setPaying(false);
      return;
    }

    setPayState('snap_open');

    await payWithSnap({
      snapToken: result.snapToken,
      clientKey: result.clientKey,
      isProduction: result.isProduction ?? false,
      onSuccess: async () => {
        setPayState('checking');
        if (result.orderId) {
          await checkPaymentStatus(result.orderId, 'bill');
        }
        setPaying(false);
        onPaid();
      },
      onPending: () => {
        setPayState('idle');
        setPayError('Payment is pending. You can complete it later.');
        setPaying(false);
      },
      onError: () => {
        setPayState('failed');
        setPayError('Payment failed. Please try again or pay at the counter.');
        setPaying(false);
      },
      onClose: () => {
        setPayState('idle');
        setPaying(false);
      },
    });
  };

  const payCash = async () => {
    if (!billId || !outlet || !breakdown || !sessionId) return;
    setPaying(true);
    setPayError(null);
    await recalcBill(billId, orderItems, outlet, 0, breakdown.tip);
    await supabase.from('payments').insert({
      bill_id: billId,
      method: 'cash',
      amount_minor: breakdown.total,
      status: 'completed',
    });
    await supabase.from('bills').update({ status: 'paid', closed_at: new Date().toISOString() }).eq('id', billId);
    await supabase.from('table_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', sessionId);
    await supabase.from('tables').update({ status: 'cleaning', updated_at: new Date().toISOString() }).eq('id', table.id);
    setPaying(false);
    onPaid();
  };

  if (!outlet || !breakdown) {
    return <div className="py-20 text-center"><Spinner className="mx-auto" /></div>;
  }
  if (eligible.length === 0) {
    return (
      <div className="py-20 text-center">
        <ReceiptText size={40} className="mx-auto text-ink-500 mb-3" />
        <div className="text-ink-200 font-medium">Nothing on your bill yet</div>
        <div className="text-sm text-ink-400 mt-1">Place an order to see your bill here.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs text-ink-400 uppercase tracking-wider">Table {table.label}</div>
            <div className="font-display text-xl font-bold">Your bill</div>
          </div>
          <ReceiptText size={22} className="text-saffron-400" />
        </div>
        <div className="space-y-2 mb-4">
          {eligible.map((i) => {
            const modSum = (i.modifiers ?? []).reduce((s, m) => s + m.price_delta_minor, 0);
            const lineTotal = (i.unit_price_minor + modSum) * i.quantity;
            return (
              <div key={i.id} className="flex items-start justify-between text-sm">
                <div className="min-w-0 pr-2">
                  <div><span className="font-semibold">{i.quantity}×</span> {i.name}</div>
                  {i.modifiers && i.modifiers.length > 0 && (
                    <div className="text-xs text-ink-400 mt-0.5">{i.modifiers.map((m) => m.name).join(', ')}</div>
                  )}
                  {i.notes && <div className="text-xs text-amber2-400 mt-0.5">"{i.notes}"</div>}
                </div>
                <div className="text-ink-200 shrink-0">{formatIDR(lineTotal)}</div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-ink-600 pt-3 space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatIDR(breakdown.subtotal)} />
          <Row label={`Tax (${outlet.tax_percent}%)`} value={formatIDR(breakdown.tax)} />
          <Row label={`Service (${outlet.service_charge_percent}%)`} value={formatIDR(breakdown.service)} />
          <div className="flex items-center justify-between pt-1">
            <span className="text-ink-300">Add a tip</span>
            <div className="flex gap-1.5">
              {[0, 5, 10, 15].map((p) => (
                <button
                  key={p}
                  onClick={() => setTipPct(p)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-medium border',
                    tipPct === p ? 'bg-saffron-500/15 border-saffron-500/40 text-saffron-400' : 'border-ink-600 text-ink-300'
                  )}
                >
                  {p === 0 ? 'No tip' : `${p}%`}
                </button>
              ))}
            </div>
          </div>
          {breakdown.tip > 0 && <Row label="Tip" value={formatIDR(breakdown.tip)} />}
          <div className="flex items-center justify-between pt-2 border-t border-ink-600 mt-2">
            <span className="font-display font-bold text-lg">Total</span>
            <span className="font-display font-bold text-lg text-saffron-400">{formatIDR(breakdown.total)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm font-medium mb-2">Pay with</div>
        <div className={cn('grid gap-2 mb-4', onlineConfigured === false ? 'grid-cols-1' : 'grid-cols-2')}>
          {onlineConfigured !== false && (
            <button
              onClick={() => setMethod('online')}
              disabled={paying || payState === 'snap_open'}
              className={cn(
                'rounded-xl border p-3 text-sm font-medium transition-colors',
                method === 'online' ? 'border-saffron-500/50 bg-saffron-500/10 text-saffron-400' : 'border-ink-600 bg-ink-800 text-ink-200 hover:bg-ink-700'
              )}
            >
              QRIS / e-wallet / card
            </button>
          )}
          <button
            onClick={() => setMethod('cash')}
            disabled={paying || payState === 'snap_open'}
            className={cn(
              'rounded-xl border p-3 text-sm font-medium transition-colors',
              method === 'cash' ? 'border-saffron-500/50 bg-saffron-500/10 text-saffron-400' : 'border-ink-600 bg-ink-800 text-ink-200 hover:bg-ink-700'
            )}
          >
            Pay at counter
          </button>
        </div>

        {payError && (
          <div className="mb-3 rounded-lg bg-rose2-500/10 border border-rose2-500/30 px-3 py-2 text-xs text-rose2-400">
            {payError}
          </div>
        )}

        {method === 'online' ? (
          <>
            <Button full size="lg" onClick={payOnline} disabled={paying || payState === 'snap_open' || payState === 'checking'}>
              {paying ? <Spinner /> : payState === 'snap_open' ? 'Complete in popup...' : payState === 'checking' ? <Spinner /> : `Pay ${formatIDR(breakdown.total)}`}
            </Button>
            <div className="text-xs text-ink-400 text-center mt-2">
              A secure Midtrans popup will open with QRIS, GoPay, and card options.
            </div>
          </>
        ) : (
          <>
            <Button full size="lg" onClick={payCash} disabled={paying}>
              {paying ? <Spinner /> : `Request bill at counter`}
            </Button>
            <div className="text-xs text-ink-400 text-center mt-2">
              A waiter will bring the bill to your table.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-400">{label}</span>
      <span className="text-ink-100">{value}</span>
    </div>
  );
}
