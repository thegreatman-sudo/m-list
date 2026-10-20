import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, ClipboardList, UtensilsCrossed, QrCode, CalendarDays,
  ChefHat, ConciergeBell, CreditCard, Users, BarChart3, UserCog,
  Globe, Package, Music, Settings, Receipt,
} from 'lucide-react';
import type { PlanConfig } from '@/lib/plans';
import type { StaffRole } from '@/types';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  /** Roles that can see this item. Empty = all roles. */
  roles?: StaffRole[];
  /** Feature flag key on PlanConfig.featureFlags that gates this item. */
  featureFlag?: keyof PlanConfig['featureFlags'];
  /** Show an "Upgrade" badge when the plan doesn't include this feature. */
  upgradeBadge?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, path: '/app' },
  { id: 'orders', label: 'Orders', icon: ClipboardList, path: '/app/orders' },
  { id: 'menu', label: 'Menu', icon: UtensilsCrossed, path: '/app/menu' },
  { id: 'tables', label: 'Tables & QR', icon: QrCode, path: '/app/tables' },
  { id: 'reservations', label: 'Reservations', icon: CalendarDays, path: '/app/reservations', featureFlag: 'reservations', upgradeBadge: true },
  { id: 'kitchen', label: 'Kitchen', icon: ChefHat, path: '/app/kitchen', featureFlag: 'kitchenDisplay' },
  { id: 'waiter', label: 'Waiter', icon: ConciergeBell, path: '/app/waiter' },
  { id: 'pos', label: 'POS', icon: CreditCard, path: '/app/pos', featureFlag: 'pos' },
  { id: 'customers', label: 'Customers', icon: Users, path: '/app/customers' },
  { id: 'reports', label: 'Reports', icon: BarChart3, path: '/app/reports' },
  { id: 'staff', label: 'Staff', icon: UserCog, path: '/app/staff' },
  { id: 'website', label: 'Website', icon: Globe, path: '/app/website', featureFlag: 'website' },
  { id: 'inventory', label: 'Inventory', icon: Package, path: '/app/inventory', featureFlag: 'inventory', upgradeBadge: true },
  { id: 'songs', label: 'Song Requests', icon: Music, path: '/app/songs' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/app/settings' },
  { id: 'billing', label: 'Billing', icon: Receipt, path: '/billing' },
];

/** Role → which nav item IDs are visible. Items without `roles` are visible to everyone. */
export const ROLE_ACCESS: Record<StaffRole, string[]> = {
  owner: [], // empty = sees everything
  manager: [],
  chef: ['home', 'orders', 'menu', 'kitchen', 'inventory'],
  waiter: ['home', 'orders', 'waiter'],
  cashier: ['home', 'orders', 'pos', 'customers', 'reports'],
  host: ['home', 'orders', 'reservations'],
  dj: ['home', 'songs'],
};

export function filterNavForRole(
  items: NavItem[],
  role: StaffRole,
  plan: PlanConfig
): NavItem[] {
  const allowed = ROLE_ACCESS[role];
  return items.filter((item) => {
    if (allowed.length > 0 && !allowed.includes(item.id)) return false;
    if (item.featureFlag && !plan.featureFlags[item.featureFlag]) return false;
    return true;
  });
}
