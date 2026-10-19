// Guest-side API. Everything goes through SECURITY DEFINER RPCs keyed on the
// table's secret qr_token, so a guest only ever touches one tenant's data.
import { supabase } from '@/lib/supabase';
import type { Outlet } from '@/types';

export interface GuestTableInfo {
  tenant_id: string;
  outlet: Outlet;
  table: { id: string; label: string; status: string };
  session_id: string | null;
  bill_id: string | null;
}

export interface GuestMenu {
  categories: { id: string; name: string; sort_order: number }[];
  items: {
    id: string; category_id: string; name: string; description: string | null;
    price_minor: number; photo_url: string | null; station: string;
    prep_time_seconds: number; dietary_tags: string[]; allergens: string[];
    calories: number | null; available: boolean; sold_out: boolean; sort_order: number;
  }[];
  modifiers: {
    id: string; item_id: string; name: string; required: boolean;
    min_select: number; max_select: number; sort_order: number;
    options: { id: string; modifier_id: string; name: string; price_delta_minor: number; is_default: boolean; sort_order: number }[];
  }[];
}

const GENERIC = 'Something went wrong. Please try again.';
const friendly = (msg: string): string => {
  if (msg.includes('Table not found')) return 'This table code is not valid. Please ask your host for help.';
  if (msg.includes('sold out')) return 'One of the items just sold out — please review your cart.';
  if (msg.includes('No table available')) return 'That time is fully booked — try another slot.';
  if (msg.includes('Nothing to pay')) return 'Nothing to pay yet — place an order first.';
  return GENERIC;
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: friendly(error.message) };
  return { data: data as T, error: null };
}

export const guestApi = {
  getTable: (token: string) => rpc<GuestTableInfo>('guest_get_table', { p_token: token }),
  getMenu: (token: string) => rpc<GuestMenu>('guest_get_menu', { p_token: token }),
  getOrders: (token: string) => rpc<{ session_id: string | null; orders: { id: string; order_number: number; status: string; notes: string | null; guest_name: string | null; created_at: string }[]; items: { id: string; order_id: string; name: string; station: string; quantity: number; unit_price_minor: number; modifiers: { name: string; price_delta_minor: number }[]; notes: string | null; status: string; created_at: string }[] }>('guest_get_orders', { p_token: token }),
  getBill: (token: string) => rpc<{ bill: { id: string; total_minor: number } | null; session_id: string | null; items: { id: string; name: string; quantity: number; unit_price_minor: number; modifiers: { name: string; price_delta_minor: number }[]; notes: string | null; status: string }[]; tax_percent: number; service_charge_percent: number }>('guest_get_bill', { p_token: token }),

  placeOrder: (token: string, lines: { itemId: string; quantity: number; modifiers: { name: string; price_delta_minor: number }[]; notes: string }[], notes?: string, guestName?: string) =>
    rpc<{ orderId: string; orderNumber: number; sessionId: string; billId: string }>('place_order_guest', {
      p_token: token, p_lines: lines, p_notes: notes ?? null, p_guest_name: guestName ?? null,
    }),

  callWaiter: (token: string, reason: string, detail?: string) =>
    rpc<string>('guest_call_waiter', { p_token: token, p_reason: reason, p_detail: detail ?? null }),

  payBill: (token: string, method: 'qris' | 'card' | 'cash', tipMinor: number, providerRef?: string) =>
    rpc<{ total: number }>('guest_pay_bill', {
      p_token: token, p_method: method, p_tip_minor: tipMinor, p_provider_ref: providerRef ?? null,
    }),

  bookTable: (token: string, booking: {
    name: string; phone: string; partySize: number; date: string; time: string; areaPref: string; notes: string;
  }) =>
    rpc<string>('guest_book_table', {
      p_token: token, p_name: booking.name, p_phone: booking.phone,
      p_party_size: booking.partySize, p_date: booking.date, p_time: booking.time,
      p_area_pref: booking.areaPref, p_notes: booking.notes,
    }),
};

// ---- Demo (read-only) ----

export interface DemoState {
  available: boolean;
  outlet: { id: string; name: string; currency_code: string; tax_percent: number; service_charge_percent: number; opening_hours: Record<string, string[]> };
  areas: { id: string; name: string; sort_order: number }[];
  tables: { id: string; area_id: string; label: string; status: string; qr_token: string; min_seats: number; max_seats: number }[];
  orders: { id: string; table_id: string; order_number: number; status: string; source: string; created_at: string }[];
  order_items: { id: string; order_id: string; name: string; station: string; quantity: number; unit_price_minor: number; modifiers: { name: string; price_delta_minor: number }[]; status: string; allergy_alert: boolean; created_at: string }[];
  reservations: { id: string; guest_name: string; party_size: number; booking_time: string; status: string; table_id: string | null }[];
  service_requests: { id: string; table_id: string; reason: string; status: string; created_at: string }[];
  bills: { id: string; table_id: string; total_minor: number; status: string }[];
}

export async function demoGetState(): Promise<DemoState | null> {
  const { data, error } = await supabase.rpc('demo_get_state');
  if (error || !data?.available) return null;
  return data as DemoState;
}

// ---- Public website ----

export interface PublicSite {
  outlet: { name: string; website_slug: string; website_hero_title: string | null; website_tagline: string | null; opening_hours: Record<string, string[]>; logo_url: string | null; hero_url: string | null };
  menu: { category: string; items: { name: string; description: string | null; price_minor: number; photo_url: string | null; dietary_tags: string[] }[] }[];
}

export async function publicSiteData(slug: string): Promise<PublicSite | { error: string }> {
  const { data, error } = await supabase.rpc('public_site_data', { p_slug: slug });
  if (error) return { error: error.message.includes('Site not found') ? 'This restaurant website does not exist or is not published.' : GENERIC };
  return data as PublicSite;
}
