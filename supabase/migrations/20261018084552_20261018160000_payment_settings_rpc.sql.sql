/*
# Payment settings upsert RPC + fix encryption functions

## What this does
1. Replaces encrypt_server_key / decrypt_server_key with versions that
   set the encryption key via a function-local SET clause (since we can't
   set the database-level app.secret_key GUC).
2. Creates upsert_payment_settings — a SECURITY DEFINER function that
   accepts a plain server key from an owner/manager, encrypts it inside
   the database, and upserts the settings row.
3. Grants EXECUTE to authenticated (the function self-checks ownership).
*/

-- Replace the encryption functions with self-contained key versions.
-- The key is embedded in the function body via a local variable.
CREATE OR REPLACE FUNCTION encrypt_server_key(p_key text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_secret text := 'dineflow_pgcrypto_secret_2026_4f8a2c91e7b3';
BEGIN
  IF p_key IS NULL OR p_key = '' THEN RETURN NULL; END IF;
  RETURN pgp_sym_encrypt(p_key, v_secret);
END;
$$;

CREATE OR REPLACE FUNCTION decrypt_server_key(p_encrypted text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_secret text := 'dineflow_pgcrypto_secret_2026_4f8a2c91e7b3';
BEGIN
  IF p_encrypted IS NULL OR p_encrypted = '' THEN RETURN NULL; END IF;
  RETURN pgp_sym_decrypt(p_encrypted::bytea, v_secret);
END;
$$;

REVOKE EXECUTE ON FUNCTION encrypt_server_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION encrypt_server_key(text) TO service_role;

REVOKE EXECUTE ON FUNCTION decrypt_server_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION decrypt_server_key(text) TO service_role;

-- Upsert function: encrypts server key and writes the full row
CREATE OR REPLACE FUNCTION upsert_payment_settings(
  p_tenant_id uuid,
  p_environment text,
  p_merchant_id text,
  p_client_key text,
  p_server_key text,
  p_enabled_methods text[],
  p_cash_enabled boolean,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_staff boolean;
  v_is_manager boolean;
  v_encrypted text;
  v_secret text := 'dineflow_pgcrypto_secret_2026_4f8a2c91e7b3';
BEGIN
  SELECT is_staff_of(p_tenant_id) INTO v_is_staff;
  IF NOT v_is_staff THEN
    RAISE EXCEPTION 'Not a staff member of this tenant';
  END IF;

  SELECT has_role(p_tenant_id, ARRAY['owner','manager']) INTO v_is_manager;
  IF NOT v_is_manager THEN
    RAISE EXCEPTION 'Only owners and managers can configure payment settings';
  END IF;

  IF p_server_key IS NOT NULL AND p_server_key <> '' THEN
    v_encrypted := pgp_sym_encrypt(p_server_key, v_secret);
  END IF;

  INSERT INTO payment_provider_settings (
    tenant_id, environment, merchant_id, client_key,
    server_key_encrypted, enabled_methods, cash_enabled, is_active,
    created_at, updated_at
  ) VALUES (
    p_tenant_id, p_environment, p_merchant_id, p_client_key,
    v_encrypted, p_enabled_methods, p_cash_enabled, p_is_active,
    now(), now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    environment = EXCLUDED.environment,
    merchant_id = EXCLUDED.merchant_id,
    client_key = EXCLUDED.client_key,
    server_key_encrypted = COALESCE(v_encrypted, payment_provider_settings.server_key_encrypted),
    enabled_methods = EXCLUDED.enabled_methods,
    cash_enabled = EXCLUDED.cash_enabled,
    is_active = EXCLUDED.is_active,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_payment_settings(
  uuid, text, text, text, text, text[], boolean, boolean
) TO authenticated;
