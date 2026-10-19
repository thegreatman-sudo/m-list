// Single source of truth for plans, prices, and limits.
// Edit prices and limits here only. Both the pricing page and the
// super-admin console read from this config (and the super-admin
// console can additionally override the stored prices per-row in DB).

export type PlanId = 'starter' | 'growth' | 'chain';
export type BillingCycle = 'monthly' | 'yearly';

export interface PlanFeature {
  label: string;
  included: boolean;
}

export interface PlanConfig {
  id: PlanId;
  name: string;
  tagline: string;
  /** Price in IDR per month (yearly = monthly * 10, i.e. 2 months free). */
  priceIdrMonthly: number;
  highlight?: 'most_popular';
  description: string;
  features: string[];
  /** Hard limits used for soft-limit checks in the dashboard. */
  limits: {
    outlets: number; // 0 = unlimited
    tables: number; // 0 = unlimited
    staff: number; // 0 = unlimited
  };
  featureFlags: {
    qrOrdering: boolean;
    kitchenDisplay: boolean;
    pos: boolean;
    website: boolean;
    reservations: boolean;
    loyalty: boolean;
    inventory: boolean;
    customDomain: boolean;
    multiOutlet: boolean;
    centralMenu: boolean;
    multiOutletReports: boolean;
    apiAccess: boolean;
  };
}

export const PLANS: PlanConfig[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For a single café or small restaurant getting started.',
    priceIdrMonthly: 199_000,
    description: 'Everything to run one outlet with QR ordering.',
    features: [
      '1 outlet',
      'Up to 10 tables',
      'QR ordering',
      'Kitchen display',
      'POS',
      'Restaurant website',
      '3 staff accounts',
    ],
    limits: { outlets: 1, tables: 10, staff: 3 },
    featureFlags: {
      qrOrdering: true,
      kitchenDisplay: true,
      pos: true,
      website: true,
      reservations: false,
      loyalty: false,
      inventory: false,
      customDomain: false,
      multiOutlet: false,
      centralMenu: false,
      multiOutletReports: false,
      apiAccess: false,
    },
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For busy restaurants running full service.',
    priceIdrMonthly: 499_000,
    highlight: 'most_popular',
    description: 'Add reservations, loyalty, inventory and unlimited staff.',
    features: [
      'Everything in Starter, plus:',
      'Reservations',
      'Loyalty program',
      'Inventory tracking',
      'Unlimited staff accounts',
      'Custom domain',
    ],
    limits: { outlets: 1, tables: 0, staff: 0 },
    featureFlags: {
      qrOrdering: true,
      kitchenDisplay: true,
      pos: true,
      website: true,
      reservations: true,
      loyalty: true,
      inventory: true,
      customDomain: true,
      multiOutlet: false,
      centralMenu: false,
      multiOutletReports: false,
      apiAccess: false,
    },
  },
  {
    id: 'chain',
    name: 'Chain',
    tagline: 'For groups running several venues.',
    priceIdrMonthly: 1_299_000,
    description: 'Multi-outlet with a central menu and consolidated reports.',
    features: [
      'Everything in Growth, plus:',
      'Multi-outlet management',
      'Central menu sync',
      'Multi-outlet reports',
      'API access',
    ],
    limits: { outlets: 0, tables: 0, staff: 0 },
    featureFlags: {
      qrOrdering: true,
      kitchenDisplay: true,
      pos: true,
      website: true,
      reservations: true,
      loyalty: true,
      inventory: true,
      customDomain: true,
      multiOutlet: true,
      centralMenu: true,
      multiOutletReports: true,
      apiAccess: true,
    },
  },
];

export const PLAN_MAP: Record<PlanId, PlanConfig> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, PlanConfig>;

export const DEFAULT_PLAN: PlanId = 'starter';
export const TRIAL_DAYS = 14;

export function priceForCycle(plan: PlanConfig, cycle: BillingCycle): number {
  if (cycle === 'yearly') return plan.priceIdrMonthly * 10; // 2 months free
  return plan.priceIdrMonthly;
}

export function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Rows of the feature comparison table on /pricing.
export interface CompareRow {
  label: string;
  values: [string, string, string]; // one display value per plan
}

export const COMPARE_GROUPS: { group: string; rows: CompareRow[] }[] = [
  {
    group: 'Core operations',
    rows: [
      { label: 'Outlets', values: ['1', '1', 'Unlimited'] },
      { label: 'Tables', values: ['Up to 10', 'Unlimited', 'Unlimited'] },
      { label: 'QR ordering', values: ['yes', 'yes', 'yes'] },
      { label: 'Kitchen display', values: ['yes', 'yes', 'yes'] },
      { label: 'POS & payments', values: ['yes', 'yes', 'yes'] },
      { label: 'Restaurant website', values: ['yes', 'yes', 'yes'] },
    ],
  },
  {
    group: 'Growth features',
    rows: [
      { label: 'Reservations', values: ['no', 'yes', 'yes'] },
      { label: 'Loyalty program', values: ['no', 'yes', 'yes'] },
      { label: 'Inventory tracking', values: ['no', 'yes', 'yes'] },
      { label: 'Staff accounts', values: ['3', 'Unlimited', 'Unlimited'] },
      { label: 'Custom domain', values: ['no', 'yes', 'yes'] },
    ],
  },
  {
    group: 'Chain features',
    rows: [
      { label: 'Multi-outlet management', values: ['no', 'no', 'yes'] },
      { label: 'Central menu sync', values: ['no', 'no', 'yes'] },
      { label: 'Multi-outlet reports', values: ['no', 'no', 'yes'] },
      { label: 'API access', values: ['no', 'no', 'yes'] },
    ],
  },
];

export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What happens during the 14-day free trial?',
    a: 'You get full access to every feature on the Growth plan — no card required. At the end of the trial you pick the plan that fits. Your data stays safe either way.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Yes, upgrade or downgrade anytime from Billing in your dashboard. Changes are prorated automatically.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept major credit and debit cards through Stripe. For Chain plans billed annually we can also arrange bank transfer — contact sales.',
  },
  {
    q: 'Do prices include tax?',
    a: 'Prices are in Indonesian Rupiah (IDR) and exclude applicable taxes such as PPN 11%, which is added at checkout where required by law.',
  },
  {
    q: 'Is my restaurant data isolated from others?',
    a: 'Yes. Every restaurant lives in its own secure space. No other restaurant — or anyone else — can see your menu, orders, or revenue.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel from the Billing page and your subscription stops at the end of the current billing period. No penalties, no questions.',
  },
];
