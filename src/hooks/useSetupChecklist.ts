import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Outlet } from '@/types';

export interface SetupStep {
  id: string;
  label: string;
  done: boolean;
  link: string;
}

export interface SetupState {
  steps: SetupStep[];
  doneCount: number;
  total: number;
  loading: boolean;
  reload: () => void;
}

export function useSetupChecklist(outlet: Outlet | null): SetupState {
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!outlet) {
      setLoading(false);
      return;
    }
    const outletId = outlet.id;

    const [areasRes, tablesRes, menuRes, staffRes, ordersRes] = await Promise.all([
      supabase.from('areas').select('id, archived_at').eq('outlet_id', outletId),
      supabase.from('tables').select('id').eq('outlet_id', outletId),
      supabase.from('menu_items').select('id').eq('outlet_id', outletId).limit(1),
      supabase.from('profiles').select('id').neq('id', supabase.auth.getUser ? '' : '').limit(5),
      supabase.from('orders').select('id').eq('outlet_id', outletId).limit(1),
    ]);

    const hasProfile = !!(outlet.logo_url || outlet.phone || outlet.address || outlet.opening_hours && Object.keys(outlet.opening_hours).length > 0);
    const hasAreas = ((areasRes.data as { archived_at: string | null }[] | null)?.filter(a => !a.archived_at).length ?? 0) > 0;
    const hasTables = (tablesRes.data?.length ?? 0) > 0;
    const hasMenu = (menuRes.data?.length ?? 0) > 0;
    const hasStaff = (staffRes.data?.length ?? 0) > 1; // owner + at least 1 staff
    const hasPayments = outlet.tax_percent > 0 || outlet.service_charge_percent > 0 || (outlet.payment_methods?.length ?? 0) > 0;
    const hasOrders = (ordersRes.data?.length ?? 0) > 0;
    // QR print step: mark done once tables exist (they have QR tokens automatically)
    const hasQrPrinted = hasTables;

    const allSteps: SetupStep[] = [
      { id: 'profile', label: 'Restaurant profile (name, logo, address, phone, opening hours)', done: hasProfile, link: '/app/settings' },
      { id: 'areas', label: 'Areas (Ground Floor, Second Floor, Outdoor, etc.)', done: hasAreas, link: '/app/tables' },
      { id: 'tables', label: 'Tables (add tables to each area)', done: hasTables, link: '/app/tables' },
      { id: 'qr', label: 'Print table QR codes', done: hasQrPrinted, link: '/app/tables' },
      { id: 'menu', label: 'Menu (categories and items)', done: hasMenu, link: '/app/menu' },
      { id: 'staff', label: 'Staff (invite chef, waiter, cashier)', done: hasStaff, link: '/app/staff' },
      { id: 'payments', label: 'Payments (tax, service charge, payment methods)', done: hasPayments, link: '/app/settings' },
      { id: 'test_order', label: 'Place a test order from a table QR', done: hasOrders, link: '/app/orders' },
    ];

    setSteps(allSteps);
    setLoading(false);
  }, [outlet]);

  useEffect(() => {
    load();
  }, [load]);

  const doneCount = steps.filter(s => s.done).length;
  return { steps, doneCount, total: steps.length, loading, reload: load };
}
