import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Package, ArrowLeft, Plus, Search, Download, Upload, Pencil, AlertTriangle,
  ShoppingBasket, FileText, ClipboardCheck, Trash2, TrendingDown, Truck, BarChart3, Settings2,
} from 'lucide-react';
import { cn, formatIDR } from '@/lib/format';
import { Spinner, EmptyState, Button, Modal } from '@/components/ui';
import { useTenantFromAuth } from '@/lib/tenant';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { loadBillingState } from '@/lib/saasBilling';
import { PLAN_MAP } from '@/lib/plans';
import {
  loadInventoryCore, stockStatus, STATUS_LABEL, STATUS_STYLE, formatQty, stockValue,
  recordPurchase, adjustStock, logWaste, approveCount, postGoodsReceipt,
  transferSend, transferReceive,
  STOCK_UNITS, DEFAULT_CATEGORIES, WASTE_REASONS,
  type Ingredient, type IngredientCategory, type Supplier, type StockLevel,
  type WasteReason, type InventoryState, type StockCount, type StockCountItem,
  type WasteLog, type Transfer, type PurchaseOrder, type PurchaseOrderItem,
} from '@/lib/inventory';

type Tab = 'overview' | 'items' | 'recipes' | 'suppliers' | 'purchase-orders' | 'counts' | 'waste' | 'transfers' | 'reports' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof Package }[] = [
  { id: 'overview', label: 'Overview', icon: Package },
  { id: 'items', label: 'Items', icon: ShoppingBasket },
  { id: 'recipes', label: 'Recipes', icon: FileText },
  { id: 'suppliers', label: 'Suppliers', icon: Truck },
  { id: 'purchase-orders', label: 'Purchasing', icon: FileText },
  { id: 'counts', label: 'Counts', icon: ClipboardCheck },
  { id: 'waste', label: 'Waste', icon: Trash2 },
  { id: 'transfers', label: 'Transfers', icon: Truck },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

export function InventoryApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const tenantCtx = useTenantFromAuth();
  const { profile } = useAuth();
  const [state, setState] = useState<InventoryState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const isManager = tenantCtx.isManager;
  const isChef = tenantCtx.role === 'chef';
  const canView = isManager || isChef;
  const tab = (location.pathname.split('/').filter(Boolean)[1] ?? 'overview') as Tab;
  const [planId, setPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    // Plan gate: inventory is a Growth/Chain feature. Read the tenant's plan
    // from billing (plan_overrides are not needed here, only the flag).
    supabase.from('tenants').select('plan').eq('id', tenantCtx.tenantId).maybeSingle()
      .then(({ data }) => setPlanId((data as { plan: string } | null)?.plan ?? 'starter'));
  }, [tenantCtx.tenantId, canView]);

  useEffect(() => {
    if (!canView) return;
    loadInventoryCore(tenantCtx.tenantId, tenantCtx.outlet?.id ?? '')
      .then((s) => {
        if (s.error) setLoadErr(s.error);
        setState(s);
      });
  }, [tenantCtx.tenantId, tenantCtx.outlet?.id, canView]);

  if (canView && planId && !PLAN_MAP[planId as 'growth' | 'chain']?.featureFlags.inventory) {
    return (
      <div className="min-h-screen bg-ink-900 text-ink-100">
        <InventoryHeader onBack={() => navigate('/app')} />
        <div className="mx-auto max-w-[800px] px-4 py-16">
          <div className="rounded-2xl border border-saffron-500/30 bg-saffron-500/10 p-8 text-center">
            <Package size={40} className="mx-auto text-saffron-400" />
            <h2 className="font-display text-2xl font-bold mt-4">Inventory is on Growth and Chain</h2>
            <p className="text-sm text-ink-300 mt-2 max-w-md mx-auto">
              Track stock, cost your recipes, automate purchasing and cut waste.
              Upgrade to Growth to unlock Inventory for your restaurant.
            </p>
            <Button className="mt-6" onClick={() => navigate('/billing')}>See plans</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-ink-900 text-ink-100">
        <InventoryHeader onBack={() => navigate('/app')} />
        <div className="mx-auto max-w-[800px] px-4 py-16">
          <EmptyState
            icon={<AlertTriangle size={40} />}
            title="No access"
            hint="Inventory is available to owners, managers and chefs."
          />
        </div>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="min-h-screen bg-ink-900 text-ink-100">
        <InventoryHeader onBack={() => navigate('/app')} />
        <div className="mx-auto max-w-[800px] px-4 py-16">
          <EmptyState icon={<AlertTriangle size={40} />} title="Could not load inventory" hint={loadErr} />
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>
    );
  }

  const tabs = TABS.filter((t) => {
    // Chef sees stock, counts and waste only.
    if (isChef && !['overview', 'items', 'counts', 'waste'].includes(t.id)) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <InventoryHeader onBack={() => navigate('/app')} />
      <div className="border-b border-ink-600 bg-ink-900/95 backdrop-blur sticky top-16 z-30">
        <div className="mx-auto max-w-[1200px] px-4 flex gap-1 overflow-x-auto df-no-scrollbar">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => navigate(`/inventory/${t.id === 'overview' ? '' : t.id}`.replace(/\/$/, ''))}
                className={cn(
                  'px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                  tab === t.id ? 'border-saffron-500 text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-200'
                )}
              >
                <Icon size={14} className="inline mr-1.5 -mt-0.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 py-6">
        {tab === 'overview' && <Overview state={state} tenantCtx={tenantCtx} isManager={isManager} />}
        {tab === 'items' && <Items state={state} setState={setState} canEdit={isManager} />}
        {tab === 'recipes' && <Recipes state={state} canEdit={isManager} />}
        {tab === 'suppliers' && <Suppliers state={state} setState={setState} canEdit={isManager} />}
        {tab === 'purchase-orders' && <PurchaseOrders state={state} setState={setState} canEdit={isManager} />}
        {tab === 'counts' && <Counts state={state} setState={setState} canEdit={isManager} />}
        {tab === 'waste' && <Waste state={state} setState={setState} />}
        {tab === 'transfers' && <Transfers state={state} setState={setState} canEdit={isManager} />}
        {tab === 'reports' && <Reports state={state} />}
        {tab === 'settings' && <SettingsTab state={state} setState={setState} canEdit={isManager} />}
      </div>
    </div>
  );
}

function InventoryHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
      <div className="mx-auto max-w-[1200px] px-4 h-16 flex items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-ink-100">
          <ArrowLeft size={15} /> Dashboard
        </button>
        <div className="ml-2 flex items-center gap-2">
          <Package size={18} className="text-saffron-400" />
          <h1 className="font-display font-bold text-lg">Inventory</h1>
        </div>
      </div>
    </header>
  );
}

