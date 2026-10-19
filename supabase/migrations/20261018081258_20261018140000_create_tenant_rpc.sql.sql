/*
# create_tenant_for_owner RPC + email_logs table

## What this does
Adds a server-side, idempotent provisioning routine used by the `create-tenant`
edge function right after a new restaurant owner signs up. It also adds an
`email_logs` table that all `send-email` invocations will append to.

## New database objects

1. `email_logs` table
   - `id` uuid PK
   - `tenant_id` uuid nullable (FK -> tenants, cascade)
   - `kind` text — welcome | email_verification | staff_invite | trial_ending | receipt
   - `recipient` text, `subject` text
   - `provider_message_id` text nullable — Resend message id
   - `status` text — queued | sent | failed
   - `error` text nullable
   - `created_at` / `sent_at` timestamps

2. `create_tenant_for_owner(p_user_id, p_restaurant_name, p_owner_name, p_country)` RPC
   - SECURITY DEFINER, service-role only.
   - Idempotent: if the user already owns a tenant, returns it without duplicate.
   - Creates: tenants row (trial), one outlets row (unique slug), one profiles
     row (role=owner linked to the auth user).
   - Returns tenant_id (uuid).

## Security
- `email_logs`: RLS enabled; staff may read/insert their own tenant's logs.
- RPC is SECURITY DEFINER, revoked from anon/authenticated, granted to
  service_role only — so it can only run from the edge function.
*/

CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_email_logs" ON email_logs;
CREATE POLICY "staff_select_email_logs"
ON email_logs FOR SELECT
TO authenticated
USING (tenant_id IS NOT NULL AND is_staff_of(tenant_id));

DROP POLICY IF EXISTS "staff_insert_email_logs" ON email_logs;
CREATE POLICY "staff_insert_email_logs"
ON email_logs FOR INSERT
TO authenticated
WITH CHECK (tenant_id IS NOT NULL AND is_staff_of(tenant_id));

DROP FUNCTION IF EXISTS create_tenant_for_owner(uuid, text, text, text);
CREATE OR REPLACE FUNCTION create_tenant_for_owner(
  p_user_id uuid,
  p_restaurant_name text,
  p_owner_name text,
  p_country text DEFAULT 'ID'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_tenant_id uuid;
  v_outlet_id uuid;
  v_slug text;
  v_email text;
  v_base text;
  v_candidate text;
  v_n int := 0;
BEGIN
  SELECT id INTO v_existing FROM tenants WHERE owner_user_id = p_user_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'auth user not found';
  END IF;

  INSERT INTO tenants (
    name, owner_user_id, country, is_demo, trial_ends_at,
    onboarding_step, plan, billing_cycle, status
  )
  VALUES (
    COALESCE(NULLIF(TRIM(p_restaurant_name), ''), 'My Restaurant'),
    p_user_id,
    COALESCE(NULLIF(TRIM(p_country), ''), 'ID'),
    false,
    now() + interval '14 days',
    1,
    'starter',
    'monthly',
    'trial'
  )
  RETURNING id INTO v_tenant_id;

  v_base := lower(regexp_replace(COALESCE(NULLIF(TRIM(p_restaurant_name), ''), 'outlet'), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  IF v_base = '' THEN v_base := 'outlet'; END IF;
  v_candidate := v_base;
  LOOP
    IF NOT EXISTS (SELECT 1 FROM outlets WHERE slug = v_candidate) THEN
      EXIT;
    END IF;
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO outlets (
    tenant_id, name, slug, currency_code, timezone
  )
  VALUES (
    v_tenant_id,
    COALESCE(NULLIF(TRIM(p_restaurant_name), ''), 'Main Outlet'),
    v_candidate,
    'IDR',
    'Asia/Jakarta'
  )
  RETURNING id INTO v_outlet_id;

  INSERT INTO profiles (
    id, tenant_id, role, full_name, email
  )
  VALUES (
    p_user_id,
    v_tenant_id,
    'owner',
    COALESCE(NULLIF(TRIM(p_owner_name), ''), 'Owner'),
    v_email
  );

  RETURN v_tenant_id;
END $$;

REVOKE EXECUTE ON FUNCTION create_tenant_for_owner(uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION create_tenant_for_owner(uuid, text, text, text) TO service_role;
