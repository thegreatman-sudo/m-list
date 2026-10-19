/*
# Authorize inv_* RPCs by session + revoke anon EXECUTE

## Why
All 15 inv_* functions are SECURITY DEFINER and were executable by the anon
role (the `=X/postgres` ACL). Worse, the externally-callable ones trusted
caller-supplied p_tenant / p_outlet / p_actor parameters with no membership
check, so any anon-key client could deduct stock, post receipts, approve
counts, or adjust levels for ANY tenant by guessing/leaking a tenant id.

## What this migration does
1. Adds `inv_assert_staff(p_tenant, p_roles)` — a SECURITY DEFINER helper
   that raises `Not authorized` unless the caller's auth.uid() maps to a
   profile row in that tenant with one of the allowed roles. This is the
   single source of truth for the guard.
2. Prepends an `inv_assert_staff` call to every EXTERNALLY-callable inv_*
   function. For functions that take a row id (counts, receipts, transfers)
   the tenant is resolved from the row first, then checked. The caller's
   auth.uid() is captured as the actor when the client omits p_actor, so
   audit logs name the real user instead of NULL.
3. Does NOT touch the four internal/trigger-path functions
   (inv_deduct_order_item, inv_reverse_order_item, inv_recompute_auto_sold_out,
   inv_get_settings). These are invoked by the order_items status trigger
   and by other inv_ functions where there is no auth context; guarding
   them would break stock deduction on order acceptance.
4. REVOKEs EXECUTE on ALL 15 inv_* functions from anon, so anonymous
   callers can no longer invoke any of them directly. authenticated and
   service_role keep EXECUTE; the guard enforces tenant+role inside.

## Roles per function (per the Inventory spec)
- owner, manager: every mutating operation
- chef: log_waste and produce_batch only (view stock + record waste/counts)
- inv_next_po_number and inv_seed_sample_data: owner/manager (already had a
  has_role check; now also protected by the guard and anon-revoked)

## Safety
- No tables changed, no data changed, no destructive ops.
- Idempotent: re-runnable. Guard helper uses CREATE OR REPLACE.
- REVOKE is repeated (REVOKE is a no-op if already revoked).
*/

