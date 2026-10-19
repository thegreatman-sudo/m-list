import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Utensils, ArrowLeft, Shield, Users, Building2, TrendingUp, Loader2,
  Check, AlertCircle, Search,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { PLANS, PLAN_MAP, formatIdr, type PlanId, type BillingCycle } from '@/lib/plans';
import { loadPlanPricing } from '@/lib/saasBilling';
import type { PlanPricing } from '@/lib/saasBilling';
import type { Tenant } from '@/types';
import { cn } from '@/lib/format';
import { Spinner } from '@/components/ui';
import { Wordmark } from '@/components/Wordmark';

type Tab = 'overview' | 'tenants' | 'pricing';

export function SuperAdminPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [pricing, setPricing] = useState<Record<PlanId, PlanPricing> | null>(null);
  const [stats, setStats] = useState({ total: 0, active: 0, trial: 0, totalMrr: 0 });
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const [tRes, pRes] = await Promise.all([
      supabase.from('tenants').select('*').order('created_at', { ascending: false }),
      loadPlanPricing(),
    ]);
    const all = (tRes.data as Tenant[]) ?? [];
    setTenants(all);
    setPricing(pRes);
    const active = all.filter((t) => t.status === 'active');
    const trial = all.filter((t) => t.status === 'trial');
    const mrr = active.reduce((sum, t) => {
      const p = PLAN_MAP[t.plan as PlanId] ?? PLAN_MAP.starter;
      const price = t.billing_cycle === 'yearly' ? p.priceIdrMonthly * 10 / 12 : p.priceIdrMonthly;
      return sum + Math.round(price);
    }, 0);
    setStats({ total: all.length, active: active.length, trial: trial.length, totalMrr: mrr });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }

  const isOwner = profile?.role === 'owner';

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto max-w-[1200px] px-4 h-16 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-8 rounded-lg bg-saffron-600 flex items-center justify-center shadow-glow">
              <Utensils size={18} className="text-white" />
            </div>
            <div className="font-display font-bold text-base"><Wordmark /></div>
          </Link>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-saffron-500/30 bg-saffron-500/10 px-2.5 py-1 text-xs font-medium text-saffron-400">
            <Shield size={12} /> Platform admin
          </span>
          <button onClick={() => navigate('/app')} className="inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-ink-100 ml-2">
            <ArrowLeft size={15} /> Dashboard
          </button>
          <button onClick={async () => { await signOut(); navigate('/'); }} className="ml-auto text-sm text-ink-400 hover:text-ink-100">Sign out</button>
        </div>
      </header>

      {!isOwner && (
        <div className="mx-auto max-w-[1200px] px-4 py-8">
          <div className="rounded-2xl border border-rose2-500/40 bg-rose2-500/10 p-4 flex items-start gap-3">
            <AlertCircle className="text-rose2-400 shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-rose2-300">Only account owners can access the platform admin console.</div>
          </div>
        </div>
      )}

      {isOwner && (
        <div className="mx-auto max-w-[1200px] px-4 py-8 space-y-6">
          <div className="flex gap-1 bg-ink-800 border border-ink-600 rounded-xl p-1 w-fit">
            {([['overview', 'Overview'], ['tenants', 'Tenants'], ['pricing', 'Pricing overrides']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors', tab === t ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200')}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Building2} label="Total tenants" value={String(stats.total)} />
              <StatCard icon={Users} label="Active" value={String(stats.active)} accent="text-emerald2-400" />
              <StatCard icon={TrendingUp} label="On trial" value={String(stats.trial)} accent="text-saffron-400" />
              <StatCard icon={Utensils} label="Est. MRR" value={formatIdr(stats.totalMrr)} accent="text-saffron-400" />
            </div>
          )}

          {tab === 'tenants' && (
            <div className="space-y-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name…"
                  className="w-full max-w-sm h-10 pl-9 pr-3 rounded-xl bg-ink-800 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
                />
              </div>
              <div className="rounded-2xl border border-ink-600 bg-ink-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-700 text-ink-400 text-xs">
                    <tr>
                      <th className="text-left px-5 py-3 font-medium">Name</th>
                      <th className="text-left px-5 py-3 font-medium">Plan</th>
                      <th className="text-left px-5 py-3 font-medium">Status</th>
                      <th className="text-left px-5 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())).map((t) => (
                      <tr key={t.id} className="border-b border-ink-700/50 last:border-0">
                        <td className="px-5 py-3 font-medium">{t.name}{t.is_demo && <span className="ml-2 text-[10px] text-ink-500">demo</span>}</td>
                        <td className="px-5 py-3 capitalize text-ink-300">{PLAN_MAP[t.plan as PlanId]?.name ?? t.plan}</td>
                        <td className="px-5 py-3">
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
                            t.status === 'active' ? 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30'
                            : t.status === 'trial' ? 'bg-saffron-500/15 text-saffron-400 border-saffron-500/30'
                            : 'bg-amber2-500/15 text-amber2-400 border-amber2-500/30')}>
                            {t.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-ink-400">{new Date(t.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'pricing' && pricing && <PricingOverrides pricing={pricing} onSaved={load} />}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
      <div className="h-9 w-9 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center mb-3">
        <Icon size={17} className="text-saffron-400" />
      </div>
      <div className="text-xs text-ink-400">{label}</div>
      <div className={cn('font-display text-xl font-bold mt-1', accent)}>{value}</div>
    </div>
  );
}

