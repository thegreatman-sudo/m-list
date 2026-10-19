import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Utensils, QrCode, ChefHat, ConciergeBell, CreditCard, CalendarDays,
  LayoutGrid, Globe, Receipt, LogOut, Settings, ArrowRight, AlertCircle, CheckCircle2, Package, Music,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTenantFromAuth } from '@/lib/tenant';
import { loadBillingState, checkLimit } from '@/lib/saasBilling';
import type { BillingState } from '@/lib/saasBilling';
import { PLAN_MAP, formatIdr, TRIAL_DAYS } from '@/lib/plans';
import { formatIDR } from '@/lib/format';
import { cn } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';
import { RebrandBanner } from '@/components/RebrandBanner';
import { Wordmark } from '@/components/Wordmark';

export function DashboardPage() {
  const { tenant: _tenant, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);

  let tenant;
  try {
    const td = useTenantFromAuth();
    tenant = td;
  } catch {
    tenant = null;
  }

  useEffect(() => {
    if (!tenant?.tenantId) { setLoading(false); return; }
    const t = _tenant;
    if (!t) { setLoading(false); return; }
    loadBillingState(t).then((b) => { setBilling(b); setLoading(false); });
  }, [_tenant, tenant?.tenantId]);

  if (loading || !tenant) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }

  const plan = PLAN_MAP[billing?.tenant.plan ?? 'starter'];
  const readOnly = billing?.isReadOnly ?? false;

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <DashboardHeader outletName={tenant.outlet?.name ?? 'Your restaurant'} role={tenant.role} onSignOut={async () => { await signOut(); navigate('/'); }} />
      <div className="mx-auto max-w-[1200px] px-4 py-8 space-y-6">
        <RebrandBanner />
        {readOnly && (
          <div className="rounded-2xl border border-amber2-500/40 bg-amber2-500/10 p-4 flex items-start gap-3">
            <AlertCircle className="text-amber2-400 shrink-0 mt-0.5" size={20} />
            <div className="text-sm">
              <div className="font-semibold text-amber2-300">Your account is read-only</div>
              <div className="text-amber2-200/80 mt-0.5">Update your billing to keep taking orders and editing your menu.</div>
              <Link to="/billing" className="inline-flex items-center gap-1 mt-2 text-amber2-300 font-medium hover:text-amber2-200">Update billing <ArrowRight size={14} /></Link>
            </div>
          </div>
        )}

        {/* Trial banner */}
        {billing && billing.tenant.status === 'trial' && (
          <div className="rounded-2xl border border-saffron-500/30 bg-saffron-500/10 p-4 flex items-start gap-3">
            <CheckCircle2 className="text-saffron-400 shrink-0 mt-0.5" size={20} />
            <div className="text-sm flex-1">
              <div className="font-semibold text-saffron-300">Free trial — {billing.daysLeftInTrial} days left</div>
              <div className="text-saffron-200/80 mt-0.5">You're on the {plan.name} plan. Pick a plan before the trial ends to keep everything running.</div>
            </div>
            <Link to="/billing" className="shrink-0 h-9 px-4 inline-flex items-center rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white text-sm font-semibold">Choose plan</Link>
          </div>
        )}

        {/* Plan + usage */}
        {billing && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
              <div className="text-xs text-ink-400">Current plan</div>
              <div className="font-display text-2xl font-bold mt-1">{plan.name}</div>
              <div className="text-sm text-ink-300 mt-1">{formatIdr(plan.priceIdrMonthly)}/mo</div>
            </div>
            <UsageCard label="Outlets" current={billing.usage.outlets} limit={plan.limits.outlets} />
            <UsageCard label="Tables" current={billing.usage.tables} limit={plan.limits.tables} />
          </div>
        )}

        {/* Quick links to surfaces */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">Your tools</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ToolLink to="/demo" icon={QrCode} label="Guest QR ordering" desc="What guests see when they scan" />
            <ToolLink to="/demo" icon={ChefHat} label="Kitchen display" desc="Live tickets and timers" />
            <ToolLink to="/demo" icon={ConciergeBell} label="Waiter app" desc="Floor map and bell calls" />
            <ToolLink to="/demo" icon={CreditCard} label="POS" desc="Bills and payments" />
            <ToolLink to="/demo" icon={CalendarDays} label="Reservations" desc="Booking book" />
            <ToolLink to="/demo" icon={LayoutGrid} label="Admin dashboard" desc="Menu, tables, reports" />
            <ToolLink to="/app/songs" icon={Music} label="Song requests" desc="Music settings & schedule" />
            <ToolLink to="/dj" icon={Music} label="DJ screen" desc="Song queue for live music" />
            {plan.featureFlags.inventory ? (
              <ToolLink to="/inventory" icon={Package} label="Inventory" desc="Stock, recipes, purchasing" />
            ) : (              <Link
                to="/billing"
                className="group rounded-2xl border border-dashed border-ink-500 bg-ink-800/60 p-5 hover:border-saffron-500/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center">
                    <Package size={18} className="text-ink-400" />
                  </div>
                  <div>
                    <div className="font-display font-semibold flex items-center gap-2">Inventory <span className="rounded-full bg-saffron-500/15 text-saffron-400 border border-saffron-500/30 px-2 py-0.5 text-[10px] font-semibold">GROWTH</span></div>
                    <div className="text-xs text-ink-400">Stock, recipes, purchasing — upgrade to unlock</div>
                  </div>
                  <ArrowRight size={15} className="ml-auto text-ink-500 group-hover:text-saffron-400 transition-colors" />
                </div>
              </Link>
            )}
          </div>
        </div>

        {/* Website + billing links */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Link to="/billing" className="group rounded-2xl border border-ink-600 bg-ink-800 p-6 hover:border-saffron-500/40 transition-colors">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center group-hover:border-saffron-500/40">
                <Receipt size={18} className="text-saffron-400" />
              </div>
              <div>
                <div className="font-display font-semibold">Billing & subscription</div>
                <div className="text-xs text-ink-400">Plan, invoices, payment method</div>
              </div>
              <ArrowRight size={16} className="ml-auto text-ink-500 group-hover:text-saffron-400 transition-colors" />
            </div>
          </Link>
          <div className="rounded-2xl border border-ink-600 bg-ink-800 p-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center">
                <Globe size={18} className="text-saffron-400" />
              </div>
              <div className="flex-1">
                <div className="font-display font-semibold">Restaurant website</div>
                <div className="text-xs text-ink-400">
                  {tenant.outlet?.website_published
                    ? <>Published at <span className="text-saffron-400">/r/{tenant.outlet.website_slug}</span></>
                    : 'Not published yet'}
                </div>
              </div>
              {tenant.outlet?.website_published ? (
                <Link to={`/r/${tenant.outlet.website_slug}`} className="h-9 px-4 inline-flex items-center rounded-xl border border-ink-500 text-sm font-medium hover:bg-ink-700">View</Link>
              ) : (
                <span className="text-xs text-ink-500">Publish in Admin</span>
              )}
            </div>
          </div>
        </div>

        {profile?.role === 'owner' && (
          <div className="text-center pt-4">
            <Link to="/superadmin" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-200">
              <Settings size={14} /> Platform admin
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardHeader({ outletName, role, onSignOut }: { outletName: string; role: string; onSignOut: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
      <div className="mx-auto max-w-[1200px] px-4 h-16 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="h-8 w-8 rounded-lg bg-saffron-600 flex items-center justify-center shadow-glow">
            <Utensils size={18} className="text-white" />
          </div>
          <div className="font-display font-bold text-base"><Wordmark /></div>
        </Link>
        <div className="hidden sm:block h-6 w-px bg-ink-700" />
        <div className="hidden sm:block">
          <div className="text-sm font-medium">{outletName}</div>
          <div className="text-[11px] text-ink-400 capitalize">{role}</div>
        </div>
        <button onClick={onSignOut} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm text-ink-300 hover:bg-ink-800 hover:text-ink-100">
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </header>
  );
}

function UsageCard({ label, current, limit }: { label: string; current: number; limit: number }) {
  const unlimited = limit === 0;
  const pct = unlimited ? 0 : Math.min(100, (current / limit) * 100);
  const color = unlimited ? 'bg-emerald2-500' : pct >= 90 ? 'bg-rose2-500' : pct >= 70 ? 'bg-amber2-500' : 'bg-saffron-500';
  return (
    <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-ink-400">{label}</div>
        <div className="text-sm font-medium">{current}{unlimited ? '' : ` / ${limit}`}</div>
      </div>
      {!unlimited && (
        <div className="mt-3 h-2 rounded-full bg-ink-700 overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
        </div>
      )}
      {unlimited && <div className="mt-3 text-xs text-emerald2-400">Unlimited</div>}
    </div>
  );
}

function ToolLink({ to, icon: Icon, label, desc }: { to: string; icon: typeof QrCode; label: string; desc: string }) {
  return (
    <Link to={to} className="group rounded-2xl border border-ink-600 bg-ink-800 p-5 hover:border-saffron-500/40 transition-colors">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center group-hover:border-saffron-500/40 transition-colors">
          <Icon size={18} className="text-saffron-400" />
        </div>
        <div>
          <div className="font-display font-semibold">{label}</div>
          <div className="text-xs text-ink-400">{desc}</div>
        </div>
        <ArrowRight size={15} className="ml-auto text-ink-500 group-hover:text-saffron-400 transition-colors" />
      </div>
    </Link>
  );
}
