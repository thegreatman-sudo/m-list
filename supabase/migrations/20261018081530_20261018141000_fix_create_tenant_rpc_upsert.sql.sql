/*
# Fix create_tenant_for_owner to coexist with on_auth_user_created trigger

## Problem
An `on_auth_user_created` trigger auto-inserts a `profiles` row (tenant_id=null)
the moment a user signs up. The original RPC tried to INSERT a second profile
row with the same id, violating profiles_pkey.

## Fix
Replace the profile INSERT with an UPSERT: on conflict(id), update tenant_id,
role, full_name and email. This correctly links the already-created profile to
the new tenant.

## Security
No policy changes. RPC remains SECURITY DEFINER, service-role only.
*/

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

  -- The on_auth_user_created trigger already created a profiles row with
  -- tenant_id = null. UPSERT to link it to the new tenant.
  INSERT INTO profiles (id, tenant_id, role, full_name, email)
  VALUES (
    p_user_id,
    v_tenant_id,
    'owner',
    COALESCE(NULLIF(TRIM(p_owner_name), ''), 'Owner'),
    v_email
  )
  ON CONFLICT (id) DO UPDATE
  SET tenant_id = EXCLUDED.tenant_id,
      role = EXCLUDED.role,
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      updated_at = now();

  RETURN v_tenant_id;
END $$;

REVOKE EXECUTE ON FUNCTION create_tenant_for_owner(uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION create_tenant_for_owner(uuid, text, text, text) TO service_role;
