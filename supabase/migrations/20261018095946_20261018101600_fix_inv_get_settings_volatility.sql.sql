/*
# Inventory engine fix — inv_get_settings volatility

1. Plain-English explanation
inv_get_settings was declared STABLE but inserts a default settings row on
first use. PostgreSQL forbids INSERT inside non-volatile functions, so the
deduction trigger failed whenever an outlet's settings row did not exist yet
("INSERT is not allowed in a non-volatile function").

2. Changes
- inv_get_settings: STABLE -> VOLATILE.

3. Security: unchanged.
*/

CREATE OR REPLACE FUNCTION inv_get_settings(p_outlet uuid)
RETURNS inventory_settings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s inventory_settings;
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM outlets WHERE id = p_outlet;
  SELECT * INTO s FROM inventory_settings WHERE outlet_id = p_outlet;
  IF NOT FOUND THEN
    INSERT INTO inventory_settings (tenant_id, outlet_id)
    VALUES (v_tenant, p_outlet)
    ON CONFLICT (outlet_id) DO NOTHING;
    SELECT * INTO s FROM inventory_settings WHERE outlet_id = p_outlet;
  END IF;
  RETURN s;
END;
$$;
