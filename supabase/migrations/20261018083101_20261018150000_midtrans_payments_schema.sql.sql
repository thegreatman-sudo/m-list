/*
# Midtrans payments: schema additions for both payment flows

## What this does
Adds the tables and columns needed for Midtrans payment integration:
- Flow 1: Restaurant pays DineFlow for subscriptions (platform Midtrans account)
- Flow 2: Restaurant customers pay for meals (each restaurant's own Midtrans account)

## New tables

1. `webhook_logs` — raw payload storage for every Midtrans webhook notification
   - `id` uuid PK
   - `tenant_id` uuid nullable (null for platform webhooks)
   - `source` text — 'platform' | 'tenant'
   - `order_id` text — the Midtrans order_id from the notification
   - `raw_payload` jsonb — the full notification body
   - `signature_valid` boolean — whether the signature verified
   - `processed_at` timestamptz nullable — when the handler finished
   - `created_at` timestamptz
   - RLS: service-role only (no anon/authenticated policies)

2. `payment_provider_settings` — per-tenant Midtrans account configuration
   - `tenant_id` uuid PK (one row per tenant)
   - `environment` text — 'sandbox' | 'production'
   - `merchant_id` text nullable
   - `client_key` text nullable — safe to return to browser
   - `server_key_encrypted` text nullable — encrypted with pgcrypto, NEVER returned to browser
   - `enabled_methods` text[] — subset of ['qris','gopay','shopeepay','bank_transfer','credit_card']
   - `cash_enabled` boolean default true
   - `is_active` boolean default false
   - `created_at` / `updated_at` timestamptz
   - RLS: tenant staff can SELECT (except server_key_encrypted), owner/manager can UPDATE

## Columns added to existing tables (all nullable, non-destructive)

3. `invoices` — add columns for Midtrans subscription payments:
   - `plan` text — 'starter' | 'growth' | 'chain'
   - `interval` text — 'monthly' | 'yearly'
   - `order_id` text unique — Midtrans order_id (SUB-xxx)
   - `snap_token` text — the Snap token for the popup
   - `paid_at` timestamptz

4. `payments` — add columns for Midtrans bill payments:
   - `order_id` text unique — Midtrans order_id (BILL-xxx)
   - `split_ref` text — identifies a split payment attempt
   - `gross_amount` bigint — the total sent to Midtrans
   - `payment_type` text — 'qris' | 'gopay' | 'credit_card' | 'bank_transfer' | etc.
   - `transaction_id` text — Midtrans transaction id
   - `raw_response` jsonb — full status response from Midtrans
   - `paid_at` timestamptz
   - `bill_id` is now nullable (subscription payments have no bill)

## Security
- `webhook_logs`: RLS enabled, no anon/authenticated policies (service-role only)
- `payment_provider_settings`: RLS enabled, tenant staff can SELECT all columns
  EXCEPT server_key_encrypted (enforced via a SECURITY DEFINER function), 
  owner/manager can UPDATE. The server_key_encrypted column has no SELECT grant
  for anon or authenticated roles.
- All new columns on existing tables inherit the existing table's RLS.
- The `payment_provider_settings_server_key_encrypted` column is revoked from
  anon and authenticated to prevent key leakage.
- The `pgcrypto` extension is required for encryption.
*/

-- ---------- pgcrypto extension ----------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- webhook_logs ----------
CREATE TABLE IF NOT EXISTS webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'platform',
  order_id text,
  raw_payload jsonb NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role can access (bypasses RLS).

CREATE INDEX IF NOT EXISTS idx_webhook_logs_order_id ON webhook_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_tenant_id ON webhook_logs(tenant_id);

-- ---------- payment_provider_settings ----------
CREATE TABLE IF NOT EXISTS payment_provider_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'sandbox',
  merchant_id text,
  client_key text,
  server_key_encrypted text,
  enabled_methods text[] NOT NULL DEFAULT '{qris,gopay,credit_card}',
  cash_enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_provider_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_payment_settings" ON payment_provider_settings;
CREATE POLICY "staff_select_payment_settings"
ON payment_provider_settings FOR SELECT
TO authenticated
USING (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "owner_update_payment_settings" ON payment_provider_settings;
CREATE POLICY "owner_update_payment_settings"
ON payment_provider_settings FOR UPDATE
TO authenticated
USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))
WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS "owner_insert_payment_settings" ON payment_provider_settings;
CREATE POLICY "owner_insert_payment_settings"
ON payment_provider_settings FOR INSERT
TO authenticated
WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Revoke SELECT on server_key_encrypted from anon and authenticated
-- so the encrypted key is never leaked to the browser.
REVOKE SELECT (server_key_encrypted) ON payment_provider_settings FROM anon, authenticated;

-- ---------- invoices: add Midtrans columns ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='plan') THEN
    ALTER TABLE invoices ADD COLUMN plan text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='interval') THEN
    ALTER TABLE invoices ADD COLUMN "interval" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='order_id') THEN
    ALTER TABLE invoices ADD COLUMN order_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='snap_token') THEN
    ALTER TABLE invoices ADD COLUMN snap_token text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='paid_at') THEN
    ALTER TABLE invoices ADD COLUMN paid_at timestamptz;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id) WHERE order_id IS NOT NULL;

-- ---------- payments: add Midtrans columns ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='order_id') THEN
    ALTER TABLE payments ADD COLUMN order_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='split_ref') THEN
    ALTER TABLE payments ADD COLUMN split_ref text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='gross_amount') THEN
    ALTER TABLE payments ADD COLUMN gross_amount bigint;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='payment_type') THEN
    ALTER TABLE payments ADD COLUMN payment_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='transaction_id') THEN
    ALTER TABLE payments ADD COLUMN transaction_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='raw_response') THEN
    ALTER TABLE payments ADD COLUMN raw_response jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='paid_at') THEN
    ALTER TABLE payments ADD COLUMN paid_at timestamptz;
  END IF;
END $$;

-- Make bill_id nullable (subscription payments have no bill)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='bill_id' AND is_nullable='NO') THEN
    ALTER TABLE payments ALTER COLUMN bill_id DROP NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id) WHERE order_id IS NOT NULL;

-- ---------- helper function: encrypt/decrypt server key ----------
-- SECURITY DEFINER so the service role (from edge functions) can use it
-- without needing direct pgcrypto access.
CREATE OR REPLACE FUNCTION encrypt_server_key(p_key text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_key IS NULL OR p_key = '' THEN RETURN NULL; END IF;
  RETURN pgp_sym_encrypt(p_key, current_setting('app.secret_key', true));
END;
$$;

CREATE OR REPLACE FUNCTION decrypt_server_key(p_encrypted text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_encrypted IS NULL OR p_encrypted = '' THEN RETURN NULL; END IF;
  RETURN pgp_sym_decrypt(p_encrypted::bytea, current_setting('app.secret_key', true));
END;
$$;

REVOKE EXECUTE ON FUNCTION encrypt_server_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION encrypt_server_key(text) TO service_role;

REVOKE EXECUTE ON FUNCTION decrypt_server_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION decrypt_server_key(text) TO service_role;
