import { MarketingNav, MarketingFooter } from './Landing';
import { APP_NAME, LEGACY_APP_NAME } from '@/config/brand';

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-lg font-semibold text-ink-100 pt-4">{children}</h2>;
}

export function RebrandPage() {
  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <MarketingNav menuOpen={false} setMenuOpen={() => {}} />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="font-display text-3xl font-bold">
          {LEGACY_APP_NAME} is now {APP_NAME}
        </h1>
        <p className="text-xs text-ink-400 mt-2">October 18, 2026</p>

        <div className="mt-8 space-y-4 text-sm text-ink-300 leading-relaxed">
          <p>
            We have renamed {LEGACY_APP_NAME} to {APP_NAME}. It is the same product with the same
            features, the same login, and the same data — nothing about how your restaurant works
            has changed. This page explains what changed and what stayed the same.
          </p>

          <H>What changed</H>
          <ul className="list-disc list-inside space-y-1.5">
            <li>The product name shown in the app, on our website, and in emails is now {APP_NAME}.</li>
            <li>The web address for new QR codes and marketing pages uses the new domain.</li>
            <li>The sender name on emails from us is now "{APP_NAME}" instead of "{LEGACY_APP_NAME}".</li>
          </ul>

          <H>What did not change</H>
          <ul className="list-disc list-inside space-y-1.5">
            <li>Your login email and password are the same.</li>
            <li>Your menu, tables, orders, reservations and staff are untouched.</li>
            <li>Your billing plan, invoices and payment method are unchanged.</li>
            <li>Your restaurant's custom domain (if you set one up) is unaffected.</li>
            <li>Your staff PINs still work.</li>
          </ul>

          <H>Your printed QR codes keep working</H>
          <p>
            QR codes you already printed and placed on tables point to the old web address, and
            those links will keep working indefinitely — you do not need to reprint anything.
            New QR codes generated from your dashboard will use the new domain. Both old and new
            codes open the same ordering page for your guests.
          </p>

          <H>Old links still work</H>
          <p>
            Links to your public restaurant website, to old invoices, and to password-reset emails
            that were sent before the rename all still work. They redirect to the new address
            automatically.
          </p>

          <H>Do I need to do anything?</H>
          <p>
            No. Everything continues to work as before. If you have bookmarks or shortcuts, they
            will redirect to the new address. If you have any questions, email support@menulist.app.
          </p>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
