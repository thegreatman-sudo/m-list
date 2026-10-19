// Shared Midtrans Snap utilities for the browser.
// Loads the Snap.js script once, then provides helpers to open the popup
// and check payment status after it closes.

import { supabase, SUPABASE_URL } from '@/lib/supabase';

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        callbacks: {
          onSuccess?: (result: unknown) => void;
          onPending?: (result: unknown) => void;
          onError?: (result: unknown) => void;
          onClose?: () => void;
        }
      ) => void;
    };
    _snapLoader?: Promise<void>;
  }
}

const SNAP_SANDBOX = 'https://app.sandbox.midtrans.com/snap/snap.js';
const SNAP_PRODUCTION = 'https://app.midtrans.com/snap/snap.js';

/**
 * Loads the Midtrans Snap.js script with the given client key.
 * Safe to call multiple times — the script is loaded once.
 */
export function loadSnapScript(clientKey: string, isProduction: boolean): Promise<void> {
  if (window.snap) return Promise.resolve();
  if (window._snapLoader) return window._snapLoader;

  window._snapLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = isProduction ? SNAP_PRODUCTION : SNAP_SANDBOX;
    script.setAttribute('data-client-key', clientKey);
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Midtrans Snap'));
    document.head.appendChild(script);
  });

  return window._snapLoader;
}

export interface SnapResult {
  order_id: string;
  status_code: string;
  transaction_status: string;
}

export interface PayWithSnapOptions {
  snapToken: string;
  clientKey: string;
  isProduction: boolean;
  onSuccess?: (result: SnapResult) => void;
  onPending?: (result: SnapResult) => void;
  onError?: (result: SnapResult) => void;
  onClose?: () => void;
}

/**
 * Opens the Snap popup and returns callbacks for each outcome.
 * Never marks anything as paid from here — only the webhook or
 * check-payment-status does that.
 */
export async function payWithSnap(opts: PayWithSnapOptions): Promise<void> {
  await loadSnapScript(opts.clientKey, opts.isProduction);
  if (!window.snap) throw new Error('Snap failed to load');

  window.snap.pay(opts.snapToken, {
    onSuccess: (r) => opts.onSuccess?.(r as SnapResult),
    onPending: (r) => opts.onPending?.(r as SnapResult),
    onError: (r) => opts.onError?.(r as SnapResult),
    onClose: () => opts.onClose?.(),
  });
}

/**
 * Checks payment status from the server (which calls Midtrans).
 * Use this after the Snap popup closes as a fallback.
 */
export async function checkPaymentStatus(
  orderId: string,
  flow: 'subscription' | 'bill',
  tenantId?: string
): Promise<{ ok: boolean; mappedStatus: string; midtransStatus?: string; paymentType?: string; error?: string }> {
  const session = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session.data.session?.access_token) {
    headers.Authorization = `Bearer ${session.data.session.access_token}`;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/check-payment-status`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orderId, flow, tenantId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, mappedStatus: 'UNKNOWN', error: body?.error || 'Status check failed' };
  }
  return {
    ok: body.ok,
    mappedStatus: body.mappedStatus,
    midtransStatus: body.midtransStatus,
    paymentType: body.paymentType,
  };
}

// ---- Flow 1: Subscription payment ----

export interface SubscriptionPaymentResult {
  ok: boolean;
  notConfigured?: boolean;
  invoiceId?: string;
  orderId?: string;
  amount?: number;
  clientKey?: string | null;
  snapToken?: string | null;
  isProduction?: boolean;
  message?: string;
  error?: string;
}

/**
 * Calls the create-subscription-payment edge function to get a Snap token.
 */
export async function createSubscriptionPayment(
  plan: string,
  interval: string
): Promise<SubscriptionPaymentResult> {
  const session = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-subscription-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ plan, interval }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body?.error || 'Could not start payment' };
  }
  return body as SubscriptionPaymentResult;
}

/**
 * Simulates a successful payment for sandbox/dev testing without Midtrans keys.
 * Marks the invoice as paid directly via the service role (through the edge function).
 */
export async function simulateSubscriptionPayment(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/check-payment-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ orderId, flow: 'subscription', simulate: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body?.error };
  return { ok: body.ok ?? true };
}

// ---- Flow 2: Bill payment ----

export interface BillPaymentResult {
  ok: boolean;
  notConfigured?: boolean;
  paymentId?: string;
  orderId?: string;
  grossAmount?: number;
  clientKey?: string | null;
  snapToken?: string | null;
  isProduction?: boolean;
  message?: string;
  error?: string;
}

/**
 * Calls the create-bill-payment edge function to get a Snap token.
 * The server recalculates the amount — the browser never sends a total.
 */
export async function createBillPayment(opts: {
  sessionToken: string;
  tipMinor?: number;
  splitMode?: 'full' | 'equal' | 'amount';
  splitValue?: number;
  customerName?: string;
  customerPhone?: string;
}): Promise<BillPaymentResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-bill-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body?.error || 'Could not start payment' };
  }
  return body as BillPaymentResult;
}
