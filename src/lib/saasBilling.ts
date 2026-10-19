import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { PLAN_MAP, PLANS, priceForCycle, type BillingCycle, type PlanId } from '@/lib/plans';
import type { Tenant, InvoiceRow, PlanOverrideRow, SubscriptionRow } from '@/types';

export interface TenantUsage {
  outlets: number;
  tables: number;
  staff: number;
}

export interface BillingState {
  tenant: Tenant;
  subscription: SubscriptionRow | null;
  invoices: InvoiceRow[];
  usage: TenantUsage;
  daysLeftInTrial: number;
  isReadOnly: boolean;
}

export async function loadBillingState(tenant: Tenant): Promise<BillingState> {
  const [subRes, invRes, usageRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('invoices')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('tenant_usage')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
  ]);

  const subscription = (subRes.data as SubscriptionRow) ?? null;
  const invoices = (invRes.data as InvoiceRow[]) ?? [];
  const usageRow = usageRes.data as { outlet_count: number; table_count: number; staff_count: number } | null;
  const usage: TenantUsage = {
    outlets: usageRow?.outlet_count ?? 0,
    tables: usageRow?.table_count ?? 0,
    staff: usageRow?.staff_count ?? 0,
  };

  const trialEnd = new Date(tenant.trial_ends_at).getTime();
  const daysLeftInTrial = Math.max(0, Math.ceil((trialEnd - Date.now()) / 86_400_000));
  const isReadOnly = tenant.status === 'read_only' || tenant.status === 'suspended' ||
    (tenant.status === 'trial' && daysLeftInTrial <= 0);

  return { tenant, subscription, invoices, usage, daysLeftInTrial, isReadOnly };
}

export interface PlanPricing {
  plan: PlanId;
  monthly: number;
  yearly: number;
  /** True if a super-admin override changed the price from the config default. */
  overridden: boolean;
}

export async function loadPlanPricing(): Promise<Record<PlanId, PlanPricing>> {
  const { data } = await supabase.from('plan_overrides').select('*');
  const overrides = new Map<string, number>();
  for (const row of (data as PlanOverrideRow[]) ?? []) {
    overrides.set(`${row.plan}:${row.billing_cycle}`, row.price_minor);
  }
  const out = {} as Record<PlanId, PlanPricing>;
  for (const p of PLANS) {
    const monthlyOverride = overrides.get(`${p.id}:monthly`);
    const yearlyOverride = overrides.get(`${p.id}:yearly`);
    out[p.id] = {
      plan: p.id,
      monthly: monthlyOverride ?? priceForCycle(p, 'monthly'),
      yearly: yearlyOverride ?? priceForCycle(p, 'yearly'),
      overridden: monthlyOverride !== undefined || yearlyOverride !== undefined,
    };
  }
  return out;
}

/** Resolves the effective price for a plan/cycle, preferring a DB override. */
export function effectivePrice(pricing: Record<PlanId, PlanPricing>, plan: PlanId, cycle: BillingCycle): number {
  return pricing[plan][cycle];
}

export interface CheckoutResult {
  url: string;
  error?: never;
}
export interface CheckoutError {
  error: string;
  url?: never;
}

/**
 * Starts a Stripe Checkout session for the given plan + cycle by invoking the
 * `stripe-checkout` edge function. Returns the hosted URL to redirect to.
 */
export async function startCheckout(
  tenant: Tenant,
  plan: PlanId,
  cycle: BillingCycle,
  pricing: Record<PlanId, PlanPricing>,
): Promise<CheckoutResult | CheckoutError> {
  const amount = effectivePrice(pricing, plan, cycle);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({
      tenantId: tenant.id,
      plan,
      cycle,
      amount,
      restaurantName: tenant.name,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body?.error || `Could not start checkout (${res.status}).` };
  }
  const body = await res.json().catch(() => ({}));
  if (!body?.url) return { error: 'Stripe is not configured yet. Add your Stripe keys to enable checkout.' };
  return { url: body.url as string };
}

/** Opens the Stripe customer portal for the tenant to manage their subscription. */
export async function openCustomerPortal(tenant: Tenant): Promise<CheckoutResult | CheckoutError> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ tenantId: tenant.id }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body?.error || `Could not open the customer portal (${res.status}).` };
  }
  const body = await res.json().catch(() => ({}));
  if (!body?.url) return { error: 'Stripe is not configured yet. Add your Stripe keys to manage subscriptions.' };
  return { url: body.url as string };
}

export interface LimitCheck {
  ok: boolean;
  limit: number;
  current: number;
  planName: string;
}

/** Soft limit check — returns ok:false when the current usage is at/over the plan limit. */
export function checkLimit(
  usage: TenantUsage,
  planId: PlanId,
  field: 'outlets' | 'tables' | 'staff',
): LimitCheck {
  const plan = PLAN_MAP[planId];
  const limit = plan.limits[field];
  const current = usage[field];
  if (limit === 0) return { ok: true, limit: 0, current, planName: plan.name };
  return { ok: current < limit, limit, current, planName: plan.name };
}
