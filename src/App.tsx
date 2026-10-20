import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { GuestApp } from '@/surfaces/guest/GuestApp';
import { DJApp } from '@/surfaces/dj/DJApp';
import { SongSettingsPage } from '@/surfaces/songs/SongSettingsPage';
import { KDSApp } from '@/surfaces/kds/KDSApp';
import { WaiterApp } from '@/surfaces/waiter/WaiterApp';
import { POSApp } from '@/surfaces/pos/POSApp';
import { ReservationsApp } from '@/surfaces/reservations/ReservationsApp';
import { AdminApp } from '@/surfaces/admin/AdminApp';
import { LandingPage } from '@/pages/Landing';
import { PricingPage } from '@/pages/Pricing';
import { LegalPage } from '@/pages/Legal';
import { AuthPage } from '@/pages/Auth';
import { InventoryApp } from '@/surfaces/inventory/InventoryApp';
import { BillingPage } from '@/surfaces/billing/BillingApp';
import { SuperAdminPage } from '@/surfaces/superadmin/SuperAdminApp';
import { PublicSitePage } from '@/surfaces/public/PublicSite';
import { HelpCenterPage } from '@/pages/HelpCenter';
import { RebrandPage } from '@/pages/Rebrand';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';
import { AppShell } from '@/components/AppShell';
import { HomePage } from '@/pages/app/HomePage';
import { SettingsPage } from '@/pages/app/SettingsPage';
import { PlaceholderPage } from '@/pages/app/PlaceholderPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/terms" element={<LegalPage kind="terms" />} />
      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/help" element={<HelpCenterPage />} />
      <Route path="/rebrand" element={<RebrandPage />} />

      {/* Demo of the product surfaces (no auth) */}
      <Route path="/demo/*" element={<DemoShell />} />

      {/* Authenticated back office */}
      <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<HomePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="kitchen" element={<KDSApp />} />
        <Route path="waiter" element={<WaiterApp />} />
        <Route path="pos" element={<POSApp />} />
        <Route path="reservations" element={<ReservationsApp />} />
        <Route path="tables" element={<AdminApp />} />
        <Route path="menu" element={<AdminApp />} />
        <Route path="songs" element={<SongSettingsPage />} />
        <Route path="inventory" element={<InventoryApp />} />
        <Route path="orders" element={<PlaceholderPage title="Orders" hint="Order list and detail with filters — coming next." />} />
        <Route path="customers" element={<PlaceholderPage title="Customers" />} />
        <Route path="reports" element={<PlaceholderPage title="Reports" />} />
        <Route path="staff" element={<PlaceholderPage title="Staff" hint="Invite and manage your team — coming next." />} />
        <Route path="website" element={<PlaceholderPage title="Website" />} />
      </Route>
      <Route path="/billing" element={<RequireAuth><BillingPage /></RequireAuth>} />
      <Route path="/superadmin" element={<RequireAuth><SuperAdminPage /></RequireAuth>} />

      {/* DJ screen (DJ, Manager, Owner) */}
      <Route path="/dj" element={<DJRoute />} />

      {/* Public restaurant website */}
      <Route path="/r/:slug" element={<PublicSitePage />} />
      <Route path="/r/:slug/*" element={<PublicSitePage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, session } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }
  if (!session) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

// /dj is reachable by owner, manager, and dj roles only.
function DJRoute() {
  const { loading, session, profile } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }
  if (!session) {
    return <Navigate to="/login?next=%2Fdj" replace />;
  }
  const role = profile?.role;
  if (role && !['owner', 'manager', 'dj'].includes(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900 text-ink-100 p-6">
        <div className="text-center max-w-md">
          <Music size={40} className="mx-auto text-rose2-400 mb-3" />
          <div className="font-semibold">DJ screen is for DJ, Manager, and Owner accounts</div>
          <div className="text-sm text-ink-400 mt-1">You're signed in as {role}.</div>
        </div>
      </div>
    );
  }
  return <DJApp />;
}

// ---- Demo shell: the original hash-nav product demo, mounted under /demo
type Surface = 'home' | 'guest' | 'kds' | 'waiter' | 'pos' | 'reservations' | 'admin';

interface NavItem {
  id: Surface;
  label: string;
  icon: typeof Utensils;
  hint: string;
}

const NAV: NavItem[] = [
  { id: 'home', label: 'Overview', icon: LayoutGrid, hint: 'Pick a surface' },
  { id: 'guest', label: 'Guest QR', icon: QrCode, hint: 'Order from a table' },
  { id: 'kds', label: 'Kitchen', icon: ChefHat, hint: 'KDS tickets' },
  { id: 'waiter', label: 'Waiter', icon: ConciergeBell, hint: 'Floor & bells' },
  { id: 'pos', label: 'POS', icon: CreditCard, hint: 'Bills & payments' },
  { id: 'reservations', label: 'Reservations', icon: CalendarDays, hint: 'Booking book' },
  { id: 'admin', label: 'Admin', icon: Utensils, hint: 'Setup & menu' },
];