// ================= Overview =================
function Overview({ state, tenantCtx, isManager }: { state: InventoryState; tenantCtx: ReturnType<typeof useTenantFromAuth>; isManager: boolean }) {
  const low = state.ingredients.filter((i) => i.active && stockStatus(i, state.stockLevels.get(i.id)?.qty) !== 'ok');
  const expiringSoon = useMemo(() => low.length, [low]);
  const navigate = useNavigate();

  const empty = state.ingredients.length === 0;
  return (
    <div className="space-y-6">
      {empty ? (
        <div className="rounded-2xl border border-ink-600 bg-ink-800 p-8">
          <h2 className="font-display text-xl font-bold">Set up inventory in 3 steps</h2>
          <ol className="mt-4 space-y-3 text-sm text-ink-300">
            <li className="flex gap-3"><span className="h-6 w-6 rounded-full bg-saffron-600 text-white flex items-center justify-center text-xs font-bold shrink-0">1</span>Add your ingredients (stock items) — what you buy and store.</li>
            <li className="flex gap-3"><span className="h-6 w-6 rounded-full bg-saffron-600 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>Add recipes — link menu items to the ingredients they use.</li>
            <li className="flex gap-3"><span className="h-6 w-6 rounded-full bg-saffron-600 text-white flex items-center justify-center text-xs font-bold shrink-0">3</span>Do an opening count — tell MenuList what you have on hand today.</li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => navigate('/inventory/items')}><Plus size={15} /> Add ingredients</Button>
            {isManager && <SeedButton tenantId={tenantCtx.tenantId} outletId={tenantCtx.outlet?.id ?? ''} onDone={() => window.location.reload()} />}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
            <div className="text-xs text-ink-400">Stock value</div>
            <div className="font-display text-2xl font-bold mt-1">{formatIDR(stockValue(state.stockLevels))}</div>
          </div>
          <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
            <div className="text-xs text-ink-400">Items low or out</div>
            <div className={cn('font-display text-2xl font-bold mt-1', low.length > 0 ? 'text-amber2-400' : 'text-emerald2-400')}>{low.length}</div>
          </div>
          <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
            <div className="text-xs text-ink-400">Ingredients tracked</div>
            <div className="font-display text-2xl font-bold mt-1">{state.ingredients.filter((i) => i.active).length}</div>
          </div>
          <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
            <div className="text-xs text-ink-400">Recipes</div>
            <div className="font-display text-2xl font-bold mt-1">{state.recipeCount}<span className="text-sm text-ink-400 font-normal"> / {state.menuTotal} items</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function SeedButton({ tenantId, outletId, onDone }: { tenantId: string; outletId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <Button variant="secondary" disabled={busy} onClick={async () => {
        setBusy(true);
        const { error } = await supabase.rpc('inv_seed_sample_data', { p_tenant: tenantId, p_outlet: outletId });
        setBusy(false);
        if (error) setErr(error.message); else onDone();
      }}>
        {busy ? 'Loading…' : 'Start with sample data'}
      </Button>
      {err && <div className="text-xs text-rose2-400 mt-2">{err}</div>}
      </div>
  );
}

// ================= Items =================
function Items({ state, setState, canEdit }: { state: InventoryState; setState: (s: InventoryState) => void; canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);

  const rows = state.ingredients.filter((i) => {
    if (search && !(`${i.name} ${i.sku ?? ''} ${i.barcode ?? ''}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (cat !== 'all' && i.category_id !== cat) return false;
    if (lowOnly && stockStatus(i, state.stockLevels.get(i.id)?.qty) === 'ok') return false;
    return true;
  });

  const exportCsv = () => {
    const header = ['name', 'sku', 'category', 'stock_unit', 'cost_minor', 'min_level', 'par_level', 'qty'];
    const lines = [header.join(',')];
    for (const i of state.ingredients) {
      lines.push([
        i.name, i.sku ?? '', state.categories.find((c) => c.id === i.category_id)?.name ?? '',
        i.stock_unit, i.cost_per_stock_unit_minor, i.min_level, i.par_level,
        state.stockLevels.get(i.id)?.qty ?? 0,
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'menu-list-inventory.csv';
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, SKU or barcode…"
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-ink-800 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
          />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 px-3 rounded-xl bg-ink-800 border border-ink-600 text-sm">
          <option value="all">All categories</option>
          {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          onClick={() => setLowOnly(!lowOnly)}
          className={cn('h-10 px-3 rounded-xl text-sm font-medium border transition-colors',
            lowOnly ? 'border-amber2-500/50 bg-amber2-500/10 text-amber2-400' : 'border-ink-600 text-ink-300 hover:text-ink-100')}
        >
          Low stock only
        </button>
        <button onClick={exportCsv} className="h-10 px-3 rounded-xl border border-ink-600 text-sm text-ink-300 hover:text-ink-100 inline-flex items-center gap-1.5">
          <Download size={14} /> Export
        </button>
        <ImportCsvButton state={state} setState={setState} canEdit={canEdit} />
        {canEdit && (
          <Button onClick={() => setEditing('new')}><Plus size={15} /> Add ingredient</Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<ShoppingBasket size={40} />} title="No ingredients yet" hint="Add what you buy and store — produce, meat, dairy, packaging and more." />
      ) : (
        <div className="rounded-2xl border border-ink-600 bg-ink-800 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="border-b border-ink-700 text-ink-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Ingredient</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-right px-4 py-3 font-medium">On hand</th>
                <th className="text-right px-4 py-3 font-medium">Min / Par</th>
                <th className="text-right px-4 py-3 font-medium">Stock value</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                {canEdit && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const qty = state.stockLevels.get(i.id)?.qty;
                const st = stockStatus(i, qty);
                const val = (qty ?? 0) * i.cost_per_stock_unit_minor;
                return (
                  <tr key={i.id} className="border-b border-ink-700/50 last:border-0 hover:bg-ink-700/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{i.name}</div>
                      {i.sku && <div className="text-xs text-ink-500">SKU {i.sku}</div>}
                    </td>
                    <td className="px-4 py-3 text-ink-300">{state.categories.find((c) => c.id === i.category_id)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatQty(qty)} {i.stock_unit}</td>
                    <td className="px-4 py-3 text-right text-ink-400 font-mono text-xs">{formatQty(i.min_level)} / {formatQty(i.par_level)}</td>
                    <td className="px-4 py-3 text-right">{formatIDR(Math.round(val))}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLE[st])}>
                        {STATUS_LABEL[st]}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setEditing(i)} className="text-ink-400 hover:text-ink-100"><Pencil size={15} /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <IngredientModal
          state={state}
          ingredient={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function ImportCsvButton({ state, setState: _setState, canEdit }: { state: InventoryState; setState: (s: InventoryState) => void; canEdit: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;
  return (
    <label className="h-10 px-3 rounded-xl border border-ink-600 text-sm text-ink-300 hover:text-ink-100 inline-flex items-center gap-1.5 cursor-pointer hover:bg-ink-800 transition-colors">
      <Upload size={14} /> Import CSV
      <input
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setErr(null);
          const text = await file.text();
          const lines = text.split(/\r?\n/).filter(Boolean);
          const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
          const nameIdx = header.indexOf('name');
          const unitIdx = header.indexOf('stock_unit');
          const costIdx = header.indexOf('cost_minor');
          const minIdx = header.indexOf('min_level');
          const rowsErr: string[] = [];
          const outletId = state.ingredients[0]?.outlet_id;
          const tenantId = state.ingredients[0]?.tenant_id;
          if (nameIdx === -1) { setErr('CSV must have a "name" column.'); return; }
          for (const line of lines.slice(1)) {
            const cells = line.split(',').map((c) => c.trim());
            const name = cells[nameIdx];
            if (!name) continue;
            const unit = (unitIdx >= 0 ? cells[unitIdx] : 'pcs') as Ingredient['stock_unit'];
            const validUnit = STOCK_UNITS.includes(unit) ? unit : 'pcs';
            const { error } = await supabase.from('ingredients').insert({
              tenant_id: tenantId,
              outlet_id: outletId,
              name,
              stock_unit: validUnit,
              cost_per_stock_unit_minor: costIdx >= 0 ? Math.round(Number(cells[costIdx]) || 0) : 0,
              min_level: minIdx >= 0 ? Number(cells[minIdx]) || 0 : 0,
            });
            if (error) rowsErr.push(`${name}: ${error.message}`);
          }
          setErr(rowsErr.length ? rowsErr.slice(0, 3).join('; ') : null);
          if (!rowsErr.length) window.location.reload();
        }}
      />
      {err && <span className="text-rose2-400 ml-2">{err}</span>}
    </label>
  );
}

function IngredientModal({ state, ingredient, onClose, onSaved }: {
  state: InventoryState;
  ingredient: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(ingredient?.name ?? '');
  const [sku, setSku] = useState(ingredient?.sku ?? '');
  const [catId, setCatId] = useState(ingredient?.category_id ?? '');
  const [unit, setUnit] = useState<Ingredient['stock_unit']>(ingredient?.stock_unit ?? 'pcs');
  const [purchaseUnit, setPurchaseUnit] = useState(ingredient?.purchase_unit ?? 'pcs');
  const [conversion, setConversion] = useState(String(ingredient?.purchase_conversion ?? 1));
  const [supplierId, setSupplierId] = useState(ingredient?.default_supplier_id ?? '');
  const [cost, setCost] = useState(String((ingredient?.cost_per_stock_unit_minor ?? 0) / 100));
  const [minLevel, setMinLevel] = useState(String(ingredient?.min_level ?? 0));
  const [parLevel, setParLevel] = useState(String(ingredient?.par_level ?? 0));
  const [location, setLocation] = useState(ingredient?.storage_location ?? '');
  const [shelfLife, setShelfLife] = useState(ingredient?.shelf_life_days != null ? String(ingredient.shelf_life_days) : '');
  const [photoUrl, setPhotoUrl] = useState(ingredient?.photo_url ?? '');
  const [active, setActive] = useState(ingredient?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const outletId = ingredient?.outlet_id ?? state.ingredients[0]?.outlet_id;
  const tenantId = ingredient?.tenant_id ?? state.ingredients[0]?.tenant_id;

  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    setBusy(true);
    const row = {
      tenant_id: tenantId,
      outlet_id: outletId,
      name: name.trim(),
      sku: sku.trim() || null,
      category_id: catId || null,
      stock_unit: unit,
      purchase_unit: purchaseUnit.trim() || unit,
      purchase_conversion: Number(conversion) || 1,
      default_supplier_id: supplierId || null,
      cost_per_stock_unit_minor: Math.round(Number(cost) * 100) || 0,
      min_level: Number(minLevel) || 0,
      par_level: Number(parLevel) || 0,
      storage_location: location.trim() || null,
      shelf_life_days: shelfLife ? Number(shelfLife) : null,
      photo_url: photoUrl.trim() || null,
      active,
    };
    const { error } = ingredient
      ? await supabase.from('ingredients').update(row).eq('id', ingredient.id)
      : await supabase.from('ingredients').insert(row);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={ingredient ? `Edit ${ingredient.name}` : 'New ingredient'}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU / barcode"><input value={sku} onChange={(e) => setSku(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
          <Field label="Category">
            <select value={catId} onChange={(e) => setCatId(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm">
              <option value="">—</option>
              {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Stock unit">
            <select value={unit} onChange={(e) => setUnit(e.target.value as StockUnitCast)} className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm">
              {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Purchase unit"><input value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} placeholder="sack, carton…" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
          <Field label="1 purch. unit =">
            <input value={conversion} onChange={(e) => setConversion(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" />
          </Field>
        </div>
        <div className="text-xs text-ink-400">e.g. 1 sack = 25 kg, 1 carton = 12 pcs. Purchases are converted to stock units automatically.</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Cost per ${unit} (IDR)`}><input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
          <Field label="Default supplier">
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm">
              <option value="">—</option>
              {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Min level (reorder)"><input value={minLevel} onChange={(e) => setMinLevel(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
          <Field label="Par level (target)"><input value={parLevel} onChange={(e) => setParLevel(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
          <Field label="Storage location"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Walk-in, shelf B…" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Shelf life (days)"><input value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} inputMode="numeric" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
          <Field label="Photo URL"><input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none col-span-2" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-saffron-600" />
          Active (shown in lists and counts)
        </label>
        {err && <div className="text-sm text-rose2-400">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

type StockUnitCast = Ingredient['stock_unit'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-400 block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

// ================= Recipes =================
function Recipes({ state, canEdit }: { state: InventoryState; canEdit: boolean }) {
  const [menuItems, setMenuItems] = useState<{ id: string; name: string; price_minor: number; hasRecipe: boolean }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('menu_items').select('id, name, price_minor').eq('outlet_id', state.ingredients[0]?.outlet_id ?? '').order('name')
      .then(async ({ data }) => {
        const items = (data as { id: string; name: string; price_minor: number }[]) ?? [];
        const { data: recips } = await supabase.from('recipes').select('menu_item_id').eq('outlet_id', state.ingredients[0]?.outlet_id ?? '');
        const set = new Set(((recips as { menu_item_id: string }[]) ?? []).map((r) => r.menu_item_id));
        setMenuItems(items.map((m) => ({ ...m, hasRecipe: set.has(m.id) })));
      });
  }, [state.ingredients]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 text-sm text-ink-300">
        Recipes link menu items to ingredients. When the kitchen accepts an order item, stock is deducted automatically. Menu items without a recipe are flagged so you can fill them in over time.
      </div>
      {menuItems.length === 0 ? (
        <EmptyState icon={<FileText size={40} />} title="No menu items" hint="Add menu items in Admin first, then link recipes here." />
      ) : (
        <div className="rounded-2xl border border-ink-600 bg-ink-800 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b border-ink-700 text-ink-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Menu item</th>
                <th className="text-right px-4 py-3 font-medium">Price</th>
                <th className="text-right px-4 py-3 font-medium">Cost / portion</th>
                <th className="text-right px-4 py-3 font-medium">Food cost %</th>
                <th className="text-left px-4 py-3 font-medium">Recipe</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {menuItems.map((m) => (
                <tr key={m.id} className="border-b border-ink-700/50 last:border-0 hover:bg-ink-700/30">
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3 text-right">{formatIDR(m.price_minor)}</td>
                  <td className="px-4 py-3 text-right text-ink-300">—</td>
                  <td className="px-4 py-3 text-right text-ink-300">—</td>
                  <td className="px-4 py-3">
                    {m.hasRecipe
                      ? <span className="text-emerald2-400 text-xs font-medium">Recipe set</span>
                      : <span className="text-amber2-400 text-xs font-medium">No recipe</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && <Button variant="secondary" onClick={() => setEditing(m.id)}>{m.hasRecipe ? 'Edit' : 'Add recipe'}</Button>}
                  </td>
                  <RecipeRowExtra state={state} menuItemId={m.id} hasRecipe={m.hasRecipe} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <RecipeEditor
          menuItemId={editing}
          outletId={state.ingredients[0]?.outlet_id ?? ''}
          tenantId={state.ingredients[0]?.tenant_id ?? ''}
          ingredients={state.ingredients}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); window.location.reload(); }}
        />
      )}
    </div>
  );
}

// Placeholder component to compute per-recipe costs inline — replaced below.
function RecipeRowExtra(_props: { state: InventoryState; menuItemId: string; hasRecipe: boolean }) {
  return null;
}

function RecipeEditor({ menuItemId, outletId, tenantId, ingredients, onClose, onSaved }: {
  menuItemId: string;
  outletId: string;
  tenantId: string;
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [yieldPct, setYieldPct] = useState('100');
  const [rows, setRows] = useState<{ ingredient_id: string; qty: string; sub_recipe_id: string | null }[]>([{ ingredient_id: '', qty: '', sub_recipe_id: null }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('recipes').select('id, yield_pct').eq('menu_item_id', menuItemId).maybeSingle()
      .then(async ({ data }) => {
        if (!data) return;
        setYieldPct(String((data as { yield_pct: number }).yield_pct));
        const { data: ritems } = await supabase.from('recipe_items').select('*').eq('recipe_id', (data as { id: string }).id);
        setRows(((ritems as { ingredient_id: string; qty: number; sub_recipe_id: string | null }[]) ?? []).map((r) => ({
          ingredient_id: r.ingredient_id, qty: String(r.qty), sub_recipe_id: r.sub_recipe_id,
        })));
        if (((ritems as unknown[]) ?? []).length === 0) setRows([{ ingredient_id: '', qty: '', sub_recipe_id: null }]);
      });
  }, [menuItemId]);

  const save = async () => {
    setBusy(true);
    const valid = rows.filter((r) => r.ingredient_id && Number(r.qty) > 0);
    const { data: rec, error: e1 } = await supabase.from('recipes').upsert({
      tenant_id: tenantId, outlet_id: outletId, menu_item_id: menuItemId, yield_pct: Number(yieldPct) || 100,
    }, { onConflict: 'menu_item_id' }).select('id').maybeSingle();
    if (e1 || !rec) { setErr(e1?.message ?? 'Could not save'); setBusy(false); return; }
    const { error: e2 } = await supabase.from('recipe_items').delete().eq('recipe_id', rec.id);
    if (e2) { setErr(e2.message); setBusy(false); return; }
    if (valid.length > 0) {
      const { error: e3 } = await supabase.from('recipe_items').insert(valid.map((r) => ({
        recipe_id: rec.id,
        tenant_id: tenantId,
        ingredient_id: r.ingredient_id,
        sub_recipe_id: r.sub_recipe_id,
        qty: Number(r.qty),
      })));
      if (e3) { setErr(e3.message); setBusy(false); return; }
    }
    setBusy(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Recipe">
      <div className="space-y-4">
        <Field label="Yield % (usable after trim loss)"><input value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
        {rows.map((r, idx) => (
          <div key={idx} className="flex gap-2 items-end">
            <div className="flex-1">
              <Field label={idx === 0 ? 'Ingredient (or prep item)' : ''}>
                <select
                  value={r.ingredient_id}
                  onChange={(e) => setRows((s) => s.map((x, i) => i === idx ? { ...x, ingredient_id: e.target.value } : x))}
                  className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm"
                >
                  <option value="">—</option>
                  {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name} ({ing.stock_unit})</option>)}
                </select>
              </Field>
            </div>
            <div className="w-28">
              <Field label={idx === 0 ? 'Qty per portion' : ''}>
                <input
                  value={r.qty}
                  onChange={(e) => setRows((s) => s.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))}
                  inputMode="decimal"
                  className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm"
                />
              </Field>
            </div>
            <button onClick={() => setRows((s) => s.filter((_, i) => i !== idx))} className="h-10 px-2 text-ink-400 hover:text-rose2-400"><Trash2 size={15} /></button>
          </div>
        ))}
        <button onClick={() => setRows((s) => [...s, { ingredient_id: '', qty: '', sub_recipe_id: null }])} className="text-sm text-saffron-400 hover:text-saffron-300 inline-flex items-center gap-1">
          <Plus size={14} /> Add ingredient line
        </button>
        {err && <div className="text-sm text-rose2-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save recipe'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ================= Suppliers =================
function Suppliers({ state, setState, canEdit }: { state: InventoryState; setState: (s: InventoryState) => void; canEdit: boolean }) {
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);

  return (
    <div className="space-y-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => setEditing('new')}><Plus size={15} /> Add supplier</Button></div>}
      {state.suppliers.length === 0 ? (
        <EmptyState icon={<Truck size={40} />} title="No suppliers yet" hint="Add the companies you buy from to raise purchase orders." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {state.suppliers.map((s) => (
            <div key={s.id} className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display font-semibold">{s.name}</div>
                  <div className="text-xs text-ink-400 mt-0.5">{s.contact_person ?? '—'} · {s.phone ?? '—'}</div>
                  <div className="text-xs text-ink-500 mt-0.5">{s.email ?? '—'} · lead {s.lead_time_days}d · {s.payment_terms ?? 'no terms'}</div>
                </div>
                {canEdit && <button onClick={() => setEditing(s)} className="text-ink-400 hover:text-ink-100"><Pencil size={15} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <SupplierModal
          supplier={editing === 'new' ? null : editing}
          tenantId={state.ingredients[0]?.tenant_id ?? ''}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function SupplierModal({ supplier, tenantId, onClose, onSaved }: { supplier: Supplier | null; tenantId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: supplier?.name ?? '', contact_person: supplier?.contact_person ?? '', phone: supplier?.phone ?? '',
    email: supplier?.email ?? '', address: supplier?.address ?? '', payment_terms: supplier?.payment_terms ?? '',
    lead_time_days: String(supplier?.lead_time_days ?? 1), notes: supplier?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!f.name.trim()) { setErr('Name is required.'); return; }
    setBusy(true);
    const row = { tenant_id: tenantId, ...f, lead_time_days: Number(f.lead_time_days) || 1 };
    const { error } = supplier ? await supabase.from('suppliers').update(row).eq('id', supplier.id) : await supabase.from('suppliers').insert(row);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={supplier ? `Edit ${supplier.name}` : 'New supplier'}>
      <div className="space-y-3">
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person"><input value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
          <Field label="Phone / WhatsApp"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
          <Field label="Payment terms"><input value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} placeholder="Net 14" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        </div>
        <Field label="Address"><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lead time (days)"><input value={f.lead_time_days} onChange={(e) => setF({ ...f, lead_time_days: e.target.value })} inputMode="numeric" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
          <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        </div>
        {err && <div className="text-sm text-rose2-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ================= Purchase orders =================
function PurchaseOrders({ state, setState, canEdit }: { state: InventoryState; setState: (s: InventoryState) => void; canEdit: boolean }) {
  const [pos, setPos] = useState<(PurchaseOrder & { supplier_name: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);

  const outletId = state.ingredients[0]?.outlet_id ?? '';
  const tenantId = state.ingredients[0]?.tenant_id ?? '';

  useEffect(() => {
    supabase.from('purchase_orders').select('*').eq('outlet_id', outletId).order('created_at', { ascending: false })
      .then(async ({ data }) => {
        const list = (data as PurchaseOrder[]) ?? [];
        const names = new Map(state.suppliers.map((s) => [s.id, s.name]));
        setPos(list.map((p) => ({ ...p, supplier_name: names.get(p.supplier_id) ?? '—' })));
        setLoading(false);
      });
  }, [outletId, state.suppliers]);

  if (loading) return <Spinner className="h-8 w-8 mx-auto block mt-10" />;

  return (
    <div className="space-y-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus size={15} /> New purchase order</Button></div>}
      {pos.length === 0 ? (
        <EmptyState icon={<FileText size={40} />} title="No purchase orders" hint="Create a PO manually or from the suggested reorder list on the Items tab." />
      ) : (
        <div className="space-y-3">
          {pos.map((p) => (
            <div key={p.id} className="rounded-2xl border border-ink-600 bg-ink-800 p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[180px]">
                <div className="font-display font-semibold">{p.po_number}</div>
                <div className="text-xs text-ink-400">{p.supplier_name} · {new Date(p.created_at).toLocaleDateString()}</div>
              </div>
              <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize',
                p.status === 'received' ? 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30'
                : p.status === 'draft' ? 'bg-ink-600 text-ink-300 border-ink-500'
                : p.status === 'cancelled' ? 'bg-rose2-500/15 text-rose2-400 border-rose2-500/30'
                : 'bg-saffron-500/15 text-saffron-400 border-saffron-500/30')}>
                {p.status.replace('_', ' ')}
              </span>
              {canEdit && p.status === 'sent' && (
                <Button variant="secondary" onClick={() => setReceiving(p.id)}>Receive</Button>
              )}
            </div>
          ))}
        </div>
      )}
      {creating && (
        <PoEditor
          tenantId={tenantId}
          outletId={outletId}
          suppliers={state.suppliers}
          ingredients={state.ingredients}
          stockLevels={state.stockLevels}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); window.location.reload(); }}
        />
      )}
      {receiving && (
        <ReceiveModal
          poId={receiving}
          tenantId={tenantId}
          outletId={outletId}
          onClose={() => setReceiving(null)}
          onSaved={() => { setReceiving(null); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function PoEditor({ tenantId, outletId, suppliers, ingredients, stockLevels, onClose, onSaved }: {
  tenantId: string; outletId: string;
  suppliers: Supplier[]; ingredients: Ingredient[]; stockLevels: Map<string, StockLevel>;
  onClose: () => void; onSaved: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [lines, setLines] = useState<{ ingredient_id: string; qty: string; unit_cost: string }[]>([{ ingredient_id: '', qty: '', unit_cost: '' }]);

  const save = async (markSent: boolean) => {
    const valid = lines.filter((l) => l.ingredient_id && Number(l.qty) > 0);
    if (!supplierId || valid.length === 0) return;
    const { data: seq } = await supabase.rpc('inv_next_po_number', { p_tenant: tenantId });
    const { data: po, error } = await supabase.from('purchase_orders').insert({
      tenant_id: tenantId, outlet_id: outletId, supplier_id: supplierId,
      po_number: (seq as string) ?? `PO-${Date.now()}`,
      status: markSent ? 'sent' : 'draft',
    }).select('id').maybeSingle();
    if (error || !po) return;
    await supabase.from('purchase_order_items').insert(valid.map((l) => ({
      po_id: po.id, tenant_id: tenantId, ingredient_id: l.ingredient_id,
      qty_ordered: Number(l.qty), unit_cost_minor: Math.round(Number(l.unit_cost) * 100) || 0,
    })));
    onSaved();
  };

  const suggest = ingredients.filter((i) => {
    const q = stockLevels.get(i.id)?.qty ?? 0;
    return i.active && q <= i.min_level;
  });

  return (
    <Modal open onClose={onClose} title="New purchase order" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <Field label="Supplier">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm">
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {suggest.length > 0 && (
          <div className="rounded-xl border border-amber2-500/30 bg-amber2-500/10 p-3 text-sm">
            <div className="font-medium text-amber2-300 mb-1.5">Suggested reorder (below minimum)</div>
            <div className="flex flex-wrap gap-2">
              {suggest.map((i) => (
                <button
                  key={i.id}
                  onClick={() => setLines((s) => {
                    if (s.some((l) => l.ingredient_id === i.id)) return s;
                    const upTo = Math.max(i.par_level - (stockLevels.get(i.id)?.qty ?? 0), 0);
                    return [...s, { ingredient_id: i.id, qty: String(Math.max(upTo, 1)), unit_cost: String(i.cost_per_stock_unit_minor / 100) }];
                  })}
                  className="rounded-lg border border-amber2-500/40 px-2.5 py-1 text-xs text-amber2-300 hover:bg-amber2-500/20"
                >
                  + {i.name} (to par)
                </button>
              ))}
            </div>
          </div>
        )}
        {lines.map((l, idx) => (
          <div key={idx} className="flex gap-2 items-end">
            <div className="flex-1">
              <Field label={idx === 0 ? 'Ingredient' : ''}>
                <select value={l.ingredient_id} onChange={(e) => setLines((s) => s.map((x, i) => i === idx ? { ...x, ingredient_id: e.target.value } : x))} className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm">
                  <option value="">—</option>
                  {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="w-24"><Field label={idx === 0 ? 'Qty' : ''}><input value={l.qty} onChange={(e) => setLines((s) => s.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))} inputMode="decimal" className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field></div>
            <div className="w-28"><Field label={idx === 0 ? 'Unit cost' : ''}><input value={l.unit_cost} onChange={(e) => setLines((s) => s.map((x, i) => i === idx ? { ...x, unit_cost: e.target.value } : x))} inputMode="decimal" className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field></div>
            <button onClick={() => setLines((s) => s.filter((_, i) => i !== idx))} className="h-10 px-2 text-ink-400 hover:text-rose2-400"><Trash2 size={15} /></button>
          </div>
        ))}
        <button onClick={() => setLines((s) => [...s, { ingredient_id: '', qty: '', unit_cost: '' }])} className="text-sm text-saffron-400 inline-flex items-center gap-1"><Plus size={14} /> Add line</button>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => save(false)}>Save draft</Button>
          <Button onClick={() => save(true)}>Save & mark sent</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReceiveModal({ poId, tenantId, outletId, onClose, onSaved }: {
  poId: string; tenantId: string; outletId: string; onClose: () => void; onSaved: () => void;
}) {
  const [items, setItems] = useState<(PurchaseOrderItem & { name: string })[]>([]);
  const [invoice, setInvoice] = useState('');
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('purchase_order_items').select('*, ingredients(name)').eq('po_id', poId)
      .then(({ data }) => setItems(((data as unknown as (PurchaseOrderItem & { ingredients: { name: string } })[]) ?? []).map((x) => ({ ...x, name: x.ingredients?.name ?? '' }))));
  }, [poId]);

  const submit = async () => {
    setBusy(true);
    const { data: gr, error: e1 } = await supabase.from('goods_receipts').insert({
      tenant_id: tenantId, outlet_id: outletId, po_id: poId, invoice_number: invoice.trim() || null, paid,
    }).select('id').maybeSingle();
    if (e1 || !gr) { setErr(e1?.message ?? 'Failed'); setBusy(false); return; }
    const rows = items.filter((i) => Number(i.qty_received) > 0).map((i) => ({
      receipt_id: gr.id, tenant_id: tenantId, ingredient_id: i.ingredient_id,
      qty: Number(i.qty_received), unit_cost_minor: i.unit_cost_minor,
    }));
    if (rows.length > 0) {
      const { error: e2 } = await supabase.from('goods_receipt_items').insert(rows);
      if (e2) { setErr(e2.message); setBusy(false); return; }
    }
    const { error: e3 } = await supabase.rpc('inv_post_goods_receipt', { p_receipt: gr.id });
    setBusy(false);
    if (e3) { setErr(e3.message); return; }
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Receive goods" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <Field label="Invoice number (optional)"><input value={invoice} onChange={(e) => setInvoice(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        {items.map((i, idx) => (
          <div key={i.id} className="flex gap-2 items-end">
            <div className="flex-1 text-sm pt-1">{i.name} <span className="text-ink-400 text-xs">ordered {formatQty(i.qty_ordered)}</span></div>
            <div className="w-28">
              <Field label={idx === 0 ? 'Receive qty' : ''}>
                <input
                  value={String(i.qty_received)}
                  onChange={(e) => setItems((s) => s.map((x, j) => j === idx ? { ...x, qty_received: Number(e.target.value) || 0 } : x))}
                  inputMode="decimal"
                  className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm"
                />
              </Field>
            </div>
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="accent-saffron-600" /> Invoice paid</label>
        {err && <div className="text-sm text-rose2-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Spinner /> : 'Receive & post'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ================= Counts =================
function Counts({ state, setState, canEdit }: { state: InventoryState; setState: (s: InventoryState) => void; canEdit: boolean }) {
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const outletId = state.ingredients[0]?.outlet_id ?? '';
  const tenantId = state.ingredients[0]?.tenant_id ?? '';
  const isManager = canEdit;

  useEffect(() => {
    supabase.from('stock_counts').select('*').eq('outlet_id', outletId).order('created_at', { ascending: false })
      .then(({ data }) => setCounts((data as StockCount[]) ?? []));
  }, [outletId]);

  const startCount = async () => {
    const { data, error } = await supabase.from('stock_counts').insert({
      tenant_id: tenantId, outlet_id: outletId, label: 'Stock count ' + new Date().toLocaleDateString(),
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    }).select('id').maybeSingle();
    if (!error && data) {
      const ing = state.ingredients.filter((i) => i.active);
      if (ing.length > 0) {
        await supabase.from('stock_count_items').insert(ing.map((i) => ({
          count_id: data.id, tenant_id: tenantId, ingredient_id: i.id,
          expected_qty: state.stockLevels.get(i.id)?.qty ?? 0,
        })));
      }
      setActive(data.id);
      window.location.hash = '';
      window.location.reload();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button onClick={startCount}><Plus size={15} /> Start count</Button>
      </div>
      {counts.length === 0 ? (
        <EmptyState icon={<ClipboardCheck size={40} />} title="No counts yet" hint="Run a count to reconcile what the system expects with what is actually on the shelf." />
      ) : (
        <div className="space-y-3">
          {counts.map((c) => (
            <div key={c.id} className="rounded-2xl border border-ink-600 bg-ink-800 p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[160px]">
                <div className="font-display font-semibold">{c.label}</div>
                <div className="text-xs text-ink-400">{new Date(c.created_at).toLocaleString()}</div>
              </div>
              <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize',
                c.status === 'approved' ? 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30'
                : c.status === 'open' ? 'bg-saffron-500/15 text-saffron-400 border-saffron-500/30'
                : 'bg-rose2-500/15 text-rose2-400 border-rose2-500/30')}>
                {c.status}
              </span>
              {c.status === 'open' && <Button variant="secondary" onClick={() => setActive(c.id)}>Enter counts</Button>}
            </div>
          ))}
        </div>
      )}
      {active && (
        <CountEntryModal
          countId={active}
          canApprove={isManager}
          onClose={() => setActive(null)}
          onSaved={() => { setActive(null); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function CountEntryModal({ countId, canApprove, onClose, onSaved }: { countId: string; canApprove: boolean; onClose: () => void; onSaved: () => void }) {
  const [items, setItems] = useState<(StockCountItem & { name: string; unit: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('stock_count_items').select('*, ingredients(name, stock_unit)').eq('count_id', countId)
      .then(({ data }) => setItems(((data as unknown as (StockCountItem & { ingredients: { name: string; stock_unit: string } })[]) ?? []).map((x) => ({
        ...x, name: x.ingredients?.name ?? '', unit: x.ingredients?.stock_unit ?? '',
      }))));
  }, [countId]);

  const varianceValue = (i: StockCountItem) => {
    const d = (i.counted_qty ?? i.expected_qty) - i.expected_qty;
    return d;
  };

  const hasLargeVariance = items.some((i) => {
    const d = Math.abs(varianceValue(i));
    return d > 0 && i.expected_qty > 0 && (d / i.expected_qty) * 100 > 5;
  });

  return (
    <Modal open onClose={onClose} title="Enter counted quantities" maxWidth="max-w-2xl">
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        {items.map((i, idx) => {
          const d = varianceValue(i);
          return (
            <div key={i.id} className="flex gap-2 items-center rounded-xl bg-ink-700/50 p-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{i.name}</div>
                <div className="text-xs text-ink-400">Expected {formatQty(i.expected_qty)} {i.unit}</div>
              </div>
              <input
                value={i.counted_qty == null ? '' : String(i.counted_qty)}
                onChange={(e) => setItems((s) => s.map((x, j) => j === idx ? { ...x, counted_qty: e.target.value === '' ? null : Number(e.target.value) } : x))}
                inputMode="decimal"
                placeholder="Counted"
                className="w-24 h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm text-right font-mono"
              />
              <div className={cn('w-20 text-right text-xs font-mono', d < 0 ? 'text-rose2-400' : d > 0 ? 'text-emerald2-400' : 'text-ink-500')}>
                {d === 0 ? '' : (d > 0 ? '+' : '') + formatQty(d)}
              </div>
            </div>
          );
        })}
        {hasLargeVariance && (
          <div className="rounded-xl border border-amber2-500/40 bg-amber2-500/10 px-3 py-2 text-xs text-amber2-300">
            Variance above 5% needs manager approval before posting.
          </div>
        )}
        {err && <div className="text-sm text-rose2-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button
            onClick={async () => {
              setBusy(true);
              for (const i of items) {
                if (i.counted_qty != null) {
                  await supabase.from('stock_count_items').update({ counted_qty: i.counted_qty }).eq('id', i.id);
                }
              }
              if (canApprove) {
                const r = await approveCount(countId);
                if (!r.ok) { setErr(r.error ?? 'Failed'); setBusy(false); return; }
              }
              setBusy(false);
              onSaved();
            }}
            disabled={busy}
          >
            {busy ? <Spinner /> : canApprove ? 'Save & approve' : 'Save counts'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ================= Waste =================
function Waste({ state, setState: _setState }: { state: InventoryState; setState: (s: InventoryState) => void }) {
  const [logs, setLogs] = useState<(WasteLog & { name: string })[]>([]);
  const [logging, setLogging] = useState(false);
  const outletId = state.ingredients[0]?.outlet_id ?? '';
  const tenantId = state.ingredients[0]?.tenant_id ?? '';

  useEffect(() => {
    supabase.from('waste_logs').select('*, ingredients(name)').eq('outlet_id', outletId).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setLogs(((data as unknown as (WasteLog & { ingredients: { name: string } | null })[]) ?? []).map((x) => ({ ...x, name: x.ingredients?.name ?? '(menu item)' }))));
  }, [outletId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setLogging(true)}><Plus size={15} /> Log waste</Button></div>
      {logs.length === 0 ? (
        <EmptyState icon={<Trash2 size={40} />} title="No waste logged" hint="Quick-log spoilage, drops, staff meals and comps from the storeroom." />
      ) : (
        <div className="space-y-2">
          {logs.map((l) => (
            <div key={l.id} className="rounded-xl border border-ink-600 bg-ink-800 p-3.5 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[160px]">
                <div className="text-sm font-medium">{l.name}</div>
                <div className="text-xs text-ink-400 capitalize">{l.reason.replace('_', ' ')} · {new Date(l.created_at).toLocaleString()}</div>
              </div>
              <div className="font-mono text-sm">{formatQty(l.qty)}</div>
              {l.note && <div className="text-xs text-ink-400 italic">"{l.note}"</div>}
            </div>
          ))}
        </div>
      )}
      {logging && (
        <WasteModal
          tenantId={tenantId}
          outletId={outletId}
          ingredients={state.ingredients}
          onClose={() => setLogging(false)}
          onSaved={() => { setLogging(false); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function WasteModal({ tenantId, outletId, ingredients, onClose, onSaved }: {
  tenantId: string; outletId: string; ingredients: Ingredient[]; onClose: () => void; onSaved: () => void;
}) {
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<WasteReason>('spoiled');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal open onClose={onClose} title="Log waste">
      <div className="space-y-4">
        <Field label="Ingredient">
          <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm">
            {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.stock_unit})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity"><input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value as WasteReason)} className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm capitalize">
              {WASTE_REASONS.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        {err && <div className="text-sm text-rose2-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              setBusy(true);
              const r = await logWaste({ tenantId, outletId, ingredientId, menuItemId: null, qty: Number(qty), reason, note });
              setBusy(false);
              if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
              onSaved();
            }}
            disabled={busy || !qty || Number(qty) <= 0}
          >
            {busy ? <Spinner /> : 'Log waste'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ================= Transfers =================
function Transfers({ state, setState: _setState, canEdit }: { state: InventoryState; setState: (s: InventoryState) => void; canEdit: boolean }) {
  const outletId = state.ingredients[0]?.outlet_id ?? '';
  const tenantId = state.ingredients[0]?.tenant_id ?? '';
  const [list, setList] = useState<(Transfer & { from_name: string; to_name: string })[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.from('transfers').select('*, from:outlets!transfers_from_outlet_id_fkey(name), to:outlets!transfers_to_outlet_id_fkey(name)').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setList(((data as unknown as (Transfer & { from: { name: string }; to: { name: string } })[]) ?? []).map((t) => ({ ...t, from_name: t.from?.name ?? '', to_name: t.to?.name ?? '' }))));
  }, [tenantId]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-4 text-sm text-ink-300">
        Move stock between outlets. Available on the Chain plan — both outlets must belong to the same restaurant group.
      </div>
      {canEdit && <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus size={15} /> New transfer</Button></div>}
      {list.length === 0 ? (
        <EmptyState icon={<Truck size={40} />} title="No transfers" hint="Request a transfer when one outlet runs low and another has surplus." />
      ) : (
        <div className="space-y-2">
          {list.map((t) => (
            <div key={t.id} className="rounded-xl border border-ink-600 bg-ink-800 p-3.5 flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium">{t.from_name} → {t.to_name}</div>
                <div className="text-xs text-ink-400">{new Date(t.created_at).toLocaleString()}</div>
              </div>
              <span className="text-xs capitalize text-ink-300">{t.status.replace('_', ' ')}</span>
              {canEdit && t.status === 'requested' && <Button variant="secondary" onClick={async () => { await transferSend(t.id); window.location.reload(); }}>Send</Button>}
              {canEdit && t.status === 'in_transit' && <Button variant="secondary" onClick={async () => { await transferReceive(t.id); window.location.reload(); }}>Receive</Button>}
            </div>
          ))}
        </div>
      )}
      {creating && (
        <TransferModal
          tenantId={tenantId}
          currentOutletId={outletId}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function TransferModal({ tenantId, currentOutletId, onClose, onSaved }: { tenantId: string; currentOutletId: string; onClose: () => void; onSaved: () => void }) {
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [from, setFrom] = useState(currentOutletId);
  const [to, setTo] = useState('');
  const [ingredientId, setIngredientId] = useState('');
  const [qty, setQty] = useState('');
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('outlets').select('id, name').then(({ data }) => setOutlets((data as { id: string; name: string }[]) ?? []));
    supabase.from('ingredients').select('*').eq('outlet_id', currentOutletId).then(({ data }) => setIngredients((data as Ingredient[]) ?? []));
  }, [currentOutletId]);

  return (
    <Modal open onClose={onClose} title="New transfer">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From outlet">
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm">
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="To outlet">
            <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm">
              <option value="">—</option>
              {outlets.filter((o) => o.id !== from).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Ingredient">
          <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm">
            <option value="">—</option>
            {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        <Field label="Quantity"><input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        {err && <div className="text-sm text-rose2-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!to || !ingredientId || !Number(qty)) return;
              const { data, error } = await supabase.from('transfers').insert({
                tenant_id: tenantId, from_outlet_id: from, to_outlet_id: to,
              }).select('id').maybeSingle();
              if (error || !data) { setErr(error?.message ?? 'Failed'); return; }
              await supabase.from('transfer_items').insert({ transfer_id: data.id, tenant_id: tenantId, ingredient_id: ingredientId, qty: Number(qty) });
              onSaved();
            }}
          >
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ================= Reports =================
function Reports({ state }: { state: InventoryState }) {
  const low = state.ingredients.filter((i) => stockStatus(i, state.stockLevels.get(i.id)?.qty) !== 'ok');
  const deadStock = state.ingredients.filter((i) => i.active);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
        <h2 className="font-display font-semibold mb-2">Current stock value</h2>
        <div className="font-display text-3xl font-bold text-saffron-400">{formatIDR(stockValue(state.stockLevels))}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
          <h3 className="font-display font-semibold mb-2 flex items-center gap-2"><AlertTriangle size={16} className="text-amber2-400" /> Low / out of stock</h3>
          {low.length === 0 ? <div className="text-sm text-ink-400">Everything is above minimum levels.</div> : (
            <ul className="text-sm space-y-1.5">
              {low.map((i) => (
                <li key={i.id} className="flex justify-between">
                  <span>{i.name}</span>
                  <span className="font-mono text-ink-300">{formatQty(state.stockLevels.get(i.id)?.qty)} {i.stock_unit}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
          <h3 className="font-display font-semibold mb-2 flex items-center gap-2"><TrendingDown size={16} className="text-rose2-400" /> Dead stock watchlist</h3>
          <div className="text-sm text-ink-400">Ingredients with no movement in the last 30 days appear here as usage data accumulates.</div>
        </div>
      </div>
    </div>
  );
}

// ================= Settings =================
function SettingsTab({ state, setState: _setState, canEdit }: { state: InventoryState; setState: (s: InventoryState) => void; canEdit: boolean }) {
  const s = state.settings;
  const outletId = state.ingredients[0]?.outlet_id ?? '';
  const tenantId = state.ingredients[0]?.tenant_id ?? '';
  const [allowNeg, setAllowNeg] = useState(s?.allow_negative_stock ?? true);
  const [autoSoldOut, setAutoSoldOut] = useState(s?.auto_sold_out_enabled ?? true);
  const [threshold, setThreshold] = useState(String(s?.auto_sold_out_threshold ?? 0));
  const [foodTarget, setFoodTarget] = useState(String(s?.food_cost_target_pct ?? 35));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    const row = {
      tenant_id: tenantId, outlet_id: outletId,
      allow_negative_stock: allowNeg, auto_sold_out_enabled: autoSoldOut,
      auto_sold_out_threshold: Number(threshold) || 0,
      food_cost_target_pct: Number(foodTarget) || 35,
    };
    const { error } = await supabase.from('inventory_settings').upsert(row, { onConflict: 'outlet_id' });
    setBusy(false);
    setMsg(error ? error.message : 'Saved.');
  };

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 space-y-4">
        <Toggle label="Allow negative stock" desc="Keep service running even when stock would go below zero. Turn off to block orders of sold-out items." value={allowNeg} onChange={setAllowNeg} />
        <Toggle label="Auto sold-out" desc="Hide menu items automatically when a required ingredient reaches the threshold." value={autoSoldOut} onChange={setAutoSoldOut} />
        <Field label="Sold-out threshold"><input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        <Field label="Food cost target %"><input value={foodTarget} onChange={(e) => setFoodTarget(e.target.value)} inputMode="decimal" className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" /></Field>
        {canEdit && <Button onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save settings'}</Button>}
        {msg && <div className="text-sm text-emerald2-400">{msg}</div>}
      </div>
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
        <h3 className="font-display font-semibold mb-2">Categories</h3>
        <CategoryManager tenantId={tenantId} categories={state.categories} />
      </div>
    </div>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-saffron-600" />
      <span>
        <span className="text-sm font-medium block">{label}</span>
        <span className="text-xs text-ink-400">{desc}</span>
      </span>
    </label>
  );
}

function CategoryManager({ tenantId, categories }: { tenantId: string; categories: IngredientCategory[] }) {
  const [name, setName] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => <span key={c.id} className="rounded-full bg-ink-700 border border-ink-500 px-3 py-1 text-sm">{c.name}</span>)}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await supabase.from('ingredient_categories').insert({ tenant_id: tenantId, name: name.trim() });
          setName('');
          window.location.reload();
        }}
        className="flex gap-2"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" className="flex-1 h-9 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm" />
        <Button variant="secondary" type="submit">Add</Button>
      </form>
    </div>
  );
}
