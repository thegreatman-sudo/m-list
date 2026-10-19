import { createContext, useContext } from 'react';
import { useAuth } from '@/lib/auth';
import type { Outlet } from '@/types';

export interface TenantData {
  tenantId: string;
  outlet: Outlet | null;
  role: string;
  /** Users with these roles see every surface. */
  isManager: boolean;
  loading: boolean;
}

const TenantContext = createContext<TenantData | null>(null);

const MANAGER_ROLES = ['owner', 'manager'];

export function tenantDataFromAuth(
  tenantId: string | null | undefined,
  outlet: Outlet | null,
  role: string | null,
  loading: boolean
): TenantData | null {
  if (!tenantId) return null;
  return {
    tenantId,
    outlet,
    role: role ?? '',
    isManager: MANAGER_ROLES.includes(role ?? ''),
    loading,
  };
}

export function useTenant(): TenantData {
  const ctx = useContext(TenantContext);
  if (ctx) return ctx;
  // Fallback so surfaces can also run inside the public demo shell (no auth):
  // read values injected by the demo provider.
  const demo = (globalThis as Record<string, unknown>).__DINEFLOW_DEMO__ as TenantData | undefined;
  if (demo) return demo;
  throw new Error('useTenant must be used inside TenantProvider or DemoProvider');
}

export { TenantContext };

export function useTenantFromAuth(): TenantData {
  const { tenant, role, loading } = useAuth();
  // Always call the hook: a conditional call changes hook order between the
  // logged-out and logged-in render and React unmounts the tree (blank page).
  const outlet = useOutletForTenant(tenant?.id ?? '');
  const data = tenantDataFromAuth(tenant?.id, outlet, role, loading);
  if (!data) throw new Error('not in tenant');
  return data;
}

// Simple hook wrapper: fetches the tenant's first outlet.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function useOutletForTenant(tenantId: string): Outlet | null {
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    supabase
      .from('outlets')
      .select('*')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data) setOutlet(data as Outlet);
      });
    return () => {
      alive = false;
    };
  }, [tenantId]);
  return outlet;
}
