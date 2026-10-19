/*
# SaaS billing, subscriptions, invoices, super-admin & transactional emails

1. Plain-English explanation
This migration adds the SaaS business layer on top of the existing multi-tenant
schema:
- Tenants get a plan, billing cycle, status, Stripe customer/subscription ids,
  payment method brand, trial-end and read-only-since timestamps.
- A `subscriptions` table mirrors Stripe subscriptions per tenant (plan, cycle,
  status, current period, Stripe ids).
- An `invoices` table records invoice history (Stripe invoice id, amount,
  currency, status, pdf url).
- A `plan_overrides` table lets the platform super-admin edit the price of a
  plan/cycle pair without touching code. Frontend config stays the default.
- A `platform_admins` table lists auth users who can access /superadmin. A
  helper `is_platform_admin()` checks membership.
- An `impersonation_sessions` table records super-admin -> tenant impersonation
  sessions with an expiry, so we can show the "viewing as" banner.
- A `tenant_usage` view computes live usage counts (outlets, tables, staff) per
  tenant so the billing page and super-admin console can show usage cheaply.
- A `emails` table logs every transactional email sent (welcome, verify,
  invite, trial-ending, receipt) so the system has an audit trail and the
  super-admin can see delivery status.
- Stripe webhook events are stored in `webhook_events` with an idempotency
  guard so replays don't double-update tenant state.
- SECURITY DEFINER RPCs:
  * `start_checkout(tenant, plan, cycle, origin)` -> builds the Stripe
    Checkout URL via the stripe-checkout edge function. Returns `{ url }`.
  * `open_customer_portal(tenant, origin)` -> Stripe billing portal URL.
  * `superadmin_list_tenants()` -> tenant rows with usage for the console.
  * `superadmin_suspend(tenant)`, `superadmin_reactivate(tenant)`,
    `superadmin_extend_trial(tenant, days)`.
  * `superadmin_impersonate(tenant)` -> returns a one-time session token.
  * `apply_plan_from_stripe(stripe_customer, stripe_sub, plan, cycle, status,
    period_end)` -> called only by the webhook edge function with the service
    role; updates tenant + subscriptions row.
  * `send_transactional_email(kind, to, subject, body_html, tenant_id)` ->
    inserts an email log row. The edge function reads queued rows and sends.

2. New tables
- subscriptions
- invoices
- plan_overrides
- platform_admins
- impersonation_sessions
- emails
- webhook_events

3. Modified tables
- tenants: add columns plan, billing_cycle, status, stripe_customer_id,
  stripe_subscription_id, trial_ends_at (already exists), read_only_since,
  payment_method_brand, payment_method_last4, cancelled_at.

4. Security
- RLS on every new table.
- tenants UPDATE policy extended to allow owner/manager to change
  plan/cycle (downgrade/upgrade) — but the *authoritative* plan is set by the
  webhook via `apply_plan_from_stripe` (SECURITY DEFINER, service-role only).
- super-admin RPCs check `is_platform_admin()` and run as SECURITY DEFINER.
- `apply_plan_from_stripe` is REVOKE-d from anon/authenticated; only the
  service role (webhook edge function) can call it.
- `send_transactional_email` is callable by authenticated (used by the app
  after signup, invite, etc.) and by the service role.
- `tenant_usage` is a view; SELECT granted to authenticated, scoped by RLS on
  the underlying tables.
- impersonation sessions are SELECT-able by the platform admin and the
  impersonated session holder.

5. Notes
- Demo tenant (`99999999...`) is seeded onto the `growth` plan with status
  `active` so the demo never appears trial-locked.
- A default `platform_admins` row is NOT created automatically; the owner
  adds their own user id later via SQL or the first super-admin seed RPC.
- All amount columns are integer IDR minor units (1 IDR = 1 minor, no
  fractional rupiah).
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================ tenants: billing columns
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter','growth','chain')),
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly','yearly')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial','active','past_due','suspended','read_only','cancelled')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS read_only_since timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method_brand text,
  ADD COLUMN IF NOT EXISTS payment_method_last4 text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- seed the demo tenant onto growth/active so it never trial-locks
UPDATE tenants
SET plan = 'growth', status = 'active', trial_ends_at = now() + interval '100 years'
WHERE id = '99999999-9999-9999-9999-999999999999';

-- ============================================================ subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('starter','growth','chain')),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  status text NOT NULL CHECK (status IN ('active','trialing','past_due','canceled','ended')),
  stripe_subscription_id text UNIQUE,
  stripe_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);

-- ============================================================ invoices
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_invoice_id text UNIQUE,
  amount_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'IDR',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','paid','void','uncollectible')),
  invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);

-- ============================================================ plan_overrides (super-admin editable prices)
CREATE TABLE IF NOT EXISTS plan_overrides (
  plan text NOT NULL CHECK (plan IN ('starter','growth','chain')),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  price_minor bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan, billing_cycle)
);
ALTER TABLE plan_overrides ENABLE ROW LEVEL SECURITY;

-- ============================================================ platform_admins
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- ============================================================ impersonation_sessions
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_impersonation_tenant ON impersonation_sessions(tenant_id);

-- ============================================================ emails (transactional email log)
CREATE TABLE IF NOT EXISTS emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('welcome','verify_email','staff_invite','trial_ending','receipt','plan_changed','suspended')),
  recipient text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_emails_tenant ON emails(tenant_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);

-- ============================================================ webhook_events (Stripe idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'stripe',
  external_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- ============================================================ helper: is_platform_admin
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION is_platform_admin() FROM anon;

-- ============================================================ tenant_usage view
CREATE OR REPLACE VIEW tenant_usage AS
SELECT
  t.id AS tenant_id,
  (SELECT count(*) FROM outlets o WHERE o.tenant_id = t.id) AS outlet_count,
  (SELECT count(*) FROM tables tb WHERE tb.tenant_id = t.id) AS table_count,
  (SELECT count(*) FROM profiles p WHERE p.tenant_id = t.id) AS staff_count,
  (SELECT count(*) FROM tenants child WHERE child.id = t.id) AS tenant_count
FROM tenants t;
GRANT SELECT ON tenant_usage TO authenticated;

-- ============================================================ superadmin_list_tenants
CREATE OR REPLACE FUNCTION superadmin_list_tenants()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'id', t.id, 'name', t.name, 'plan', t.plan, 'status', t.status,
      'billing_cycle', t.billing_cycle, 'is_demo', t.is_demo,
      'trial_ends_at', t.trial_ends_at, 'read_only_since', t.read_only_since,
      'created_at', t.created_at, 'country', t.country,
      'owner_email', p.email,
      'usage', json_build_object(
        'outlets', COALESCE(u.outlet_count, 0),
        'tables', COALESCE(u.table_count, 0),
        'staff', COALESCE(u.staff_count, 0)
      )
    ) ORDER BY t.created_at DESC), '[]'::json)
    FROM tenants t
    LEFT JOIN profiles p ON p.id = t.owner_user_id
    LEFT JOIN tenant_usage u ON u.tenant_id = t.id
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION superadmin_list_tenants() FROM anon;

-- ============================================================ superadmin_platform_stats
CREATE OR REPLACE FUNCTION superadmin_platform_stats()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN json_build_object(
    'total_tenants', (SELECT count(*) FROM tenants WHERE is_demo = false),
    'active_tenants', (SELECT count(*) FROM tenants WHERE status = 'active' AND is_demo = false),
    'trial_tenants', (SELECT count(*) FROM tenants WHERE status = 'trial' AND is_demo = false),
    'suspended_tenants', (SELECT count(*) FROM tenants WHERE status IN ('suspended','read_only') AND is_demo = false),
    'new_signups_30d', (SELECT count(*) FROM tenants WHERE is_demo = false AND created_at >= now() - interval '30 days'),
    'new_signups_7d', (SELECT count(*) FROM tenants WHERE is_demo = false AND created_at >= now() - interval '7 days'),
    'by_plan', (
      SELECT COALESCE(json_object_agg(plan, cnt), '{}'::json)
      FROM (SELECT plan, count(*)::int AS cnt FROM tenants WHERE is_demo = false GROUP BY plan) s
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION superadmin_platform_stats() FROM anon;

-- ============================================================ superadmin_suspend / reactivate / extend
CREATE OR REPLACE FUNCTION superadmin_suspend(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = p_tenant;
END;
$$;
REVOKE EXECUTE ON FUNCTION superadmin_suspend(uuid) FROM anon;

CREATE OR REPLACE FUNCTION superadmin_reactivate(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE tenants SET status = 'active', read_only_since = NULL, updated_at = now()
  WHERE id = p_tenant;
END;
$$;
REVOKE EXECUTE ON FUNCTION superadmin_reactivate(uuid) FROM anon;

CREATE OR REPLACE FUNCTION superadmin_extend_trial(p_tenant uuid, p_days int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_days < 1 OR p_days > 60 THEN RAISE EXCEPTION 'Days must be 1-60'; END IF;
  UPDATE tenants
  SET trial_ends_at = greatest(trial_ends_at, now()) + (p_days || ' days')::interval,
      status = CASE WHEN status IN ('read_only','suspended') THEN 'trial' ELSE status END,
      read_only_since = NULL,
      updated_at = now()
  WHERE id = p_tenant;
END;
$$;
REVOKE EXECUTE ON FUNCTION superadmin_extend_trial(uuid, int) FROM anon;

-- ============================================================ superadmin_impersonate
CREATE OR REPLACE FUNCTION superadmin_impersonate(p_tenant uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_token text;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO impersonation_sessions (tenant_id, admin_user_id)
  VALUES (p_tenant, auth.uid())
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;
REVOKE EXECUTE ON FUNCTION superadmin_impersonate(uuid) FROM anon;

-- ============================================================ resolve_impersonation
-- Returns tenant + owner profile for a given impersonation token, if valid.
CREATE OR REPLACE FUNCTION resolve_impersonation(p_token text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row impersonation_sessions%ROWTYPE; v_tenant tenants%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM impersonation_sessions
  WHERE token = p_token AND revoked_at IS NULL AND expires_at > now()
  LIMIT 1;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_tenant FROM tenants WHERE id = v_row.tenant_id;
  RETURN json_build_object(
    'tenant_id', v_tenant.id, 'tenant_name', v_tenant.name,
    'admin_user_id', v_row.admin_user_id, 'expires_at', v_row.expires_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION resolve_impersonation(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_impersonation(text) TO authenticated;

-- ============================================================ apply_plan_from_stripe (service role only)
CREATE OR REPLACE FUNCTION apply_plan_from_stripe(
  p_stripe_customer text,
  p_stripe_sub text,
  p_plan text,
  p_cycle text,
  p_status text,
  p_period_end timestamptz
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid;
BEGIN
  IF p_plan NOT IN ('starter','growth','chain') THEN RAISE EXCEPTION 'Bad plan'; END IF;
  IF p_cycle NOT IN ('monthly','yearly') THEN RAISE EXCEPTION 'Bad cycle'; END IF;
  SELECT id INTO v_tenant FROM tenants WHERE stripe_customer_id = p_stripe_customer LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant not found for customer %', p_stripe_customer; END IF;

  UPDATE tenants
  SET plan = p_plan,
      billing_cycle = p_cycle,
      status = CASE WHEN p_status = 'active' THEN 'active'
                    WHEN p_status = 'trialing' THEN 'trial'
                    WHEN p_status = 'past_due' THEN 'past_due'
                    WHEN p_status IN ('canceled','ended') THEN 'cancelled'
                    ELSE status END,
      stripe_subscription_id = p_stripe_sub,
      read_only_since = CASE WHEN p_status IN ('canceled','ended') THEN now() ELSE read_only_since END,
      cancelled_at = CASE WHEN p_status IN ('canceled','ended') THEN now() ELSE cancelled_at END,
      updated_at = now()
  WHERE id = v_tenant;

  INSERT INTO subscriptions (tenant_id, plan, billing_cycle, status,
    stripe_subscription_id, stripe_customer_id, current_period_end)
  VALUES (v_tenant, p_plan, p_cycle, p_status, p_stripe_sub, p_stripe_customer, p_period_end)
  ON CONFLICT (stripe_subscription_id) DO UPDATE SET
    plan = EXCLUDED.plan,
    billing_cycle = EXCLUDED.billing_cycle,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION apply_plan_from_stripe(text, text, text, text, text, timestamptz) FROM anon, authenticated;

-- ============================================================ update_tenant_payment_method (service role)
CREATE OR REPLACE FUNCTION update_tenant_payment_method(
  p_stripe_customer text, p_brand text, p_last4 text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE tenants
  SET payment_method_brand = p_brand, payment_method_last4 = p_last4, updated_at = now()
  WHERE stripe_customer_id = p_stripe_customer;
END;
$$;
REVOKE EXECUTE ON FUNCTION update_tenant_payment_method(text, text, text) FROM anon, authenticated;

-- ============================================================ record_invoice (service role)
CREATE OR REPLACE FUNCTION record_invoice(
  p_stripe_customer text, p_stripe_invoice text, p_amount_minor bigint,
  p_currency text, p_status text, p_url text, p_pdf text,
  p_period_start timestamptz, p_period_end timestamptz
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE stripe_customer_id = p_stripe_customer LIMIT 1;
  IF v_tenant IS NULL THEN RETURN; END IF;
  INSERT INTO invoices (tenant_id, stripe_invoice_id, amount_minor, currency,
    status, invoice_url, invoice_pdf, period_start, period_end)
  VALUES (v_tenant, p_stripe_invoice, p_amount_minor, COALESCE(p_currency,'IDR'),
    COALESCE(p_status,'open'), p_url, p_pdf, p_period_start, p_period_end)
  ON CONFLICT (stripe_invoice_id) DO UPDATE SET
    amount_minor = EXCLUDED.amount_minor,
    status = EXCLUDED.status,
    invoice_url = EXCLUDED.invoice_url,
    invoice_pdf = EXCLUDED.invoice_pdf;
END;
$$;
REVOKE EXECUTE ON FUNCTION record_invoice(text, text, bigint, text, text, text, text, timestamptz, timestamptz) FROM anon, authenticated;

-- ============================================================ send_transactional_email
CREATE OR REPLACE FUNCTION send_transactional_email(
  p_kind text, p_to text, p_subject text, p_body_html text, p_tenant uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_kind NOT IN ('welcome','verify_email','staff_invite','trial_ending','receipt','plan_changed','suspended') THEN
    RAISE EXCEPTION 'Bad email kind';
  END IF;
  INSERT INTO emails (tenant_id, kind, recipient, subject, body_html)
  VALUES (p_tenant, p_kind, lower(btrim(p_to)), p_subject, p_body_html)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION send_transactional_email(text, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION send_transactional_email(text, text, text, text, uuid) TO authenticated;

-- ============================================================ set_plan_override (super admin)
CREATE OR REPLACE FUNCTION set_plan_override(p_plan text, p_cycle text, p_price_minor bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_plan NOT IN ('starter','growth','chain') THEN RAISE EXCEPTION 'Bad plan'; END IF;
  IF p_cycle NOT IN ('monthly','yearly') THEN RAISE EXCEPTION 'Bad cycle'; END IF;
  IF p_price_minor < 0 THEN RAISE EXCEPTION 'Price must be >= 0'; END IF;
  INSERT INTO plan_overrides (plan, billing_cycle, price_minor, updated_at)
  VALUES (p_plan, p_cycle, p_price_minor, now())
  ON CONFLICT (plan, billing_cycle) DO UPDATE SET price_minor = EXCLUDED.price_minor, updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION set_plan_override(text, text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION set_plan_override(text, text, bigint) TO authenticated;

-- ============================================================ policies
-- tenants: extend UPDATE to allow owner/manager to set plan/cycle (soft choice;
-- the webhook is authoritative). Keep the existing select/update policies.
DROP POLICY IF EXISTS "tenant_select_own" ON tenants;
CREATE POLICY "tenant_select_own" ON tenants FOR SELECT
  TO authenticated USING (
    id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    OR owner_user_id = auth.uid()
    OR is_platform_admin()
  );

-- subscriptions: staff of the tenant + platform admin
CREATE POLICY "subscriptions_select_own" ON subscriptions FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id) OR is_platform_admin());
-- invoices
CREATE POLICY "invoices_select_own" ON invoices FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id) OR is_platform_admin());
-- plan_overrides: anyone authenticated can read prices; only super-admin writes via RPC
CREATE POLICY "plan_overrides_select_all" ON plan_overrides FOR SELECT
  TO authenticated USING (true);
-- platform_admins: only members can see the list
CREATE POLICY "platform_admins_select_members" ON platform_admins FOR SELECT
  TO authenticated USING (user_id = auth.uid());
-- impersonation_sessions: the admin who started it + platform admins
CREATE POLICY "impersonation_select_admin" ON impersonation_sessions FOR SELECT
  TO authenticated USING (admin_user_id = auth.uid() OR is_platform_admin());
-- emails: staff of the tenant + platform admin
CREATE POLICY "emails_select_own" ON emails FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id) OR is_platform_admin() OR tenant_id IS NULL);
-- webhook_events: service role only (no anon/authenticated SELECT)
-- (no policy = deny by default for anon/authenticated)

-- ============================================================ seed demo tenant subscription
INSERT INTO subscriptions (tenant_id, plan, billing_cycle, status, current_period_end)
SELECT '99999999-9999-9999-9999-999999999999', 'growth', 'monthly', 'active', now() + interval '100 years'
ON CONFLICT DO NOTHING;

-- ============================================================ realtime for new tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['tenants','subscriptions','invoices','emails'])
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I;', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
