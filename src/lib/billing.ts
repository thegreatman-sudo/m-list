import { supabase } from '@/lib/supabase';
import type { Bill, OrderItem, Outlet, TableSession } from '@/types';

export interface BillBreakdown {
  subtotal: number;
  discount: number;
  tax: number;
  service: number;
  tip: number;
  total: number;
}

export function computeBill(
  items: OrderItem[],
  outlet: Outlet,
  discountMinor: number = 0,
  tipMinor: number = 0
): BillBreakdown {
  const eligible = items.filter((i) => i.status !== 'voided' && i.status !== 'rejected');
  const subtotal = eligible.reduce((sum, i) => {
    const modSum = (i.modifiers ?? []).reduce((s, m) => s + m.price_delta_minor, 0);
    return sum + (i.unit_price_minor + modSum) * i.quantity;
  }, 0);
  const afterDiscount = Math.max(0, subtotal - discountMinor);
  const tax = Math.round((afterDiscount * outlet.tax_percent) / 100);
  const service = Math.round((afterDiscount * outlet.service_charge_percent) / 100);
  const total = afterDiscount + tax + service + tipMinor;
  return { subtotal, discount: discountMinor, tax, service, tip: tipMinor, total };
}

export async function ensureSessionAndBill(
  tenantId: string,
  outletId: string,
  tableId: string
): Promise<{ session: TableSession; bill: Bill } | { error: string }> {
  const { data: existing } = await supabase
    .from('table_sessions')
    .select('*')
    .eq('table_id', tableId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let session = existing as TableSession | null;

  if (!session) {
    const { data: created, error } = await supabase
      .from('table_sessions')
      .insert({
        table_id: tableId,
        outlet_id: outletId,
        tenant_id: tenantId,
        status: 'open',
        guest_count: 1,
      })
      .select('*')
      .single();
    if (error || !created) return { error: 'Could not open the table session.' };
    session = created as TableSession;
  }

  const { data: existingBill } = await supabase
    .from('bills')
    .select('*')
    .eq('session_id', session.id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let bill = existingBill as Bill | null;
  if (!bill) {
    const { data: createdBill, error: billErr } = await supabase
      .from('bills')
      .insert({
        session_id: session.id,
        table_id: tableId,
        outlet_id: outletId,
        tenant_id: tenantId,
        status: 'open',
      })
      .select('*')
      .single();
    if (billErr || !createdBill) return { error: 'Could not create the bill.' };
    bill = createdBill as Bill;
  }
  return { session, bill };
}

export async function recalcBill(
  billId: string,
  items: OrderItem[],
  outlet: Outlet,
  discountMinor: number = 0,
  tipMinor: number = 0
): Promise<void> {
  const b = computeBill(items, outlet, discountMinor, tipMinor);
  await supabase
    .from('bills')
    .update({
      subtotal_minor: b.subtotal,
      discount_minor: b.discount,
      tax_minor: b.tax,
      service_minor: b.service,
      tip_minor: b.tip,
      total_minor: b.total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', billId);
}
