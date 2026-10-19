import { supabase } from '@/lib/supabase';
import type { MenuItem, OrderItemModifier, OrderSource } from '@/types';

export interface CartLine {
  item: MenuItem;
  quantity: number;
  modifiers: { name: string; price_delta_minor: number }[];
  notes: string;
  unitPriceMinor: number;
}

export const lineTotal = (line: CartLine): number => {
  const modSum = line.modifiers.reduce((s, m) => s + m.price_delta_minor, 0);
  return (line.unitPriceMinor + modSum) * line.quantity;
};

export const cartTotal = (lines: CartLine[]): number =>
  lines.reduce((s, l) => s + lineTotal(l), 0);

export const modifiersHaveAllergen = (item: MenuItem): boolean =>
  item.allergens.length > 0 && !item.allergens.includes('none');

interface PlaceOrderArgs {
  tenantId: string;
  outletId: string;
  tableId: string;
  sessionId?: string;
  lines: CartLine[];
  source: OrderSource;
  guestName?: string;
  notes?: string;
}

/** Staff-side order placement (waiter app). Scoped to the signed-in tenant by RLS. */
export async function placeOrder({
  tenantId,
  outletId,
  tableId,
  sessionId: _sessionId,
  lines,
  source,
  guestName,
  notes,
}: PlaceOrderArgs): Promise<{ ok: true; orderId: string; orderNumber: number } | { ok: false; error: string }> {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      table_id: tableId,
      outlet_id: outletId,
      tenant_id: tenantId,
      order_number: 0,
      type: 'dine_in',
      source,
      status: 'received',
      notes: notes ?? null,
      guest_name: guestName ?? null,
    })
    .select('id')
    .single();

  if (orderErr || !order) return { ok: false, error: 'Could not create the order. Please try again.' };

  // claim next number for this outlet (row is ours under RLS; race window is
  // acceptable for the demo scale, guest orders use the atomic RPC)
  const { data: seqRow } = await supabase
    .from('orders_seq')
    .select('next_number')
    .eq('outlet_id', outletId)
    .maybeSingle();
  const nextNumber = seqRow?.next_number ?? 1001;
  await supabase.from('orders_seq').update({ next_number: nextNumber + 1 }).eq('outlet_id', outletId);
  await supabase.from('orders').update({ order_number: nextNumber }).eq('id', order.id);

  const itemRows = lines.map((l) => {
    const mods: OrderItemModifier[] = l.modifiers.map((m) => ({
      name: m.name,
      price_delta_minor: m.price_delta_minor,
    }));
    return {
      order_id: order.id,
      outlet_id: outletId,
      tenant_id: tenantId,
      item_id: l.item.id,
      name: l.item.name,
      station: l.item.station,
      quantity: l.quantity,
      unit_price_minor: l.unitPriceMinor,
      modifiers: mods,
      notes: l.notes || null,
      status: 'received',
      allergy_alert: modifiersHaveAllergen(l.item),
    };
  });

  const { error: itemsErr } = await supabase.from('order_items').insert(itemRows);
  if (itemsErr) return { ok: false, error: 'Could not send the items. Please try again.' };

  await supabase
    .from('tables')
    .update({ status: 'occupied', updated_at: new Date().toISOString() })
    .eq('id', tableId);

  return { ok: true, orderId: order.id, orderNumber: nextNumber };
}
