// Inventory module: types + shared helpers.
// All data lives per tenant + outlet; RLS enforces isolation server-side.

import { supabase } from '@/lib/supabase';

export type StockUnit = 'kg' | 'g' | 'l' | 'ml' | 'pcs' | 'pack' | 'bottle';

export const STOCK_UNITS: StockUnit[] = ['kg', 'g', 'l', 'ml', 'pcs', 'pack', 'bottle'];

export const DEFAULT_CATEGORIES = [
  'Produce', 'Meat', 'Dairy', 'Dry goods', 'Beverage', 'Packaging',
];

export const WASTE_REASONS = [
  'expired', 'spoiled', 'dropped', 'over_prep', 'staff_meal', 'comp', 'other',
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

export interface Ingredient {
  id: string;
  tenant_id: string;
  outlet_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  stock_unit: StockUnit;
  purchase_unit: string;
  purchase_conversion: number;
  default_supplier_id: string | null;
  cost_per_stock_unit_minor: number;
  min_level: number;
  par_level: number;
  storage_location: string | null;
  shelf_life_days: number | null;
  active: boolean;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngredientCategory {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
}

export interface Supplier {
  id: string;
  tenant_id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  lead_time_days: number;
  notes: string | null;
  created_at: string;
}

export interface Recipe {
  id: string;
  tenant_id: string;
  outlet_id: string;
  menu_item_id: string;
  yield_pct: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeItem {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  sub_recipe_id: string | null;
  qty: number;
}

export interface StockLevel {
  id: string;
  tenant_id: string;
  outlet_id: string;
  ingredient_id: string;
  qty: number;
  avg_cost_minor: number;
  updated_at: string;
}

export type MovementType =
  | 'purchase' | 'sale' | 'waste' | 'spoilage' | 'adjustment'
  | 'count_correction' | 'transfer_in' | 'transfer_out' | 'production'
  | 'return_to_supplier' | 'sale_reversal';

export interface StockMovement {
  id: string;
  tenant_id: string;
  outlet_id: string;
  ingredient_id: string;
  type: MovementType;
  qty_delta: number;
  unit_cost_minor: number;
  ref_type: string | null;
  ref_id: string | null;
  user_id: string | null;
  note: string | null;
  created_at: string;
}

export type PoStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  outlet_id: string;
  po_number: string;
  supplier_id: string;
  status: PoStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  po_id: string;
  ingredient_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost_minor: number;
}

export interface GoodsReceipt {
  id: string;
  tenant_id: string;
  outlet_id: string;
  po_id: string | null;
  supplier_id: string | null;
  invoice_number: string | null;
  invoice_photo_url: string | null;
  paid: boolean;
  posted: boolean;
  received_by: string | null;
  created_at: string;
}

export interface GoodsReceiptItem {
  id: string;
  receipt_id: string;
  ingredient_id: string;
  qty: number;
  unit_cost_minor: number;
  expiry_date: string | null;
  batch: string | null;
}

export interface StockCount {
  id: string;
  tenant_id: string;
  outlet_id: string;
  label: string;
  status: 'open' | 'approved' | 'cancelled';
  approval_threshold_pct: number;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface StockCountItem {
  id: string;
  count_id: string;
  ingredient_id: string;
  expected_qty: number;
  counted_qty: number | null;
}

export interface WasteLog {
  id: string;
  tenant_id: string;
  outlet_id: string;
  ingredient_id: string | null;
  menu_item_id: string | null;
  qty: number;
  reason: WasteReason;
  photo_url: string | null;
  note: string | null;
  user_id: string | null;
  created_at: string;
}

export interface Transfer {
  id: string;
  tenant_id: string;
  from_outlet_id: string;
  to_outlet_id: string;
  status: 'requested' | 'in_transit' | 'received' | 'cancelled';
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TransferItem {
  id: string;
  transfer_id: string;
  ingredient_id: string;
  qty: number;
}

export interface Batch {
  id: string;
  tenant_id: string;
  outlet_id: string;
  ingredient_id: string;
  batch: string | null;
  expiry_date: string | null;
  qty_remaining: number;
  created_at: string;
}

export interface InventorySettings {
  id: string;
  tenant_id: string;
  outlet_id: string;
  allow_negative_stock: boolean;
  deduction_timing: 'on_accept' | 'on_serve';
  auto_sold_out_enabled: boolean;
  auto_sold_out_threshold: number;
  food_cost_target_pct: number;
  count_approval_threshold_pct: number;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  tenant_id: string;
  actor: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface InventoryState {
  ingredients: Ingredient[];
  categories: IngredientCategory[];
  suppliers: Supplier[];
  stockLevels: Map<string, StockLevel>; // key: ingredient_id
  recipeCount: number;
  menuTotal: number;
  settings: InventorySettings | null;
  error: string | null;
}

export function stockStatus(ing: Ingredient, qty: number | undefined): 'ok' | 'low' | 'out' {
  if (qty === undefined) return 'out';
  if (qty <= 0) return 'out';
  if (qty <= ing.min_level) return 'low';
  return 'ok';
}

export const STATUS_LABEL = { ok: 'OK', low: 'Low', out: 'Out' } as const;

export const STATUS_STYLE: Record<'ok' | 'low' | 'out', string> = {
  ok: 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30',
  low: 'bg-amber2-500/15 text-amber2-400 border-amber2-500/30',
  out: 'bg-rose2-500/15 text-rose2-400 border-rose2-500/30',
};

export function formatQty(q: number | null | undefined): string {
  if (q === null || q === undefined) return '—';
  const r = Math.round(q * 1000) / 1000;
  return String(r);
}

export function stockValue(levels: Map<string, StockLevel>): number {
  let v = 0;
  for (const l of levels.values()) v += l.qty * l.avg_cost_minor;
  return Math.round(v);
}

// ---------- loaders ----------

export async function loadInventoryCore(tenantId: string, outletId: string): Promise<InventoryState> {
  const [ing, cats, sup, levels, recipes, menu, settings] = await Promise.all([
    supabase.from('ingredients').select('*').eq('outlet_id', outletId).order('name'),
    supabase.from('ingredient_categories').select('*').eq('tenant_id', tenantId).order('sort_order'),
    supabase.from('suppliers').select('*').eq('tenant_id', tenantId).order('name'),
    supabase.from('stock_levels').select('*').eq('outlet_id', outletId),
    supabase.from('recipes').select('id', { count: 'exact' }).eq('outlet_id', outletId),
    supabase.from('menu_items').select('id', { count: 'exact' }).eq('outlet_id', outletId),
    supabase.from('inventory_settings').select('*').eq('outlet_id', outletId).maybeSingle(),
  ]);

  const err = ing.error ?? cats.error ?? sup.error ?? levels.error ?? recipes.error ?? menu.error ?? settings.error;
  if (err) return { ingredients: [], categories: [], suppliers: [], stockLevels: new Map(), recipeCount: 0, menuTotal: 0, settings: null, error: err.message };

  const map = new Map<string, StockLevel>();
  for (const l of (levels.data as StockLevel[]) ?? []) map.set(l.ingredient_id, l);

  return {
    ingredients: (ing.data as Ingredient[]) ?? [],
    categories: (cats.data as IngredientCategory[]) ?? [],
    suppliers: (sup.data as Supplier[]) ?? [],
    stockLevels: map,
    recipeCount: recipes.count ?? 0,
    menuTotal: menu.count ?? 0,
    settings: (settings.data as InventorySettings) ?? null,
    error: null,
  };
}

export async function loadMovements(ingredientId: string, limit = 50): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('ingredient_id', ingredientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data as StockMovement[]) ?? [];
}

// ---------- mutations (through SECURITY DEFINER RPCs) ----------

export async function recordPurchase(args: {
  tenantId: string; outletId: string; ingredientId: string; qty: number;
  unitCostMinor: number; note?: string | null; expiry?: string | null; batch?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('inv_record_purchase', {
    p_tenant: args.tenantId,
    p_outlet: args.outletId,
    p_ingredient: args.ingredientId,
    p_qty: args.qty,
    p_unit_cost: args.unitCostMinor,
    p_note: args.note ?? null,
    p_expiry: args.expiry ?? null,
    p_batch: args.batch ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function adjustStock(args: {
  tenantId: string; outletId: string; ingredientId: string; newQty: number; note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('inv_adjust_stock', {
    p_tenant: args.tenantId,
    p_outlet: args.outletId,
    p_ingredient: args.ingredientId,
    p_new_qty: args.newQty,
    p_note: args.note ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function logWaste(args: {
  tenantId: string; outletId: string; ingredientId: string | null; menuItemId: string | null;
  qty: number; reason: WasteReason; note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('inv_log_waste', {
    p_tenant: args.tenantId,
    p_outlet: args.outletId,
    p_ingredient: args.ingredientId,
    p_menu_item: args.menuItemId,
    p_qty: args.qty,
    p_reason: args.reason,
    p_note: args.note ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function approveCount(countId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('inv_approve_count', { p_count: countId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function postGoodsReceipt(receiptId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('inv_post_goods_receipt', { p_receipt: receiptId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function transferSend(transferId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('inv_transfer_send', { p_transfer: transferId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function transferReceive(transferId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('inv_transfer_receive', { p_transfer: transferId });
  return error ? { ok: false, error: error.message } : { ok: true };
}