function PricingOverrides({ pricing, onSaved }: { pricing: Record<PlanId, PlanPricing>; onSaved: () => void }) {
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const value = (plan: PlanId, cycle: BillingCycle) => {
    const key = `${plan}:${cycle}`;
    return edits[key] ?? pricing[plan][cycle];
  };

  const save = async (plan: PlanId, cycle: BillingCycle) => {
    const key = `${plan}:${cycle}`;
    const amount = edits[key];
    if (amount === undefined) return;
    setSaving(key);
    const { error } = await supabase.from('plan_overrides').upsert(
      { plan, billing_cycle: cycle, price_minor: amount },
      { onConflict: 'plan,billing_cycle' },
    );
    setSaving(null);
    if (error) {
      setMsg('Could not save override.');
    } else {
      setMsg(`${PLAN_MAP[plan].name} ${cycle} price updated.`);
      setEdits((e) => { const n = { ...e }; delete n[key]; return n; });
      onSaved();
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-400">Override the default price for any plan and billing cycle. Tenants see the overridden price at checkout.</p>
      {msg && <div className="rounded-xl border border-ink-600 bg-ink-800 px-4 py-3 text-sm text-ink-200">{msg}</div>}
      <div className="rounded-2xl border border-ink-600 bg-ink-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-700 text-ink-400 text-xs">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Plan</th>
              <th className="text-left px-5 py-3 font-medium">Cycle</th>
              <th className="text-left px-5 py-3 font-medium">Price (IDR)</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {PLANS.map((p) => (['monthly', 'yearly'] as BillingCycle[]).map((cycle) => {
              const key = `${p.id}:${cycle}`;
              const overridden = pricing[p.id].overridden;
              return (
                <tr key={key} className="border-b border-ink-700/50 last:border-0">
                  <td className="px-5 py-3 font-medium">{p.name}</td>
                  <td className="px-5 py-3 capitalize text-ink-300">{cycle}</td>
                  <td className="px-5 py-3">
                    <input
                      type="number"
                      value={value(p.id, cycle)}
                      onChange={(e) => setEdits((s) => ({ ...s, [key]: Number(e.target.value) }))}
                      className="h-9 w-32 px-2 rounded-lg bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
                    />
                    {overridden && <span className="ml-2 text-[10px] text-saffron-400">overridden</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => save(p.id, cycle)} disabled={edits[key] === undefined || saving === key} className="h-8 px-3 rounded-lg bg-saffron-600 text-white text-xs font-semibold disabled:opacity-40">
                      {saving === key ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
