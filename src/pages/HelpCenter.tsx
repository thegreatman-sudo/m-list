import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LifeBuoy, Search } from 'lucide-react';
import { MarketingNav, MarketingFooter } from './Landing';
import { cn } from '@/lib/format';
import { APP_NAME, APP_DOMAIN } from '@/config/brand';

const CATEGORIES = [
  {
    title: 'Getting started',
    articles: [
      { q: 'How do I set up my restaurant?', a: 'After signing up, the onboarding wizard walks you through adding your first outlet, areas, tables and menu items. You can also invite staff and print QR codes from the Admin tab in your dashboard.' },
      { q: 'How long is the free trial?', a: 'Every new account gets 14 days of full access to the Growth plan, with no card required. Pick a plan in Billing any time before or after the trial ends.' },
      { q: 'How do I print QR codes for my tables?', a: 'In your dashboard, open Admin → Floor plan, click the printer icon on any area, and print the table tents. Each table has a unique, permanent QR code.' },
    ],
  },
  {
    title: 'Billing & plans',
    articles: [
      { q: 'What happens when my trial ends?', a: 'If you have not picked a plan, your dashboard becomes read-only — you can still see your data, but you cannot take new orders. Pick a plan in Billing to restore full access. Your data is never deleted during this period.' },
      { q: 'Can I upgrade or downgrade later?', a: 'Yes, any time from Billing. Upgrades take effect immediately; downgrades take effect at the end of your current billing period.' },
      { q: 'How do I cancel?', a: 'Open Billing → Manage subscription (the Stripe customer portal) and cancel. Your subscription stops at the end of the current period with no penalty.' },
      { q: 'What payment methods do you accept?', a: 'We accept major credit and debit cards through Stripe. For Chain plans billed annually, bank transfer can be arranged — contact sales.' },
    ],
  },
  {
    title: 'Staff & PINs',
    articles: [
      { q: 'How do staff log in on a shared tablet?', a: 'Staff can sign in with email + password, or with a 4–6 digit PIN if you assigned one when inviting them. PINs are hashed and never stored in plain text.' },
      { q: 'How do I invite a waiter or chef?', a: 'In your dashboard go to Staff → Invite. Enter their email and role. They will get an email invite and set their own PIN on first sign-in.' },
    ],
  },
  {
    title: 'My restaurant website',
    articles: [
      { q: 'How do I publish my public website?', a: 'In Settings → Website, toggle "Published" on. Your site appears at /r/your-slug (and on your custom domain once you add one).' },
      { q: 'Can I use my own domain?', a: 'Yes, on the Growth and Chain plans. Enter your domain in Settings → Website and we will guide you through pointing your DNS to MenuList.' },
    ],
  },
];

export function HelpCenterPage() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const filtered = CATEGORIES.map((c) => ({
    ...c,
    articles: c.articles.filter(
      (a) => !query || a.q.toLowerCase().includes(query.toLowerCase()) || a.a.toLowerCase().includes(query.toLowerCase()),
    ),
  })).filter((c) => c.articles.length > 0);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <MarketingNav menuOpen={false} setMenuOpen={() => {}} />
      <div className="mx-auto max-w-4xl px-4 py-14">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-saffron-600/15 border border-saffron-500/30 flex items-center justify-center mb-4">
            <LifeBuoy size={22} className="text-saffron-400" />
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold">Help Center</h1>
          <p className="mt-2 text-ink-400">Find answers to common questions about {APP_NAME}.</p>
        </div>

        <div className="mt-8 relative max-w-xl mx-auto">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles…"
            className="w-full h-12 rounded-xl bg-ink-800 border border-ink-600 pl-10 pr-4 text-sm focus:border-saffron-500 focus:outline-none"
          />
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {filtered.map((cat) => (
            <div key={cat.title}>
              <h2 className="font-display font-semibold text-lg mb-3">{cat.title}</h2>
              <div className="space-y-2">
                {cat.articles.map((a) => {
                  const key = cat.title + a.q;
                  const isOpen = open === key;
                  return (
                    <div key={a.q} className="rounded-xl border border-ink-600 bg-ink-800 overflow-hidden">
                      <button
                        onClick={() => setOpen(isOpen ? null : key)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                      >
                        <span className="text-sm font-medium">{a.q}</span>
                        <ChevronDown size={16} className={cn('text-ink-400 shrink-0 transition-transform', isOpen && 'rotate-180')} />
                      </button>
                      {isOpen && <p className="px-4 pb-4 text-sm text-ink-300 leading-relaxed">{a.a}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="mt-10 text-center text-ink-400">
            No articles match "{query}". <Link to="/signup" className="text-saffron-400 hover:text-saffron-300">Contact support</Link>.
          </div>
        )}

        <div className="mt-14 rounded-2xl border border-ink-600 bg-ink-800 p-6 text-center">
          <h3 className="font-display font-semibold">Still need help?</h3>
          <p className="mt-1.5 text-sm text-ink-400">Email us at support@{APP_DOMAIN} and we will get back to you within one business day.</p>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
