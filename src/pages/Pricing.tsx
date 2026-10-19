import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, ShieldCheck, Zap, Building2, X, Minus } from 'lucide-react';
import { MarketingNav, MarketingFooter } from './Landing';
import { cn, formatIDR } from '@/lib/format';
import {
  PLANS, COMPARE_GROUPS, FAQ_ITEMS, priceForCycle, type BillingCycle,
} from '@/lib/plans';

export function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <MarketingNav menuOpen={false} setMenuOpen={() => {}} />

      <div className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="font-display text-4xl sm:text-5xl font-bold text-center">Simple pricing</h1>
        <p className="text-center text-ink-400 mt-3 max-w-lg mx-auto">
          Start with a 14-day free trial — no card required. Pick a plan when you are ready.
        </p>

        {/* Monthly / Yearly toggle */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="inline-flex rounded-xl border border-ink-600 bg-ink-800 p-1">
            <button
              onClick={() => setCycle('monthly')}
              className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors', cycle === 'monthly' ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200')}
            >
              Monthly
            </button>
            <button
              onClick={() => setCycle('yearly')}
              className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2', cycle === 'yearly' ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200')}
            >
              Yearly
              <span className="rounded-full bg-emerald2-500/15 text-emerald2-400 border border-emerald2-500/30 px-2 py-0.5 text-[10px] font-semibold">2 months free</span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div className="mt-12 grid gap-4 md:grid-cols-3 items-start">
          {PLANS.map((p) => {
            const price = priceForCycle(p, cycle);
            const periodLabel = cycle === 'yearly' ? 'per year' : 'per month';
            return (
              <div
                key={p.id}
                className={cn(
                  'relative rounded-3xl border p-7 flex flex-col',
                  p.highlight === 'most_popular'
                    ? 'border-saffron-500/50 bg-gradient-to-b from-saffron-600/10 to-ink-800 shadow-glow'
                    : 'border-ink-600 bg-ink-800',
                )}
              >
                {p.highlight === 'most_popular' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-saffron-600 px-3 py-1 text-[11px] font-semibold text-white">
                    Most popular
                  </div>
                )}
                <div className="font-display font-semibold text-lg">{p.name}</div>
                <p className="text-xs text-ink-400 mt-1">{p.tagline}</p>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-display text-4xl font-bold">{formatIDR(price)}</span>
                </div>
                <div className="text-xs text-ink-400 mt-1">
                  {periodLabel}{cycle === 'yearly' && ' · billed annually'}
                </div>
                <ul className="mt-5 space-y-2.5 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-ink-200">
                      <Check size={15} className="text-emerald2-400 mt-0.5 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/signup"
                  className={cn(
                    'mt-6 inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold text-sm transition-colors',
                    p.highlight === 'most_popular'
                      ? 'bg-saffron-600 hover:bg-saffron-500 text-white shadow-glow'
                      : 'border border-ink-500 text-ink-100 hover:bg-ink-700',
                  )}
                >
                  Start free trial <ArrowRight size={15} />
                </Link>
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs text-ink-400">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} /> Cancel anytime</span>
          <span className="inline-flex items-center gap-1.5"><Zap size={14} /> Setup in one afternoon</span>
          <span className="inline-flex items-center gap-1.5"><Building2 size={14} /> Multi-venue ready</span>
        </div>

        {/* Feature comparison table */}
        <div className="mt-20">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-center">Compare plans</h2>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-ink-600 bg-ink-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-600">
                  <th className="text-left px-5 py-4 font-medium text-ink-400">Feature</th>
                  {PLANS.map((p) => (
                    <th key={p.id} className="px-5 py-4 text-center font-display font-semibold">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_GROUPS.map((group) => (
                  <>
                    <tr key={group.group} className="bg-ink-850 bg-ink-900/40">
                      <td colSpan={4} className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-saffron-400">
                        {group.group}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label} className="border-b border-ink-700 last:border-0">
                        <td className="px-5 py-3 text-ink-200">{row.label}</td>
                        {row.values.map((v, i) => (
                          <td key={i} className="px-5 py-3 text-center">
                            <CompareCell value={v} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-center">Frequently asked</h2>
          <div className="mt-8 space-y-2">
            {FAQ_ITEMS.map((f, i) => (
              <div key={f.q} className="rounded-2xl border border-ink-600 bg-ink-800 overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="font-medium text-sm">{f.q}</span>
                  <span className={cn('text-ink-400 transition-transform shrink-0', openFaq === i && 'rotate-45')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  </span>
                </button>
                {openFaq === i && <p className="px-5 pb-4 text-sm text-ink-300 leading-relaxed">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}

function CompareCell({ value }: { value: string }) {
  if (value === 'yes') return <Check size={16} className="mx-auto text-emerald2-400" />;
  if (value === 'no') return <X size={16} className="mx-auto text-ink-500" />;
  if (value === '-' || value === '') return <Minus size={16} className="mx-auto text-ink-600" />;
  return <span className="text-ink-200">{value}</span>;
}
