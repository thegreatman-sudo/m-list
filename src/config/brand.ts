// Central brand configuration. Every place that shows the product name or
// domain imports from here so a future rename is a one-line change.

export const APP_NAME = 'MenuList';
export const APP_TAGLINE = 'QR ordering, kitchen, POS & reservations — one platform.';
export const APP_DOMAIN = (import.meta.env.VITE_APP_DOMAIN as string) || 'menulist.app';
export const LEGACY_APP_NAME = 'DineFlow';
export const LEGACY_DOMAIN = (import.meta.env.VITE_LEGACY_DOMAIN as string) || 'dineflow.app';
export const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string) || 'support@menulist.app';

// Used in emails and receipts generated server-side.
// Mirrors the brand config so edge functions can reference the same values.
export const BRAND = {
  name: APP_NAME,
  tagline: APP_TAGLINE,
  domain: APP_DOMAIN,
  legacyName: LEGACY_APP_NAME,
  legacyDomain: LEGACY_DOMAIN,
  supportEmail: SUPPORT_EMAIL,
};
