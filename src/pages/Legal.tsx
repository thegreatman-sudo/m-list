import { MarketingNav, MarketingFooter } from './Landing';
import { APP_NAME, SUPPORT_EMAIL, APP_DOMAIN } from '@/config/brand';

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  return kind === 'privacy' ? <PrivacyPage /> : <TermsPage />;
}

function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <MarketingNav menuOpen={false} setMenuOpen={() => {}} />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="text-xs text-ink-400 mt-2">Last updated: {updated}</p>
        <div className="mt-8 space-y-6 text-sm text-ink-300 leading-relaxed">{children}</div>
      </div>
      <MarketingFooter />
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-lg font-semibold text-ink-100 pt-2">{children}</h2>;
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy policy" updated="October 18, 2026">
      <H>What we collect</H>
      <p>
        When you create a {APP_NAME} account we store your name, email, restaurant name, and the
        content you add to your restaurant (menu, tables, orders, reservations). Guests who order
        from a table QR code do not need an account; we store only the order and booking details
        they enter.
      </p>
      <H>How we use it</H>
      <p>
        Your data is used to run the service: showing menus to your guests, routing orders to your
        kitchen, and producing your reports. We do not sell your data or use it for advertising.
      </p>
      <H>Who can see your restaurant's data</H>
      <p>
        Only the staff accounts you invite. Each restaurant's data is isolated with row-level
        security — other restaurants on {APP_NAME} cannot access it, and neither can the public.
      </p>
      <H>Guest data</H>
      <p>
        Reservation and order details (names, phone numbers) are stored so your team can serve
        guests. You are responsible for handling that data in line with your local regulations.
      </p>
      <H>Data retention and deletion</H>
      <p>
        You can delete menu items, tables and staff at any time. To delete your whole account and
        restaurant data, contact support. We delete production backups on a rolling 30-day cycle.
      </p>
      <H>Contact</H>
      <p>Questions about this policy? Email privacy@{APP_DOMAIN}.</p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of service" updated="October 18, 2026">
      <H>Using {APP_NAME}</H>
      <p>
        {APP_NAME} provides restaurant management software: QR ordering, kitchen display, waiter app,
        point of sale, reservations, and restaurant websites. You may use it only for venues you
        own or operate.
      </p>
      <H>Free trial and billing</H>
      <p>
        New accounts start with a 14-day free trial with no payment details required. When the
        trial ends, choose a plan to keep using paid features. If you do not, your account becomes
        read-only and your data is retained for 90 days before deletion.
      </p>
      <H>Your responsibilities</H>
      <p>
        You are responsible for the accuracy of your menu and prices, for handling guest data in
        line with applicable law, and for keeping your staff accounts and PINs secure.
      </p>
      <H>Availability</H>
      <p>
        We aim for high availability but do not guarantee uninterrupted service. Planned maintenance
        is announced in advance where possible.
      </p>
      <H>Termination</H>
      <p>
        You may cancel at any time from Billing. We may suspend accounts that abuse the service or
        endanger other tenants' data.
      </p>
      <H>Contact</H>
      <p>Questions about these terms? Email legal@{APP_DOMAIN}.</p>
    </LegalShell>
  );
}