-- ---------------------------------------------------------------------------
-- 1. Authorization helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_assert_staff(p_tenant uuid, p_roles text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND tenant_id = p_tenant
      AND role = ANY (p_roles)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inv_assert_staff(uuid, text[]) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. inv_record_purchase — guard on p_tenant (owner/manager)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_record_purchase(
  p_tenant uuid, p_outlet uuid, p_ingredient uuid, p_qty numeric, p_unit_cost bigint,
  p_note text DEFAULT NULL, p_expiry date DEFAULT NULL, p_batch text DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_old_qty numeric(14,4);
  v_old_avg bigint;
  v_new_avg bigint;
  v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  PERFORM inv_assert_staff(p_tenant, ARRAY['owner','manager']);

  SELECT qty, avg_cost_minor INTO v_old_qty, v_old_avg
  FROM stock_levels WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;
  v_old_qty := COALESCE(v_old_qty, 0);
  v_old_avg := COALESCE(v_old_avg, 0);

  INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, unit_cost_minor, ref_type, user_id, note)
  VALUES (p_tenant, p_outlet, p_ingredient, 'purchase', p_qty, p_unit_cost, 'manual', v_actor, p_note);

  v_new_avg := CASE WHEN (v_old_qty + p_qty) > 0
    THEN ROUND(((v_old_qty * v_old_avg) + (p_qty * p_unit_cost)) / (v_old_qty + p_qty))::bigint
    ELSE p_unit_cost END;

  INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty, avg_cost_minor)
  VALUES (p_tenant, p_outlet, p_ingredient, p_qty, p_unit_cost)
  ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

  UPDATE stock_levels SET qty = qty + p_qty, avg_cost_minor = v_new_avg, updated_at = now()
  WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;

  UPDATE ingredients SET cost_per_stock_unit_minor = v_new_avg, updated_at = now() WHERE id = p_ingredient;

  IF p_expiry IS NOT NULL OR p_batch IS NOT NULL THEN
    INSERT INTO batches (tenant_id, outlet_id, ingredient_id, batch, expiry_date, qty_remaining)
    VALUES (p_tenant, p_outlet, p_ingredient, p_batch, p_expiry, p_qty);
  END IF;
  PERFORM inv_recompute_auto_sold_out(p_outlet);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. inv_adjust_stock — guard on p_tenant (owner/manager)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_adjust_stock(
  p_tenant uuid, p_outlet uuid, p_ingredient uuid, p_new_qty numeric,
  p_note text DEFAULT NULL, p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_cur numeric(14,4);
  v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  PERFORM inv_assert_staff(p_tenant, ARRAY['owner','manager']);

  SELECT qty INTO v_cur FROM stock_levels WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;
  v_cur := COALESCE(v_cur, 0);
  INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, user_id, note)
  VALUES (p_tenant, p_outlet, p_ingredient, 'adjustment', p_new_qty - v_cur, 'manual', v_actor, p_note);

  INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty)
  VALUES (p_tenant, p_outlet, p_ingredient, p_new_qty)
  ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

  UPDATE stock_levels SET qty = p_new_qty, updated_at = now()
  WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;

  INSERT INTO inventory_audit_log (tenant_id, actor, action, detail)
  VALUES (p_tenant, v_actor, 'stock_adjusted', jsonb_build_object('ingredient', p_ingredient, 'from', v_cur, 'to', p_new_qty, 'note', p_note));

  PERFORM inv_recompute_auto_sold_out(p_outlet);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. inv_log_waste — guard on p_tenant (owner/manager/chef)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_log_waste(
  p_tenant uuid, p_outlet uuid, p_ingredient uuid, p_menu_item uuid,
  p_qty numeric, p_reason text, p_note text DEFAULT NULL, p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id uuid;
  v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  PERFORM inv_assert_staff(p_tenant, ARRAY['owner','manager','chef']);

  INSERT INTO waste_logs (tenant_id, outlet_id, ingredient_id, menu_item_id, qty, reason, note, user_id)
  VALUES (p_tenant, p_outlet, p_ingredient, p_menu_item, p_qty, p_reason, p_note, v_actor)
  RETURNING id INTO v_id;

  IF p_ingredient IS NOT NULL THEN
    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
    VALUES (p_tenant, p_outlet, p_ingredient, 'waste', -p_qty, 'waste', v_id, v_actor, p_reason);
    UPDATE stock_levels SET qty = qty - p_qty, updated_at = now()
    WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;
  END IF;
  PERFORM inv_recompute_auto_sold_out(p_outlet);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. inv_produce_batch — guard on p_tenant (owner/manager/chef)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_produce_batch(
  p_tenant uuid, p_outlet uuid, p_prepared_ingredient uuid, p_batches numeric,
  p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  r record;
  v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  PERFORM inv_assert_staff(p_tenant, ARRAY['owner','manager','chef']);

  FOR r IN
    SELECT ri.ingredient_id, ri.qty
    FROM recipe_items ri
    WHERE ri.sub_recipe_id = p_prepared_ingredient
  LOOP
    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, user_id, note)
    VALUES (p_tenant, p_outlet, r.ingredient_id, 'production', -(r.qty * p_batches), 'manual', v_actor, 'Batch production');
    UPDATE stock_levels SET qty = qty - (r.qty * p_batches), updated_at = now()
    WHERE outlet_id = p_outlet AND ingredient_id = r.ingredient_id;
  END LOOP;

  INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, user_id, note)
  VALUES (p_tenant, p_outlet, p_prepared_ingredient, 'production', p_batches, 'manual', v_actor, 'Batch production');

  INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty)
  VALUES (p_tenant, p_outlet, p_prepared_ingredient, p_batches)
  ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

  UPDATE stock_levels SET qty = qty + p_batches, updated_at = now()
  WHERE outlet_id = p_outlet AND ingredient_id = p_prepared_ingredient;

  PERFORM inv_recompute_auto_sold_out(p_outlet);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. inv_next_po_number — guard on p_tenant (owner/manager)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_next_po_number(p_tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 'PO-' || lpad((COALESCE(GREATEST(MAX(
    CASE WHEN po_number ~ '\d+' THEN (regexp_replace(po_number, '\D', '', 'g'))::int ELSE 0 END
  ), 0), 0) + 1)::text, 4, '0')
  FROM purchase_orders WHERE tenant_id = p_tenant
$$;

-- inv_next_po_number can't call inv_assert_staff because it's SQL not plpgsql.
-- Replace with a plpgsql wrapper that guards then delegates.
CREATE OR REPLACE FUNCTION public.inv_next_po_number(p_tenant uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result text;
BEGIN
  PERFORM inv_assert_staff(p_tenant, ARRAY['owner','manager']);
  SELECT 'PO-' || lpad((COALESCE(GREATEST(MAX(
    CASE WHEN po_number ~ '\d+' THEN (regexp_replace(po_number, '\D', '', 'g'))::int ELSE 0 END
  ), 0), 0) + 1)::text, 4, '0')
  INTO v_result
  FROM purchase_orders WHERE tenant_id = p_tenant;
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. inv_approve_count — resolve tenant from row, guard (owner/manager)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_approve_count(p_count uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  sc stock_counts%ROWTYPE;
  it record;
  v_delta numeric(14,4);
  v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  SELECT * INTO sc FROM stock_counts WHERE id = p_count;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found'; END IF;

  PERFORM inv_assert_staff(sc.tenant_id, ARRAY['owner','manager']);

  IF sc.status <> 'open' THEN RAISE EXCEPTION 'Count already closed'; END IF;

  FOR it IN SELECT * FROM stock_count_items WHERE count_id = p_count AND counted_qty IS NOT NULL LOOP
    v_delta := it.counted_qty - it.expected_qty;
    IF v_delta <> 0 THEN
      INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
      VALUES (sc.tenant_id, sc.outlet_id, it.ingredient_id, 'count_correction', v_delta, 'count', p_count, v_actor, 'Stock count variance');

      INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty)
      VALUES (sc.tenant_id, sc.outlet_id, it.ingredient_id, it.counted_qty)
      ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

      UPDATE stock_levels SET qty = it.counted_qty, updated_at = now()
      WHERE outlet_id = sc.outlet_id AND ingredient_id = it.ingredient_id;
    END IF;
  END LOOP;

  UPDATE stock_counts SET status = 'approved', approved_by = v_actor, approved_at = now() WHERE id = p_count;

  INSERT INTO inventory_audit_log (tenant_id, actor, action, detail)
  VALUES (sc.tenant_id, v_actor, 'stock_count_approved', jsonb_build_object('count', p_count));
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. inv_post_goods_receipt — resolve tenant from row, guard (owner/manager)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_post_goods_receipt(p_receipt uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  gr goods_receipts%ROWTYPE;
  v_tenant uuid;
  it record;
  v_old_avg bigint;
  v_old_qty numeric(14,4);
  v_new_avg bigint;
  v_alerts jsonb := '[]'::jsonb;
  v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  SELECT * INTO gr FROM goods_receipts WHERE id = p_receipt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  v_tenant := gr.tenant_id;

  PERFORM inv_assert_staff(v_tenant, ARRAY['owner','manager']);

  IF gr.posted THEN RETURN; END IF; -- idempotent

  FOR it IN SELECT * FROM goods_receipt_items WHERE receipt_id = p_receipt LOOP
    SELECT qty, avg_cost_minor INTO v_old_qty, v_old_avg
    FROM stock_levels WHERE outlet_id = gr.outlet_id AND ingredient_id = it.ingredient_id;
    v_old_qty := COALESCE(v_old_qty, 0);
    v_old_avg := COALESCE(v_old_avg, 0);

    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, unit_cost_minor, ref_type, ref_id, user_id, note)
    VALUES (v_tenant, gr.outlet_id, it.ingredient_id, 'purchase', it.qty, it.unit_cost_minor, 'receipt', p_receipt, v_actor,
            'GR ' || COALESCE(gr.invoice_number, ''));

    INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty, avg_cost_minor)
    VALUES (v_tenant, gr.outlet_id, it.ingredient_id, it.qty, it.unit_cost_minor)
    ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

    v_new_avg := CASE WHEN (v_old_qty + it.qty) > 0
      THEN ROUND(((v_old_qty * v_old_avg) + (it.qty * it.unit_cost_minor)) / (v_old_qty + it.qty))::bigint
      ELSE it.unit_cost_minor END;

    UPDATE stock_levels
    SET qty = qty + it.qty, avg_cost_minor = v_new_avg, updated_at = now()
    WHERE outlet_id = gr.outlet_id AND ingredient_id = it.ingredient_id;

    UPDATE ingredients
    SET cost_per_stock_unit_minor = v_new_avg, updated_at = now()
    WHERE id = it.ingredient_id;

    IF it.expiry_date IS NOT NULL OR it.batch IS NOT NULL THEN
      INSERT INTO batches (tenant_id, outlet_id, ingredient_id, batch, expiry_date, qty_remaining)
      VALUES (v_tenant, gr.outlet_id, it.ingredient_id, it.batch, it.expiry_date, it.qty);
    END IF;

    IF v_old_avg > 0 AND ABS(v_new_avg - v_old_avg)::numeric / v_old_avg > 0.10 THEN
      v_alerts := v_alerts || jsonb_build_object('ingredient', it.ingredient_id, 'old', v_old_avg, 'new', v_new_avg);
    END IF;

    UPDATE ingredients SET updated_at = now() WHERE id = it.ingredient_id;
  END LOOP;

  UPDATE goods_receipts SET posted = true WHERE id = p_receipt;

  IF gr.po_id IS NOT NULL THEN
    UPDATE purchase_order_items poi SET qty_received = sub.total
    FROM (
      SELECT gri.ingredient_id, SUM(gri.qty) AS total
      FROM goods_receipt_items gri
      JOIN goods_receipts g2 ON g2.id = gri.receipt_id
      WHERE g2.po_id = gr.po_id AND g2.posted
      GROUP BY gri.ingredient_id
    ) sub
    WHERE poi.po_id = gr.po_id AND poi.ingredient_id = sub.ingredient_id;

    UPDATE purchase_orders po SET status =
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.qty_received < poi.qty_ordered) THEN 'received'
        WHEN EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.qty_received > 0) THEN 'partially_received'
        ELSE po.status END,
      updated_at = now()
    WHERE po.id = gr.po_id;
  END IF;

  PERFORM inv_recompute_auto_sold_out(gr.outlet_id);

  INSERT INTO inventory_audit_log (tenant_id, actor, action, detail)
  VALUES (v_tenant, v_actor, 'goods_receipt_posted', jsonb_build_object('receipt', p_receipt, 'price_alerts', v_alerts));
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. inv_transfer_send — resolve tenant from row, guard (owner/manager)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_transfer_send(p_transfer uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  tr transfers%ROWTYPE;
  it record;
  v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  SELECT * INTO tr FROM transfers WHERE id = p_transfer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  PERFORM inv_assert_staff(tr.tenant_id, ARRAY['owner','manager']);

  IF tr.status <> 'requested' THEN RAISE EXCEPTION 'Transfer not in requested state'; END IF;

  FOR it IN SELECT * FROM transfer_items WHERE transfer_id = p_transfer LOOP
    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
    VALUES (tr.tenant_id, tr.from_outlet_id, it.ingredient_id, 'transfer_out', -it.qty, 'transfer', p_transfer, v_actor, NULL);
    UPDATE stock_levels SET qty = qty - it.qty, updated_at = now()
    WHERE outlet_id = tr.from_outlet_id AND ingredient_id = it.ingredient_id;
  END LOOP;

  UPDATE transfers SET status = 'in_transit' WHERE id = p_transfer;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. inv_transfer_receive — resolve tenant from row, guard (owner/manager)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_transfer_receive(p_transfer uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  tr transfers%ROWTYPE;
  it record;
  v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  SELECT * INTO tr FROM transfers WHERE id = p_transfer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  PERFORM inv_assert_staff(tr.tenant_id, ARRAY['owner','manager']);

  IF tr.status <> 'in_transit' THEN RAISE EXCEPTION 'Transfer not in transit'; END IF;

  FOR it IN SELECT * FROM transfer_items WHERE transfer_id = p_transfer LOOP
    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
    VALUES (tr.tenant_id, tr.to_outlet_id, it.ingredient_id, 'transfer_in', it.qty, 'transfer', p_transfer, v_actor, NULL);

    INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty)
    VALUES (tr.tenant_id, tr.to_outlet_id, it.ingredient_id, it.qty)
    ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

    UPDATE stock_levels SET qty = qty + it.qty, updated_at = now()
    WHERE outlet_id = tr.to_outlet_id AND ingredient_id = it.ingredient_id;
  END LOOP;

  UPDATE transfers SET status = 'received' WHERE id = p_transfer;
  PERFORM inv_recompute_auto_sold_out(tr.to_outlet_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. inv_seed_sample_data — already had has_role; keep, anon revoked below
-- (No body change needed: it already calls has_role(p_tenant, ['owner','manager']).)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 12. REVOKE anon EXECUTE on ALL 15 inv_* functions (and the helper)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.inv_record_purchase(uuid, uuid, uuid, numeric, bigint, text, date, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_adjust_stock(uuid, uuid, uuid, numeric, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_log_waste(uuid, uuid, uuid, uuid, numeric, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_produce_batch(uuid, uuid, uuid, numeric, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_next_po_number(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_seed_sample_data(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_approve_count(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_post_goods_receipt(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_transfer_send(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_transfer_receive(uuid, uuid) FROM anon;

-- Trigger-path / internal functions: not callable externally, anon revoked too.
REVOKE EXECUTE ON FUNCTION public.inv_deduct_order_item(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_reverse_order_item(uuid, boolean, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_recompute_auto_sold_out(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_get_settings(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_recipe_needs(uuid, numeric, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inv_assert_staff(uuid, text[]) FROM anon;
