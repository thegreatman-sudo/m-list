import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import {
  Utensils, LogOut, ChevronDown, Bell, Menu as MenuIcon, X,
  Settings as SettingsIcon, User, ChevronRight, Check, Crown,
} from 'lucide-react';
import { cn } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useTenantFromAuth } from '@/lib/tenant';
import { loadBillingState } from '@/lib/saasBilling';
import { PLAN_MAP, formatIdr } from '@/lib/plans';
import type { BillingState } from '@/lib/saasBilling';
import { filterNavForRole, NAV_ITEMS } from '@/lib/nav';
import { Spinner } from '@/components/ui';
import { Wordmark } from '@/components/Wordmark';

export function AppShell() {
  const { tenant, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  let tenantData;
  try {
    tenantData = useTenantFromAuth();
  } catch {
    tenantData = null;
  }

  const [billing, setBilling] = useState<BillingState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [outletMenu, setOutletMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const outletMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tenant) return;
    loadBillingState(tenant).then(setBilling);
  }, [tenant]);

  useEffect(() => {
    setSidebarOpen(false);
    setUserMenu(false);
    setOutletMenu(false);
  }, [location.pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenu(false);
      if (outletMenuRef.current && !outletMenuRef.current.contains(e.target as Node)) setOutletMenu(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!tenant || !tenantData || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const plan = PLAN_MAP[billing?.tenant.plan ?? 'starter'];
  const navItems = filterNavForRole(NAV_ITEMS, profile.role, plan);
  const outlet = tenantData.outlet;
  const restaurantName = outlet?.name ?? tenant.name;
  const isTrial = tenant.status === 'trial';
  const daysLeft = billing?.daysLeftInTrial ?? 0;

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:sticky top-0 z-50 lg:z-30 h-screen w-64 shrink-0 border-r border-ink-700 bg-ink-850 flex flex-col transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="h-16 flex items-center gap-2 px-4 border-b border-ink-700 shrink-0">
          <Link to="/app" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-saffron-600 flex items-center justify-center shadow-glow shrink-0">
              {outlet?.logo_url ? (
                <img src={outlet.logo_url} alt="" className="h-full w-full rounded-lg object-cover" />
              ) : (
                <Utensils size={18} className="text-white" />
              )}
            </div>
            <span className="font-display font-bold text-sm truncate">{restaurantName}</span>
          </Link>
          <button
            className="ml-auto lg:hidden text-ink-400 hover:text-ink-100"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path ||
              (item.path !== '/app' && location.pathname.startsWith(item.path));
            const isUpgrade = item.upgradeBadge;
            return (
              <Link
                key={item.id}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-saffron-600/15 text-saffron-400 border border-saffron-500/30'
                    : 'text-ink-300 hover:bg-ink-700 hover:text-ink-100 border border-transparent'
                )}
              >
                <Icon size={17} className="shrink-0" />
                <span className="truncate">{item.label}</span>
                {isUpgrade && (
                  <span className="ml-auto rounded-full bg-saffron-500/15 text-saffron-400 border border-saffron-500/30 px-1.5 py-0.5 text-[9px] font-semibold shrink-0">
                    UPGRADE
                  </span>
                )}
                {active && !isUpgrade && <ChevronRight size={14} className="ml-auto shrink-0" />}
              </Link>
            );
          })}
        </nav>

        {/* Plan badge at bottom */}
        <div className="p-3 border-t border-ink-700 shrink-0">
          <Link
            to="/billing"
            className="block rounded-xl bg-ink-800 border border-ink-700 p-3 hover:border-saffron-500/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Crown size={14} className="text-saffron-400" />
              <span className="text-sm font-semibold">{plan.name}</span>
              {isTrial && (
                <span className="ml-auto text-[10px] text-saffron-400 font-medium">
                  {daysLeft}d left
                </span>
              )}
            </div>
            <div className="text-xs text-ink-400 mt-1">{formatIdr(plan.priceIdrMonthly)}/mo</div>
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 border-b border-ink-700 bg-ink-900/90 backdrop-blur flex items-center gap-3 px-4">
          <button
            className="lg:hidden text-ink-300 hover:text-ink-100"
            onClick={() => setSidebarOpen(true)}
          >
            <MenuIcon size={20} />
          </button>

          {/* Outlet switcher */}
          <div className="relative" ref={outletMenuRef}>
            <button
              onClick={() => setOutletMenu(!outletMenu)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-ink-800 transition-colors"
            >
              <div className="h-7 w-7 rounded-lg bg-ink-700 border border-ink-600 flex items-center justify-center shrink-0 overflow-hidden">
                {outlet?.logo_url ? (
                  <img src={outlet.logo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Utensils size={14} className="text-saffron-400" />
                )}
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-sm font-medium leading-tight truncate max-w-[180px]">{restaurantName}</div>
                <div className="text-[10px] text-ink-400 leading-tight">{outlet?.name ?? 'No outlet'}</div>
              </div>
              <ChevronDown size={14} className="text-ink-400 shrink-0" />
            </button>
            {outletMenu && (
              <div className="absolute top-full left-0 mt-1 w-56 rounded-xl border border-ink-600 bg-ink-800 shadow-card py-1 z-50">
                <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-ink-400">Outlets</div>
                <div className="px-3 py-2 text-sm text-ink-200 flex items-center gap-2">
                  <Check size={14} className="text-saffron-400" />
                  {outlet?.name ?? 'Default outlet'}
                </div>
                <Link
                  to="/app/settings"
                  className="px-3 py-2 text-sm text-ink-300 hover:bg-ink-700 flex items-center gap-2"
                >
                  <SettingsIcon size={14} /> Manage outlets
                </Link>
              </div>
            )}
          </div>

          {/* Trial/plan badge */}
          {isTrial ? (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-saffron-500/30 bg-saffron-500/10 px-2.5 py-1 text-xs font-medium text-saffron-400">
              Trial · {daysLeft}d left
            </span>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs font-medium text-ink-300">
              {plan.name}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button className="relative rounded-lg p-2 text-ink-300 hover:bg-ink-800 hover:text-ink-100">
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-saffron-500" />
            </button>

            {/* User menu */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenu(!userMenu)}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-ink-800 transition-colors"
              >
                <div className="h-7 w-7 rounded-full bg-ink-700 border border-ink-600 flex items-center justify-center text-xs font-semibold shrink-0">
                  {(profile.full_name || profile.email || '?').charAt(0).toUpperCase()}
                </div>
                <ChevronDown size={14} className="text-ink-400 shrink-0" />
              </button>
              {userMenu && (
                <div className="absolute top-full right-0 mt-1 w-52 rounded-xl border border-ink-600 bg-ink-800 shadow-card py-1 z-50">
                  <div className="px-3 py-2 border-b border-ink-700">
                    <div className="text-sm font-medium truncate">{profile.full_name || 'Owner'}</div>
                    <div className="text-xs text-ink-400 truncate">{profile.email}</div>
                    <div className="text-[10px] text-saffron-400 capitalize mt-0.5">{profile.role}</div>
                  </div>
                  <Link to="/app/settings" className="px-3 py-2 text-sm text-ink-300 hover:bg-ink-700 flex items-center gap-2">
                    <User size={14} /> Profile
                  </Link>
                  <Link to="/app/settings" className="px-3 py-2 text-sm text-ink-300 hover:bg-ink-700 flex items-center gap-2">
                    <SettingsIcon size={14} /> Settings
                  </Link>
                  <button
                    onClick={async () => { await signOut(); navigate('/'); }}
                    className="w-full px-3 py-2 text-sm text-ink-300 hover:bg-ink-700 flex items-center gap-2"
                  >
                    <LogOut size={14} /> Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
