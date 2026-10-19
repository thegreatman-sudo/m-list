-- Fix: pgp_sym_encrypt expects (text, text) but pgp_sym_decrypt expects (bytea, text)
-- The pgcrypto extension provides:
--   pgp_sym_encrypt(data text, psw text) -> bytea
--   pgp_sym_decrypt(msg bytea, psw text) -> text
-- The issue was a search_path problem. Let's verify pgcrypto is installed
-- and the functions are accessible.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Recreate with explicit schema qualification
DROP FUNCTION IF EXISTS encrypt_server_key(text);
DROP FUNCTION IF EXISTS decrypt_server_key(text);

CREATE OR REPLACE FUNCTION public.encrypt_server_key(p_key text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgcrypto
AS $$
DECLARE
  v_secret text := 'dineflow_pgcrypto_secret_2026_4f8a2c91e7b3';
  v_encrypted bytea;
BEGIN
  IF p_key IS NULL OR p_key = '' THEN RETURN NULL; END IF;
  v_encrypted := pgp_sym_encrypt(p_key, v_secret);
  RETURN encode(v_encrypted, 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_server_key(p_encrypted text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgcrypto
AS $$
DECLARE
  v_secret text := 'dineflow_pgcrypto_secret_2026_4f8a2c91e7b3';
  v_decoded bytea;
BEGIN
  IF p_encrypted IS NULL OR p_encrypted = '' THEN RETURN NULL; END IF;
  v_decoded := decode(p_encrypted, 'hex');
  RETURN pgp_sym_decrypt(v_decoded, v_secret);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.encrypt_server_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encrypt_server_key(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.decrypt_server_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrypt_server_key(text) TO service_role;

-- Recreate the upsert function with the same search_path fix
DROP FUNCTION IF EXISTS upsert_payment_settings(uuid, text, text, text, text, text[], boolean, boolean);

CREATE OR REPLACE FUNCTION public.upsert_payment_settings(
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgcrypto
AS $$
DECLARE
  v_is_staff boolean;
  v_is_manager boolean;
  v_encrypted bytea;
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
    CASE WHEN v_encrypted IS NOT NULL THEN encode(v_encrypted, 'hex') END,
    p_enabled_methods, p_cash_enabled, p_is_active,
    now(), now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    environment = EXCLUDED.environment,
    merchant_id = EXCLUDED.merchant_id,
    client_key = EXCLUDED.client_key,
    server_key_encrypted = CASE
      WHEN v_encrypted IS NOT NULL THEN encode(v_encrypted, 'hex')
      ELSE payment_provider_settings.server_key_encrypted
    END,
    enabled_methods = EXCLUDED.enabled_methods,
    cash_enabled = EXCLUDED.cash_enabled,
    is_active = EXCLUDED.is_active,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_payment_settings(
  uuid, text, text, text, text, text[], boolean, boolean
) TO authenticated;
