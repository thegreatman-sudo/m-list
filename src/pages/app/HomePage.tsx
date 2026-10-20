import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Circle, ArrowRight, AlertCircle, TrendingUp,
  ChefHat, ConciergeBell, CalendarDays, CreditCard, ClipboardList,
  Plus, UtensilsCrossed, QrCode, UserCog, Settings as SettingsIcon,
  CreditCard as PaymentIcon, ShoppingBag, LayoutDashboard,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTenantFromAuth } from '@/lib/tenant';
import { loadBillingState, checkLimit } from '@/lib/saasBilling';
import type { BillingState } from '@/lib/saasBilling';
import { PLAN_MAP, formatIdr } from '@/lib/plans';
import { cn, formatIDR, formatCompactIDR } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Spinner, EmptyState } from '@/components/ui';
import { useSetupChecklist } from '@/hooks/useSetupChecklist';
import type { Outlet } from '@/types';

interface DashboardStats {
  todaySales: number;
  openTables: number;
  kitchenOrders: number;
  pendingBells: number;
  upcomingReservations: number;
}

export function HomePage() {
  const { tenant } = useAuth();
  let tenantData;
  try {
    tenantData = useTenantFromAuth();
  } catch {
    tenantData = null;
  }

  const [billing, setBilling] = useState<BillingState | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const outlet = tenantData?.outlet ?? null;
  const setup = useSetupChecklist(outlet);

  useEffect(() => {
    if (!tenant) { setLoading(false); return; }
    loadBillingState(tenant).then((b) => {
      setBilling(b);
      setLoading(false);
    });
  }, [tenant]);

  useEffect(() => {
    if (!outlet) { setStatsLoading(false); return; }
    loadStats(outlet).then((s) => {
      setStats(s);
      setStatsLoading(false);
    });
  }, [outlet]);

  if (loading || !tenant || !tenantData) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const plan = PLAN_MAP[billing?.tenant.plan ?? 'starter'];
  const readOnly = billing?.isReadOnly ?? false;
  const isTrial = billing?.tenant.status === 'trial';
  const setupComplete = setup.doneCount === setup.total;
  const restaurantName = outlet?.name ?? tenant.name;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 space-y-6">
      {/* Read-only warning */}
      {readOnly && (
        <div className="rounded-2xl border border-amber2-500/40 bg-amber2-500/10 p-4 flex items-start gap-3">
          <AlertCircle className="text-amber2-400 shrink-0 mt-0.5" size={20} />
          <div className="text-sm flex-1">
            <div className="font-semibold text-amber2-300">Your account is read-only</div>
            <div className="text-amber2-200/80 mt-0.5">Update your billing to keep taking orders and editing your menu.</div>
            <Link to="/billing" className="inline-flex items-center gap-1 mt-2 text-amber2-300 font-medium hover:text-amber2-200">
              Update billing <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* Trial banner */}
      {isTrial && (
        <div className="rounded-2xl border border-saffron-500/30 bg-saffron-500/10 p-4 flex items-start gap-3">
          <CheckCircle2 className="text-saffron-400 shrink-0 mt-0.5" size={20} />
          <div className="text-sm flex-1">
            <div className="font-semibold text-saffron-300">Free trial — {billing!.daysLeftInTrial} days left</div>
            <div className="text-saffron-200/80 mt-0.5">You're on the {plan.name} plan. Pick a plan before the trial ends.</div>
          </div>
          <Link to="/billing" className="shrink-0 h-9 px-4 inline-flex items-center rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white text-sm font-semibold">
            Choose plan
          </Link>
        </div>
      )}

      {/* Setup checklist */}
      {!setup.loading && !setupComplete && (
        <SetupChecklistCard
          steps={setup.steps}
          doneCount={setup.doneCount}
          total={setup.total}
          restaurantName={restaurantName}
        />
      )}

      {/* Setup complete welcome */}
      {setupComplete && !setup.loading && (
        <div className="rounded-2xl border border-emerald2-500/30 bg-emerald2-500/10 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-emerald2-400 shrink-0" size={22} />
            <div>
              <div className="font-semibold text-emerald2-300">All set! Your restaurant is ready.</div>
              <div className="text-sm text-emerald2-200/80 mt-0.5">Setup complete — here's what's happening today.</div>
            </div>
          </div>
        </div>
      )}

      {/* Real stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<TrendingUp size={18} />}
          label="Today's sales"
          value={stats && !statsLoading ? formatCompactIDR(stats.todaySales) : '—'}
          loading={statsLoading}
        />
        <StatCard
          icon={<LayoutDashboard size={18} />}
          label="Open tables"
          value={stats && !statsLoading ? String(stats.openTables) : '—'}
          loading={statsLoading}
        />
        <StatCard
          icon={<ChefHat size={18} />}
          label="Kitchen orders"
          value={stats && !statsLoading ? String(stats.kitchenOrders) : '—'}
          loading={statsLoading}
        />
        <StatCard
          icon={<CalendarDays size={18} />}
          label="Upcoming reservations"
          value={stats && !statsLoading ? String(stats.upcomingReservations) : '—'}
          loading={statsLoading}
        />
      </div>

      {/* Empty state when no data */}
      {stats && !statsLoading && stats.todaySales === 0 && stats.kitchenOrders === 0 && setupComplete && (
        <div className="rounded-2xl border border-ink-600 bg-ink-800 p-6">
          <EmptyState
            icon={<ShoppingBag size={40} />}
            title="No orders yet today"
            hint="Once guests scan your table QR codes and place orders, you'll see live activity here."
          />
          <div className="flex justify-center mt-2">
            <Link to="/app/tables" className="inline-flex items-center gap-2 text-sm font-medium text-saffron-400 hover:text-saffron-300">
              <QrCode size={16} /> View table QR codes
            </Link>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="font-display text-lg font-semibold mb-3">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction to="/app/menu" icon={<Plus size={16} />} label="Add menu item" />
          <QuickAction to="/app/tables" icon={<QrCode size={16} />} label="Print QR codes" />
          <QuickAction to="/app/staff" icon={<UserCog size={16} />} label="Invite staff" />
          <QuickAction to="/app/orders" icon={<ClipboardList size={16} />} label="View orders" />
        </div>
      </div>

      {/* Plan + usage */}
      {billing && (
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">Plan & usage</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
              <div className="text-xs text-ink-400">Current plan</div>
              <div className="font-display text-2xl font-bold mt-1">{plan.name}</div>
              <div className="text-sm text-ink-300 mt-1">{formatIdr(plan.priceIdrMonthly)}/mo</div>
              <Link to="/billing" className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-saffron-400 hover:text-saffron-300">
                Manage plan <ArrowRight size={12} />
              </Link>
            </div>
            <UsageCard label="Outlets" current={billing.usage.outlets} limit={plan.limits.outlets} />
            <UsageCard label="Tables" current={billing.usage.tables} limit={plan.limits.tables} />
          </div>
        </div>
      )}

      {/* Website link */}
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center">
          <CreditCard size={18} className="text-saffron-400" />
        </div>
        <div className="flex-1">
          <div className="font-display font-semibold">Restaurant website</div>
          <div className="text-xs text-ink-400">
            {outlet?.website_published
              ? <>Published at <span className="text-saffron-400">/r/{outlet.website_slug}</span></>
              : 'Not published yet — publish from Settings'}
          </div>
        </div>
        {outlet?.website_published ? (
          <Link to={`/r/${outlet.website_slug}`} className="h-9 px-4 inline-flex items-center rounded-xl border border-ink-500 text-sm font-medium hover:bg-ink-700">
            View
          </Link>
        ) : (
          <Link to="/app/settings" className="h-9 px-4 inline-flex items-center rounded-xl border border-ink-500 text-sm font-medium hover:bg-ink-700">
            Publish
          </Link>
        )}
      </div>
    </div>
  );
}

function SetupChecklistCard({
  steps, doneCount, total, restaurantName,
}: {
  steps: { id: string; label: string; done: boolean; link: string }[];
  doneCount: number;
  total: number;
  restaurantName: string;
}) {
  const pct = Math.round((doneCount / total) * 100);
  return (
    <div className="rounded-2xl border border-saffron-500/30 bg-ink-800 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Finish setting up {restaurantName}</h2>
          <p className="text-sm text-ink-400 mt-1">{doneCount} of {total} done — let's get your restaurant running.</p>
        </div>
        <div className="text-2xl font-display font-bold text-saffron-400 shrink-0">{pct}%</div>
      </div>
      <div className="h-2 rounded-full bg-ink-700 overflow-hidden mb-5">
        <div className="h-full rounded-full bg-saffron-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-1">
        {steps.map((step) => (
          <Link
            key={step.id}
            to={step.link}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
              step.done ? 'hover:bg-ink-700/50' : 'hover:bg-ink-700'
            )}
          >
            {step.done ? (
              <CheckCircle2 size={18} className="text-emerald2-400 shrink-0" />
            ) : (
              <Circle size={18} className="text-ink-500 shrink-0" />
            )}
            <span className={cn(step.done ? 'text-ink-400 line-through' : 'text-ink-100')}>
              {step.label}
            </span>
            {!step.done && <ArrowRight size={14} className="ml-auto text-ink-500 shrink-0" />}
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
      <div className="flex items-center gap-2 text-ink-400">
        <span className="text-saffron-400">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <div className="font-display text-2xl font-bold mt-2">
        {loading ? <Spinner className="h-5 w-5" /> : value}
      </div>
    </div>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-ink-600 bg-ink-800 p-4 hover:border-saffron-500/40 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center text-saffron-400 group-hover:border-saffron-500/40">
          {icon}
        </div>
        <span className="text-sm font-medium">{label}</span>
        <ArrowRight size={14} className="ml-auto text-ink-500 group-hover:text-saffron-400 transition-colors" />
      </div>
    </Link>
  );
}

function UsageCard({ label, current, limit }: { label: string; current: number; limit: number }) {
  const unlimited = limit === 0;
  const pct = unlimited ? 0 : Math.min(100, (current / limit) * 100);
  const atLimit = !unlimited && current >= limit;
  return (
    <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-ink-400">{label}</div>
        <div className="text-sm font-medium">
          {current}{unlimited ? '' : ` / ${limit}`}
        </div>
      </div>
      {!unlimited && (
        <div className="mt-3 h-2 rounded-full bg-ink-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-saffron-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {unlimited && <div className="mt-3 text-xs text-emerald2-400">Unlimited</div>}
      {atLimit && (
        <Link to="/billing" className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-saffron-400 hover:text-saffron-300">
          Upgrade <ArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}

async function loadStats(outlet: Outlet): Promise<DashboardStats> {
  const today = new Date().toISOString().slice(0, 10);
  const startToday = `${today}T00:00:00`;
  const endToday = `${today}T23:59:59`;

  const [salesRes, tablesRes, kitchenRes, bellsRes, resRes] = await Promise.all([
    supabase
      .from('payments')
      .select('amount_minor')
      .eq('tenant_id', outlet.tenant_id)
      .eq('status', 'completed')
      .gte('paid_at', startToday)
      .lte('paid_at', endToday),
    supabase
      .from('tables')
      .select('id, status')
      .eq('outlet_id', outlet.id)
      .in('status', ['occupied', 'awaiting_payment']),
    supabase
      .from('orders')
      .select('id')
      .eq('outlet_id', outlet.id)
      .in('status', ['received', 'accepted', 'preparing', 'ready']),
    supabase
      .from('service_requests')
      .select('id')
      .eq('outlet_id', outlet.id)
      .in('status', ['sent', 'seen', 'on_the_way']),
    supabase
      .from('reservations')
      .select('id')
      .eq('outlet_id', outlet.id)
      .eq('booking_date', today)
      .in('status', ['pending', 'confirmed', 'arrived']),
  ]);

  const todaySales = (salesRes.data as { amount_minor: number }[] | null)?.reduce((s, p) => s + (p.amount_minor || 0), 0) ?? 0;
  const openTables = tablesRes.data?.length ?? 0;
  const kitchenOrders = kitchenRes.data?.length ?? 0;
  const pendingBells = bellsRes.data?.length ?? 0;
  const upcomingReservations = resRes.data?.length ?? 0;

  return { todaySales, openTables, kitchenOrders, pendingBells, upcomingReservations };
}
