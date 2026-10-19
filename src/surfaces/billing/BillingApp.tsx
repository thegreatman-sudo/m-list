import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Utensils, ArrowLeft, Check, CreditCard, FileText, Loader2, AlertCircle,
  Receipt, RotateCw, X, Clock, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { loadBillingState, loadPlanPricing, effectivePrice } from '@/lib/saasBilling';
import type { BillingState, PlanPricing } from '@/lib/saasBilling';
import { PLANS, PLAN_MAP, formatIdr, type PlanId, type BillingCycle } from '@/lib/plans';
import { cn } from '@/lib/format';
import { Spinner } from '@/components/ui';
import { Wordmark } from '@/components/Wordmark';
import { createSubscriptionPayment, payWithSnap, checkPaymentStatus } from '@/lib/midtrans';

type PayState = 'idle' | 'creating' | 'snap_open' | 'checking' | 'paid' | 'failed';

export function BillingPage() {
  const { tenant, signOut } = useAuth();
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [pricing, setPricing] = useState<Record<PlanId, PlanPricing> | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutBusy, setCheckoutBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payState, setPayState] = useState<PayState>('idle');
  const [payMessage, setPayMessage] = useState<string | null>(null);

  const reloadBilling = async () => {
    if (!tenant) return;
    const b = await loadBillingState(tenant);
    setBilling(b);
  };

  useEffect(() => {
    if (!tenant) { setLoading(false); return; }
    Promise.all([loadBillingState(tenant), loadPlanPricing()]).then(([b, p]) => {
      setBilling(b);
      setPricing(p);
      setLoading(false);
    });
  }, [tenant]);

  if (loading || !billing || !pricing) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }

  const currentPlan = billing.tenant.plan;
  const currentCycle = billing.tenant.billing_cycle;

  const handleCheckout = async (plan: PlanId, cycle: BillingCycle) => {
    if (!tenant) return;
    setError(null);
    setPayMessage(null);
    setCheckoutBusy(plan);
    setPayState('creating');

    // 1. Create the Snap transaction via edge function
    const result = await createSubscriptionPayment(plan, cycle);
    setCheckoutBusy(null);

    if (result.notConfigured) {
      setError(result.message || 'Online payments are not configured yet. Please contact support.');
      setPayState('failed');
      return;
    }
    if (!result.ok || !result.snapToken || !result.clientKey) {
      setError(result.error || 'Could not start payment. Please try again.');
      setPayState('failed');
      return;
    }

    setPayState('snap_open');
    setPayMessage('Complete the payment in the popup window.');

    // 2. Open the Snap popup
    await payWithSnap({
      snapToken: result.snapToken,
      clientKey: result.clientKey,
      isProduction: result.isProduction ?? false,
      onSuccess: async () => {
        setPayState('checking');
        setPayMessage('Payment received — confirming...');
        // 3. Check status as a fallback (webhook may already have updated it)
        if (result.orderId) {
          await checkPaymentStatus(result.orderId, 'subscription');
        }
        setPayState('paid');
        setPayMessage(null);
        await reloadBilling();
      },
      onPending: () => {
        setPayState('idle');
        setPayMessage('Payment is pending. You can complete it later — we\'ll confirm automatically.');
      },
      onError: (r) => {
        setPayState('failed');
        setPayMessage(null);
        setError('Payment failed. Please try again.');
        console.error('Snap error', r);
      },
      onClose: () => {
        setPayState('idle');
        setPayMessage(null);
      },
    });
  };

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto max-w-[900px] px-4 h-16 flex items-center gap-3">
          <Link to="/app" className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-8 rounded-lg bg-saffron-600 flex items-center justify-center shadow-glow">
              <Utensils size={18} className="text-white" />
            </div>
            <div className="font-display font-bold text-base"><Wordmark /></div>
          </Link>
          <button onClick={() => navigate('/app')} className="inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-ink-100 ml-2">
            <ArrowLeft size={15} /> Dashboard
          </button>
          <button onClick={async () => { await signOut(); navigate('/'); }} className="ml-auto text-sm text-ink-400 hover:text-ink-100">Sign out</button>
        </div>
      </header>

      <div className="mx-auto max-w-[900px] px-4 py-8 space-y-8">
        {/* Current plan summary */}
        <section className="rounded-2xl border border-ink-600 bg-ink-800 p-6">
          <h1 className="font-display text-xl font-bold">Billing</h1>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-ink-400">Current plan</div>
              <div className="font-display text-lg font-semibold mt-1">{PLAN_MAP[currentPlan].name}</div>
              <div className="text-sm text-ink-300 capitalize">{currentCycle} billing</div>
            </div>
            <div>
              <div className="text-xs text-ink-400">Status</div>
              <div className="mt-1">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize',
                  billing.tenant.status === 'active' ? 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30'
                  : billing.tenant.status === 'trial' ? 'bg-saffron-500/15 text-saffron-400 border-saffron-500/30'
                  : 'bg-amber2-500/15 text-amber2-400 border-amber2-500/30')}>
                  {billing.tenant.status.replace('_', ' ')}
                </span>
              </div>
              {billing.tenant.status === 'trial' && (
                <div className="text-xs text-ink-400 mt-2">{billing.daysLeftInTrial} days left in trial</div>
              )}
            </div>
          </div>
        </section>

        {/* Payment status banner */}
        {payState === 'paid' && (
          <div className="rounded-2xl border border-emerald2-500/40 bg-emerald2-500/10 p-4 flex items-start gap-3 df-slide-up">
            <CheckCircle2 className="text-emerald2-400 shrink-0 mt-0.5" size={20} />
            <div className="text-sm">
              <div className="font-semibold text-emerald2-300">Payment successful</div>
              <div className="text-emerald2-200/80 mt-0.5">Your subscription is now active.</div>
            </div>
          </div>
        )}
        {payState === 'checking' && (
          <div className="rounded-2xl border border-saffron-500/40 bg-saffron-500/10 p-4 flex items-center gap-3 df-slide-up">
            <Loader2 size={20} className="text-saffron-400 animate-spin" />
            <div className="text-sm text-saffron-300">Confirming your payment...</div>
          </div>
        )}
        {payState === 'snap_open' && payMessage && (
          <div className="rounded-2xl border border-sky2-500/40 bg-sky2-500/10 p-4 flex items-center gap-3 df-slide-up">
            <Clock size={20} className="text-sky2-400" />
            <div className="text-sm text-sky2-300">{payMessage}</div>
          </div>
        )}
        {payMessage && payState === 'idle' && (
          <div className="rounded-2xl border border-amber2-500/40 bg-amber2-500/10 p-4 flex items-center gap-3 df-slide-up">
            <Clock size={20} className="text-amber2-400" />
            <div className="text-sm text-amber2-300">{payMessage}</div>
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-rose2-500/40 bg-rose2-500/10 p-4 flex items-start gap-3">
            <AlertCircle className="text-rose2-400 shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-rose2-300 flex-1">{error}</div>
            <button onClick={() => setError(null)} className="text-rose2-400 hover:text-rose2-300">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Plan picker */}
        <section>
          <h2 className="font-display text-lg font-semibold mb-1">Choose your plan</h2>
          <p className="text-sm text-ink-400 mb-5">Upgrade or downgrade anytime. Pay with QRIS, GoPay, or credit card via Midtrans.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {PLANS.map((p) => {
              const isCurrent = p.id === currentPlan;
              const price = effectivePrice(pricing, p.id, currentCycle);
              return (
                <div key={p.id} className={cn(
                  'rounded-2xl border p-6 flex flex-col',
                  p.highlight === 'most_popular' ? 'border-saffron-500/40 bg-saffron-500/5' : 'border-ink-600 bg-ink-800',
                )}>
                  {p.highlight === 'most_popular' && (
                    <div className="text-[11px] font-semibold text-saffron-400 mb-2">MOST POPULAR</div>
                  )}
                  <div className="font-display text-lg font-bold">{p.name}</div>
                  <div className="text-xs text-ink-400 mt-1">{p.tagline}</div>
                  <div className="mt-4">
                    <span className="font-display text-2xl font-bold">{formatIdr(price)}</span>
                    <span className="text-xs text-ink-400">/{currentCycle === 'yearly' ? 'yr' : 'mo'}</span>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-ink-300">
                        <Check size={15} className="text-saffron-400 shrink-0 mt-0.5" /> {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => handleCheckout(p.id, currentCycle)}
                    disabled={isCurrent || checkoutBusy !== null || payState === 'snap_open' || payState === 'checking'}
                    className={cn(
                      'mt-6 h-10 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none',
                      isCurrent ? 'border border-ink-600 text-ink-400' : p.highlight === 'most_popular' ? 'bg-saffron-600 hover:bg-saffron-500 text-white' : 'border border-ink-500 text-ink-100 hover:bg-ink-700',
                    )}
                  >
                    {isCurrent ? 'Current plan'
                      : checkoutBusy === p.id ? <Loader2 size={16} className="animate-spin mx-auto" />
                      : payState === 'snap_open' ? 'Complete payment in popup'
                      : `Switch to ${p.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Invoices */}
        <section>
          <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <Receipt size={18} className="text-ink-400" /> Invoice history
          </h2>
          {billing.invoices.length === 0 ? (
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-8 text-center text-sm text-ink-400">
              No invoices yet. They appear here once you start a paid subscription.
            </div>
          ) : (
            <div className="rounded-2xl border border-ink-600 bg-ink-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-ink-700 text-ink-400 text-xs">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Date</th>
                    <th className="text-left px-5 py-3 font-medium">Plan</th>
                    <th className="text-left px-5 py-3 font-medium">Amount</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-ink-700/50 last:border-0">
                      <td className="px-5 py-3 text-ink-300">{inv.period_start ? new Date(inv.period_start).toLocaleDateString() : new Date(inv.created_at).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-ink-300 capitalize">{inv.plan ?? '—'}</td>
                      <td className="px-5 py-3 text-ink-200">{formatIdr(inv.amount_minor)}</td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
                          inv.status === 'paid' ? 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30'
                          : inv.status === 'pending' ? 'bg-amber2-500/15 text-amber2-400 border-amber2-500/30'
                          : inv.status === 'failed' ? 'bg-rose2-500/15 text-rose2-400 border-rose2-500/30'
                          : 'bg-ink-600 text-ink-200 border-ink-500'
                        )}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
