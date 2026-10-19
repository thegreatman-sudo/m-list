/*
# Fix: array_agg DISTINCT with ORDER BY in submit_order

## Problem
`SELECT array_agg(DISTINCT r->>'station') ... ORDER BY r->>'station'` fails
because PostgreSQL requires the ORDER BY column to appear in the GROUP BY
when using DISTINCT in array_agg.

## Fix
Use a subquery to get distinct stations sorted, then array_agg them.
*/

CREATE OR REPLACE FUNCTION submit_order(
  p_token text,
  p_idempotency_key text,
  p_lines jsonb,
  p_notes text DEFAULT NULL,
  p_guest_name text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet outlets%ROWTYPE;
  v_area areas%ROWTYPE;
  v_session table_sessions%ROWTYPE;
  v_bill bills%ROWTYPE;
  v_line jsonb;
  v_item menu_items%ROWTYPE;
  v_item_id uuid;
  v_qty int;
  v_mod jsonb;
  v_mod_opt menu_modifier_options%ROWTYPE;
  v_mod_id uuid;
  v_mods jsonb;
  v_mod_name text;
  v_mod_price bigint;
  v_stations text[];
  v_station text;
  v_order_id uuid;
  v_order_number int;
  v_rows jsonb := '[]'::jsonb;
  v_cached jsonb;
  v_allergy_alert boolean;
  v_initial_status text;
  v_result_orders jsonb := '[]'::jsonb;
BEGIN
  IF p_idempotency_key IS NOT NULL AND length(btrim(p_idempotency_key)) > 0 THEN
    SELECT response INTO v_cached FROM idempotency_keys WHERE key = p_idempotency_key;
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;
  IF jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'Too many items in one order';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;

  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;

  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id AND deleted_at IS NULL;
  IF v_outlet.id IS NULL THEN
    RAISE EXCEPTION 'Outlet not found';
  END IF;

  SELECT * INTO v_area FROM areas WHERE id = v_table.area_id AND archived_at IS NULL;

  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  IF v_session.id IS NULL THEN
    INSERT INTO table_sessions (table_id, outlet_id, tenant_id, status, guest_count)
    VALUES (v_table.id, v_table.outlet_id, v_table.tenant_id, 'open', 1)
    RETURNING * INTO v_session;
  END IF;

  SELECT * INTO v_bill FROM bills
    WHERE session_id = v_session.id AND status = 'open'
    ORDER BY created_at DESC LIMIT 1;
  IF v_bill.id IS NULL THEN
    INSERT INTO bills (session_id, table_id, outlet_id, tenant_id, status)
    VALUES (v_session.id, v_table.id, v_table.outlet_id, v_table.tenant_id, 'open')
    RETURNING * INTO v_bill;
  END IF;

  v_initial_status := 'received';

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := COALESCE((v_line->>'quantity')::int, 0);
    IF v_qty < 1 OR v_qty > 20 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    IF (v_line->>'itemId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid item in cart';
    END IF;
    v_item_id := (v_line->>'itemId')::uuid;
    SELECT * INTO v_item FROM menu_items WHERE id = v_item_id;
    IF v_item.id IS NULL OR v_item.outlet_id <> v_outlet.id THEN
      RAISE EXCEPTION 'Some items are no longer available';
    END IF;
    IF v_item.sold_out OR NOT v_item.available THEN
      RAISE EXCEPTION '% just sold out — please review your cart', v_item.name;
    END IF;

    IF v_item.daily_limit IS NOT NULL THEN
      IF v_item.daily_sold + v_qty > v_item.daily_limit THEN
        RAISE EXCEPTION 'Only % left of % today', GREATEST(v_item.daily_limit - v_item.daily_sold, 0), v_item.name;
      END IF;
    END IF;

    v_mods := '[]'::jsonb;
    IF jsonb_typeof(COALESCE(v_line->'modifiers', '[]'::jsonb)) = 'array' THEN
      FOR v_mod IN SELECT * FROM jsonb_array_elements(v_line->'modifiers') LOOP
        v_mod_id := NULL;
        v_mod_name := v_mod->>'name';
        v_mod_price := 0;
        IF (v_mod->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_mod_id := (v_mod->>'id')::uuid;
          SELECT * INTO v_mod_opt FROM menu_modifier_options
            WHERE id = v_mod_id AND modifier_id IN (
              SELECT id FROM menu_modifiers WHERE item_id = v_item.id
            );
          IF v_mod_opt.id IS NULL THEN
            RAISE EXCEPTION 'Invalid modifier for %', v_item.name;
          END IF;
          v_mod_name := v_mod_opt.name;
          v_mod_price := v_mod_opt.price_delta_minor;
        END IF;
        v_mods := v_mods || jsonb_build_object(
          'name', v_mod_name,
          'price_delta_minor', v_mod_price
        );
      END LOOP;
    END IF;

    v_allergy_alert := (array_length(COALESCE(v_item.allergens, ARRAY[]::text[]), 1) > 0
                        AND NOT ('none' = ANY (COALESCE(v_item.allergens, ARRAY['none'::text]))));

    v_rows := v_rows || jsonb_build_object(
      'item_id', v_item.id,
      'name', v_item.name,
      'station', v_item.station,
      'quantity', v_qty,
      'unit_price_minor', v_item.price_minor,
      'modifiers', v_mods,
      'notes', NULLIF(btrim(COALESCE(v_line->>'notes', '')), ''),
      'allergy_alert', v_allergy_alert
    );
  END LOOP;

  -- Get distinct stations sorted (fixed: subquery approach)
  SELECT array_agg(station) INTO v_stations
  FROM (
    SELECT DISTINCT r->>'station' AS station
    FROM jsonb_array_elements(v_rows) r
    ORDER BY r->>'station'
  ) s;

  FOREACH v_station IN ARRAY v_stations LOOP
    UPDATE orders_seq SET next_number = next_number + 1
    WHERE outlet_id = v_outlet.id
    RETURNING next_number - 1 INTO v_order_number;

    INSERT INTO orders (session_id, table_id, outlet_id, tenant_id, order_number,
                        type, source, status, notes, guest_name)
    VALUES (v_session.id, v_table.id, v_outlet.id, v_outlet.tenant_id, v_order_number,
            'dine_in', 'qr', v_initial_status,
            NULLIF(btrim(COALESCE(p_notes, '')), ''),
            NULLIF(btrim(COALESCE(p_guest_name, '')), ''))
    RETURNING id INTO v_order_id;

    INSERT INTO order_items (order_id, outlet_id, tenant_id, item_id, name, station,
                             quantity, unit_price_minor, modifiers, notes, status, allergy_alert)
    SELECT
      v_order_id, v_outlet.id, v_outlet.tenant_id,
      (r->>'item_id')::uuid, r->>'name', r->>'station', (r->>'quantity')::int,
      (r->>'unit_price_minor')::bigint, COALESCE(r->'modifiers', '[]'::jsonb),
      r->>'notes', 'received', (r->>'allergy_alert')::boolean
    FROM jsonb_array_elements(v_rows) r
    WHERE r->>'station' = v_station;

    UPDATE menu_items SET daily_sold = daily_sold + (r->>'quantity')::int
    FROM jsonb_array_elements(v_rows) r
    WHERE menu_items.id = (r->>'item_id')::uuid AND r->>'station' = v_station;

    v_result_orders := v_result_orders || jsonb_build_object(
      'orderId', v_order_id,
      'orderNumber', v_order_number,
      'station', v_station
    );
  END LOOP;

  UPDATE tables SET status = 'occupied', updated_at = now() WHERE id = v_table.id;

  v_cached := jsonb_build_object(
    'orders', v_result_orders,
    'sessionId', v_session.id,
    'billId', v_bill.id,
    'approvalMode', COALESCE(v_area.order_approval_mode, v_outlet.order_approval_mode)
  );

  IF p_idempotency_key IS NOT NULL AND length(btrim(p_idempotency_key)) > 0 THEN
    INSERT INTO idempotency_keys (key, response) VALUES (p_idempotency_key, v_cached)
    ON CONFLICT (key) DO NOTHING;
  END IF;

  RETURN v_cached;
END;
$$;

REVOKE EXECUTE ON FUNCTION submit_order(text, text, jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_order(text, text, jsonb, text, text) TO service_role;