function parseHash(): Surface {
  const h = window.location.hash.replace('#/', '').replace('#', '');
  const valid: Surface[] = ['home', 'guest', 'kds', 'waiter', 'pos', 'reservations', 'admin'];
  return (valid.includes(h as Surface) ? h : 'home') as Surface;
}

function DemoShell() {
  const [surface, setSurface] = useState<Surface>(() => parseHash());
  const navigate = useNavigate();

  useEffect(() => {
    const onHash = () => setSurface(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (s: Surface) => {
    window.location.hash = `/${s}`;
    setSurface(s);
  };

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100 flex flex-col">
      <DemoTopNav surface={surface} go={go} onExit={() => navigate('/')} />
      <main className="flex-1">
        {surface === 'home' && <DemoHome go={go} />}
        {surface === 'guest' && <GuestApp />}
        {surface === 'kds' && <KDSApp />}
        {surface === 'waiter' && <WaiterApp />}
        {surface === 'pos' && <POSApp />}
        {surface === 'reservations' && <ReservationsApp />}
        {surface === 'admin' && <AdminApp />}
      </main>
    </div>
  );
}

import { useEffect, useState } from 'react';

function DemoTopNav({ surface, go, onExit }: { surface: Surface; go: (s: Surface) => void; onExit: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-600 bg-ink-900/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 h-14">
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="MenuList home">
          <div className="h-8 w-8 rounded-lg bg-saffron-600 flex items-center justify-center shadow-glow">
            <Utensils size={18} className="text-white" />
          </div>
          <div className="font-display font-bold text-base hidden sm:block">
            <Wordmark />
          </div>
        </Link>
        <nav className="ml-2 flex items-center gap-0.5 overflow-x-auto df-no-scrollbar">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = surface === n.id;
            return (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                  active ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                )}
              >
                <Icon size={15} className={active ? 'text-saffron-500' : ''} />
                <span className="hidden sm:inline">{n.label}</span>
              </button>
            );
          })}
        </nav>
        <button onClick={onExit} className="ml-auto text-sm text-ink-300 hover:text-ink-100 px-3 py-1.5 rounded-lg hover:bg-ink-800">
          Exit demo
        </button>
      </div>
    </header>
  );
}

function DemoHome({ go }: { go: (s: Surface) => void }) {
  const cards: { n: NavItem; desc: string; accent: string }[] = [
    { n: NAV[1], desc: 'Scan a table QR, browse the menu, send an order to the kitchen, call the waiter and pay — exactly what a guest sees on their phone.', accent: 'from-saffron-600/20 to-saffron-600/5' },
    { n: NAV[2], desc: 'Live kitchen tickets per station with elapsed timers, accept / start / ready / reject actions, allergy alerts and prep summary.', accent: 'from-rose2-500/20 to-rose2-500/5' },
    { n: NAV[3], desc: 'Floor map with live table status, bell-call alerts, take orders for guests, mark items served and fire courses.', accent: 'from-sky2-500/20 to-sky2-500/5' },
    { n: NAV[4], desc: 'Cashier screen with open bills, split payment, mixed tender, discounts, voids and end-of-shift Z report.', accent: 'from-emerald2-500/20 to-emerald2-500/5' },
    { n: NAV[5], desc: 'Reservation book by day, guest booking flow with live table availability, check-in / seat / no-show handling.', accent: 'from-amber2-500/20 to-amber2-500/5' },
    { n: NAV[6], desc: 'Owner setup: areas & tables, QR code print kit, menu management with modifiers, opening hours and reports.', accent: 'from-ink-500/40 to-ink-700/10' },
  ];
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:py-16">
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-saffron-500/30 bg-saffron-500/10 px-3 py-1 text-xs font-medium text-saffron-400 mb-5">
          <span className="h-1.5 w-1.5 rounded-full bg-saffron-500 df-pulse" />
          Live demo · Saffron &amp; Smoke
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1]">
          One system for the whole restaurant.
        </h1>
        <p className="mt-4 text-lg text-ink-300 leading-relaxed">
          QR ordering, kitchen display, POS, waiter app and reservations — running on
          one shared real-time engine. Pick a surface below to see exactly what each
          role sees. Orders flow live between screens.
        </p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ n, desc, accent }) => {
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className="group text-left rounded-2xl border border-ink-600 bg-ink-800 hover:border-saffron-500/40 hover:bg-ink-700 transition-all overflow-hidden df-slide-up"
            >
              <div className={cn('h-24 bg-gradient-to-br flex items-end p-4', accent)}>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-ink-900/60 border border-ink-600 flex items-center justify-center group-hover:border-saffron-500/40 transition-colors">
                    <Icon size={20} className="text-saffron-400" />
                  </div>
                  <div>
                    <div className="font-display font-semibold">{n.label}</div>
                    <div className="text-xs text-ink-400">{n.hint}</div>
                  </div>
                </div>
              </div>
              <div className="p-4 text-sm text-ink-300 leading-relaxed">{desc}</div>
              <div className="px-4 pb-4 text-sm font-medium text-saffron-400 inline-flex items-center gap-1">
                Open
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:translate-x-0.5 transition-transform">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
