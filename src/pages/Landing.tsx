import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Utensils, QrCode, ChefHat, ConciergeBell, CreditCard, CalendarDays, Globe,
  Check, ArrowRight, Smartphone, Monitor, Bell, BarChart3, ShieldCheck, Zap,
  Menu as MenuIcon, X,
} from 'lucide-react';
import { cn } from '@/lib/format';
import { APP_NAME } from '@/config/brand';
import { Wordmark } from '@/components/Wordmark';

const FEATURES = [
  { icon: QrCode, name: 'QR ordering', desc: 'Guests scan, browse, and order from their phone. No app to download, no waiting for a waiter.', accent: 'text-saffron-400 bg-saffron-500/10 border-saffron-500/30' },
  { icon: ChefHat, name: 'Kitchen display', desc: 'Live tickets per station with timers, allergy alerts, and one-tap progress updates.', accent: 'text-rose2-400 bg-rose2-500/10 border-rose2-500/30' },
  { icon: ConciergeBell, name: 'Waiter app', desc: 'Bell calls, floor map, ready-to-serve items and table-side order taking.', accent: 'text-sky2-400 bg-sky2-500/10 border-sky2-500/30' },
  { icon: CreditCard, name: 'POS', desc: 'Open bills, split payments, discounts and an end-of-day Z report.', accent: 'text-emerald2-400 bg-emerald2-500/10 border-emerald2-500/30' },
  { icon: CalendarDays, name: 'Reservations', desc: 'Booking widget with live availability, a daily reservation book, and no-show tracking.', accent: 'text-amber2-400 bg-amber2-500/10 border-amber2-500/30' },
  { icon: Globe, name: 'Restaurant website', desc: 'A free public site with your menu, hours, and a booking link — published in one click.', accent: 'text-ink-300 bg-ink-600/40 border-ink-500/40' },
];

const STEPS = [
  { icon: Monitor, title: '1. Set up in minutes', desc: 'Add your areas and tables, import or type your menu, and invite your staff. The onboarding wizard walks you through it.' },
  { icon: QrCode, title: '2. Print your QR codes', desc: 'Every table gets a unique QR code. Print them as stickers or table tents and place them on the tables.' },
  { icon: Zap, title: '3. Go live', desc: 'Guests scan and order. Orders fly to the kitchen, waiters see calls instantly, and the POS closes the bill.' },
];

const TESTIMONIALS = [
  { quote: 'We stopped printing menus and stopped losing orders. The kitchen tickets alone paid for it in the first week.', name: 'Rani Wijaya', role: 'Owner, Saffron & Smoke' },
  { quote: 'Bell calls on the waiter app changed our floor. Guests get helped faster and we run more covers per shift.', name: 'Marco T.', role: 'General Manager, Bistro 88' },
  { quote: 'Setup took one afternoon. The QR codes, the menu, the reservations — everything just worked.', name: 'Ana P.', role: 'Owner, Casa Verde' },
];

const FAQ = [
  { q: 'Do my guests need to install an app?', a: 'No. They scan the QR code on the table with their phone camera and the menu opens right in the browser.' },
  { q: 'What happens after the free trial?', a: 'The 14-day trial needs no card. When it ends you pick a plan in Billing. Your data stays safe either way.' },
  { q: 'Can my staff share a tablet?', a: 'Yes. Chefs, waiters, cashiers and hosts can sign in with a 4-6 digit PIN on shared tablets, or with email and password.' },
  { q: 'Is my restaurant data isolated from others?', a: 'Yes. Every restaurant lives in its own secure space. No other restaurant — or anyone else — can see your menu, orders, or revenue.' },
  { q: 'Can I keep using my printed menu?', a: 'Sure. The QR menu is live the moment you edit it, but nothing stops you from also keeping printed menus.' },
  { q: 'What payment methods can I accept?', a: 'QRIS/e-wallets, cards, cash, bank transfer and vouchers are built in. Configure which ones you accept in Settings.' },
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [hash]);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <MarketingNav menuOpen={menuOpen} setMenuOpen={setMenuOpen} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 df-hero-glow pointer-events-none" />
        <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-saffron-500/30 bg-saffron-500/10 px-4 py-1.5 text-xs font-medium text-saffron-400 mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-saffron-500 df-pulse" />
            Replace your printed menu, order pads, ticket printer and cash register
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-bold leading-[1.08] max-w-3xl mx-auto">
            One system for the <span className="text-saffron-500">whole restaurant</span>
          </h1>
          <p className="mt-5 text-lg text-ink-300 leading-relaxed max-w-2xl mx-auto">
            QR ordering at the table, kitchen display, waiter bell, POS, reservations and a
            free restaurant website — all in one real-time system your whole team shares.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white font-semibold shadow-glow transition-colors"
            >
              Start free trial <ArrowRight size={16} />
            </Link>
            <Link
              to="/demo"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl border border-ink-500 text-ink-100 font-semibold hover:bg-ink-800 transition-colors"
            >
              Try the live demo
            </Link>
          </div>
          <div className="mt-4 text-xs text-ink-400">14 days free · No card required · Set up in one afternoon</div>

          <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto">
            {[
              { icon: Smartphone, label: 'Guest QR ordering' },
              { icon: ChefHat, label: 'Kitchen display' },
              { icon: Bell, label: 'Waiter calls' },
              { icon: BarChart3, label: 'Sales reports' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-2xl border border-ink-600 bg-ink-800/70 p-4 flex flex-col items-center gap-2">
                <Icon size={20} className="text-saffron-400" />
                <span className="text-xs text-ink-300">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="font-display text-3xl sm:text-4xl font-bold text-center">Everything your floor needs</h2>
        <p className="text-center text-ink-400 mt-3 max-w-xl mx-auto">
          Six tools that usually cost six subscriptions — running on one shared, real-time engine.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, name, desc, accent }) => (
            <div key={name} className="rounded-2xl border border-ink-600 bg-ink-800 p-6 hover:border-ink-500 transition-colors">
              <div className={cn('h-11 w-11 rounded-xl border flex items-center justify-center mb-4', accent)}>
                <Icon size={20} />
              </div>
              <h3 className="font-display font-semibold text-lg">{name}</h3>
              <p className="mt-2 text-sm text-ink-300 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-ink-700 bg-ink-850 bg-ink-800/40">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-center">Live in three steps</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="relative rounded-2xl border border-ink-600 bg-ink-800 p-6">
                <div className="h-10 w-10 rounded-xl bg-saffron-600/15 border border-saffron-500/30 flex items-center justify-center mb-4">
                  <Icon size={18} className="text-saffron-400" />
                </div>
                <h3 className="font-display font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-ink-300 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product screenshots */}
      <section id="product" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="font-display text-3xl sm:text-4xl font-bold text-center">See every screen</h2>
        <p className="text-center text-ink-400 mt-3">The demo below is the real product, running on live data.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ScreenCard to="/demo" title="Guest QR ordering" desc="What your guests see on their phone" icon={Smartphone} />
          <ScreenCard to="/demo" title="Kitchen display" desc="Live tickets, timers, allergy alerts" icon={ChefHat} />
          <ScreenCard to="/demo" title="Waiter app" desc="Calls, floor map, table-side ordering" icon={ConciergeBell} />
          <ScreenCard to="/demo" title="POS" desc="Bills, split payments, Z report" icon={CreditCard} />
          <ScreenCard to="/demo" title="Reservations" desc="Booking book with live availability" icon={CalendarDays} />
          <ScreenCard to="/demo" title="Admin dashboard" desc="Menu, tables, QR printing, reports" icon={Utensils} />
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-y border-ink-700 bg-ink-800/40">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-center">Restaurants run on {APP_NAME}</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure key={t.name} className="rounded-2xl border border-ink-600 bg-ink-800 p-6 flex flex-col">
                <div className="flex gap-1 mb-3">
                  {[0, 1, 2, 3, 4].map((i) => <Check key={i} size={13} className="text-saffron-400" />)}
                </div>
                <blockquote className="text-sm text-ink-200 leading-relaxed flex-1">"{t.quote}"</blockquote>
                <figcaption className="mt-4 text-xs text-ink-400">
                  <span className="font-semibold text-ink-200">{t.name}</span> · {t.role}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
        <h2 className="font-display text-3xl sm:text-4xl font-bold text-center">Frequently asked</h2>
        <div className="mt-10 space-y-2">
          {FAQ.map((f, i) => (
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
              {openFaq === i && (
                <p className="px-5 pb-4 text-sm text-ink-300 leading-relaxed">{f.a}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-saffron-500/30 bg-gradient-to-br from-saffron-600/15 via-ink-800 to-ink-800 p-10 sm:p-14 text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-bold">Ready to retire the paper?</h2>
          <p className="mt-3 text-ink-300 max-w-xl mx-auto">
            Start your 14-day free trial today. No card required — you only pay if {APP_NAME} works for your restaurant.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white font-semibold shadow-glow transition-colors"
            >
              Start free trial <ArrowRight size={16} />
            </Link>
            <Link
              to="/demo"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl border border-ink-500 text-ink-100 font-semibold hover:bg-ink-700 transition-colors"
            >
              Explore the demo
            </Link>
          </div>
          <div className="mt-4 flex items-center justify-center gap-4 text-xs text-ink-400">
            <span className="inline-flex items-center gap-1"><ShieldCheck size={13} /> Data isolated per restaurant</span>
            <span className="inline-flex items-center gap-1"><Check size={13} /> Cancel anytime</span>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function ScreenCard({ to, title, desc, icon: Icon }: { to: string; title: string; desc: string; icon: typeof QrCode }) {
  return (
    <Link to={to} className="group rounded-2xl border border-ink-600 bg-ink-800 p-5 hover:border-saffron-500/40 transition-colors">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center group-hover:border-saffron-500/40">
          <Icon size={18} className="text-saffron-400" />
        </div>
        <div>
          <div className="font-display font-semibold">{title}</div>
          <div className="text-xs text-ink-400">{desc}</div>
        </div>
        <ArrowRight size={15} className="ml-auto text-ink-500 group-hover:text-saffron-400 transition-colors" />
      </div>
    </Link>
  );
}

export function MarketingNav({ menuOpen, setMenuOpen }: { menuOpen: boolean; setMenuOpen: (v: boolean) => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="h-8 w-8 rounded-lg bg-saffron-600 flex items-center justify-center shadow-glow">
            <Utensils size={18} className="text-white" />
          </div>
          <div className="font-display font-bold text-base"><Wordmark /></div>
        </Link>
        <nav className="ml-6 hidden md:flex items-center gap-6 text-sm text-ink-300">
          <a href="#features" className="hover:text-ink-100 transition-colors">Features</a>
          <a href="#pricing" className="hover:text-ink-100 transition-colors">Pricing</a>
          <Link to="/demo" className="hover:text-ink-100 transition-colors">Demo</Link>
          <Link to="/site/the-restaurant" className="hover:text-ink-100 transition-colors">Websites</Link>
        </nav>
        <div className="ml-auto hidden md:flex items-center gap-2">
          <Link to="/login" className="h-10 px-4 inline-flex items-center rounded-xl text-sm font-medium text-ink-200 hover:bg-ink-800 transition-colors">
            Log in
          </Link>
          <Link to="/signup" className="h-10 px-4 inline-flex items-center rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white text-sm font-semibold shadow-glow transition-colors">
            Start free trial
          </Link>
        </div>
        <button className="ml-auto md:hidden rounded-lg p-2 text-ink-200 hover:bg-ink-800" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          {menuOpen ? <X size={20} /> : <MenuIcon size={20} />}
        </button>
      </div>
      {menuOpen && (
        <div className="md:hidden border-t border-ink-700 bg-ink-900 px-4 py-3 space-y-1">
          <a href="#features" onClick={() => setMenuOpen(false)} className="block px-3 py-2 rounded-lg text-sm text-ink-200 hover:bg-ink-800">Features</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)} className="block px-3 py-2 rounded-lg text-sm text-ink-200 hover:bg-ink-800">Pricing</a>
          <Link to="/demo" onClick={() => setMenuOpen(false)} className="block px-3 py-2 rounded-lg text-sm text-ink-200 hover:bg-ink-800">Demo</Link>
          <Link to="/login" onClick={() => setMenuOpen(false)} className="block px-3 py-2 rounded-lg text-sm text-ink-200 hover:bg-ink-800">Log in</Link>
          <Link to="/signup" onClick={() => setMenuOpen(false)} className="block px-3 py-2.5 rounded-xl bg-saffron-600 text-white text-sm font-semibold text-center mt-2">Start free trial</Link>
        </div>
      )}
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-ink-700 bg-ink-850">
      <div className="mx-auto max-w-6xl px-4 py-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-saffron-600 flex items-center justify-center">
              <Utensils size={15} className="text-white" />
            </div>
            <div className="font-display font-bold"><Wordmark /></div>
          </div>
          <p className="mt-3 text-xs text-ink-400 leading-relaxed">
            One system for the whole restaurant. QR ordering, kitchen, waiter, POS and reservations.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">Product</div>
          <div className="space-y-2 text-sm">
            <a href="#features" className="block text-ink-300 hover:text-ink-100">Features</a>
            <a href="#pricing" className="block text-ink-300 hover:text-ink-100">Pricing</a>
            <Link to="/demo" className="block text-ink-300 hover:text-ink-100">Live demo</Link>
            <Link to="/site/the-restaurant" className="block text-ink-300 hover:text-ink-100">Restaurant websites</Link>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">Company</div>
          <div className="space-y-2 text-sm">
            <Link to="/privacy" className="block text-ink-300 hover:text-ink-100">Privacy policy</Link>
            <Link to="/terms" className="block text-ink-300 hover:text-ink-100">Terms of service</Link>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">Get started</div>
          <div className="space-y-2 text-sm">
            <Link to="/signup" className="block text-ink-300 hover:text-ink-100">Start free trial</Link>
            <Link to="/login" className="block text-ink-300 hover:text-ink-100">Log in</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-ink-700 py-5 text-center text-xs text-ink-500">
        © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
      </div>
    </footer>
  );
}
