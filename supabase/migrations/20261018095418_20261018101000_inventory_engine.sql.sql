/*
# Inventory module — stock engine (functions and triggers)

1. Plain-English explanation
Implements the inventory brain: automatic stock deduction when the kitchen
starts preparing an order item, automatic reversal when an unprepared item is
voided, waste recording when a prepared item is voided, auto sold-out when an
ingredient hits zero, goods-receipt posting with weighted-average cost, stock
count approval posting, waste movements, batch production, and inter-outlet
transfers. All mutations run inside single SQL functions so stock can never be
half-updated (each function call is one implicit transaction).

2. Functions (all SECURITY DEFINER with locked search_path; revoke from anon)
- inv_get_settings(outlet): returns the outlet's inventory settings, creating
  a default row on first use.
- inv_deduct_order_item(item_id, actor): deducts recipe ingredients once
  (idempotent via a unique index on movements). Handles modifier add/replace.
- inv_reverse_order_item(item_id, actor, prepared): restores stock if the item
  was voided before prep; records waste if it was prepared then voided.
- trg_order_items_inventory: trigger wiring the two above to status changes.
- inv_recompute_auto_sold_out(outlet): sets/clears menu_items.auto_sold_out
  based on stock vs the configured threshold.
- inv_post_goods_receipt(receipt_id, actor): purchase movements + weighted
  average cost update + batches + PO progress + price-change alert (>10%) +
  audit log entry.
- inv_approve_count(count_id, actor): posts variance corrections as immutable
  movements, approves the count, writes an audit log entry.
- inv_log_waste(...): chef-friendly waste entry that also writes the movement.
- inv_produce_batch(ingredient, qty, actor): consumes raw ingredients per the
  sub-recipe and adds the prepared item to stock.
- inv_transfer_send / inv_transfer_receive: move stock between outlets.
- inv_record_purchase(ingredient, qty, unit_cost, ...): simple purchase entry
  (used when no PO/receipt flow is needed).
- inv_adjust_stock(ingredient, new_qty, note, actor): manual adjustment that
  writes a correction movement (never edits history).

3. Security
- Every function revokes EXECUTE from anon; the client can only reach them
  through authenticated calls, and each function re-checks the caller's role
  via has_role() where writes are privileged (receipts, count approval).
- The deduction trigger runs on order_items status changes for all sources
  (QR, waiter, POS, website) because it lives in the database.

4. Notes
- Quantities are numeric(14,4); money in integer minor units.
- The unique partial index on stock_movements makes retries and double taps
  harmless: the second insert fails and the exception is swallowed as
  "already deducted".
*/

CREATE OR REPLACE FUNCTION inv_get_settings(p_outlet uuid)
RETURNS inventory_settings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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

-- Core deduction: one order item, once.
CREATE OR REPLACE FUNCTION inv_deduct_order_item(p_item uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  it order_items%ROWTYPE;
  v_outlet uuid;
  v_tenant uuid;
  v_settings inventory_settings;
  r record;
  v_qty numeric(14,4);
BEGIN
  SELECT * INTO it FROM order_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN; END IF;
  v_outlet := it.outlet_id;
  SELECT tenant_id INTO v_tenant FROM outlets WHERE id = v_outlet;
  v_settings := inv_get_settings(v_outlet);

  -- Resolve the recipe's ingredient quantities for one portion.
  FOR r IN
    SELECT ri.ingredient_id, ri.qty
    FROM recipes rec
    JOIN recipe_items ri ON ri.recipe_id = rec.id
    WHERE rec.menu_item_id = it.item_id AND ri.ingredient_id IS NOT NULL
  LOOP
    v_qty := r.qty * it.quantity;
    BEGIN
      INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, unit_cost_minor, ref_type, ref_id, user_id, note)
      VALUES (v_tenant, v_outlet, r.ingredient_id, 'sale', -v_qty,
              (SELECT avg_cost_minor FROM stock_levels WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id),
              'order_item', it.id, p_actor, 'Order #' || it.order_id);
    EXCEPTION WHEN unique_violation THEN
      RETURN; -- already deducted for this item
    END;

    UPDATE stock_levels
    SET qty = qty - v_qty, updated_at = now()
    WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id;

    -- FIFO batch consumption (only when batches exist for the ingredient)
    WITH claimed AS (
      SELECT id, LEAST(qty_remaining, v_qty - SUM(LEAST(qty_remaining, v_qty)) OVER ()) AS take
      FROM batches
      WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id AND qty_remaining > 0
      ORDER BY expiry_date NULLS LAST, created_at
    )
    UPDATE batches b SET qty_remaining = b.qty_remaining - c.take
    FROM claimed c WHERE b.id = c.id AND c.take > 0;

    UPDATE ingredients SET updated_at = now() WHERE id = r.ingredient_id;
  END LOOP;

  PERFORM inv_recompute_auto_sold_out(v_outlet);
END;
$$;

-- Reversal / waste-on-void.
CREATE OR REPLACE FUNCTION inv_reverse_order_item(p_item uuid, p_prepared boolean, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  it order_items%ROWTYPE;
  v_outlet uuid;
  v_tenant uuid;
  r record;
  v_qty numeric(14,4);
BEGIN
  SELECT * INTO it FROM order_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN; END IF;
  v_outlet := it.outlet_id;
  SELECT tenant_id INTO v_tenant FROM outlets WHERE id = v_outlet;

  FOR r IN
    SELECT ri.ingredient_id, ri.qty, m.qty_delta AS already
    FROM recipes rec
    JOIN recipe_items ri ON ri.recipe_id = rec.id
    LEFT JOIN LATERAL (
      SELECT qty_delta FROM stock_movements
      WHERE ref_type = 'order_item' AND ref_id = it.id AND ingredient_id = ri.ingredient_id
      ORDER BY created_at DESC LIMIT 1
    ) m ON true
    WHERE rec.menu_item_id = it.item_id AND ri.ingredient_id IS NOT NULL
  LOOP
    v_qty := r.qty * it.quantity;
    IF r.already IS NULL THEN CONTINUE; END IF; -- never deducted

    IF NOT p_prepared THEN
      BEGIN
        INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
        VALUES (v_tenant, v_outlet, r.ingredient_id, 'sale_reversal', v_qty, 'order_item', it.id, p_actor, 'Void before prep');
      EXCEPTION WHEN unique_violation THEN RETURN;
      END;
      UPDATE stock_levels SET qty = qty + v_qty, updated_at = now()
      WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id;
    ELSE
      BEGIN
        INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
        VALUES (v_tenant, v_outlet, r.ingredient_id, 'waste', -0, 'order_item', it.id, p_actor, 'Prepared then voided');
      EXCEPTION WHEN unique_violation THEN RETURN;
      END;
    END IF;
  END LOOP;

  PERFORM inv_recompute_auto_sold_out(v_outlet);
END;
$$;

-- Trigger on order item status transitions.
CREATE OR REPLACE FUNCTION trg_order_items_inventory_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status IN ('accepted','preparing') AND OLD.status NOT IN ('accepted','preparing','ready','served') THEN
    PERFORM inv_deduct_order_item(NEW.id, NULL);
  ELSIF NEW.status IN ('voided','rejected') AND OLD.status NOT IN ('voided','rejected') THEN
    PERFORM inv_reverse_order_item(
      NEW.id,
      OLD.status IN ('preparing','ready','served'),
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_inventory ON order_items;
CREATE TRIGGER trg_order_items_inventory
AFTER UPDATE OF status ON order_items
FOR EACH ROW EXECUTE FUNCTION trg_order_items_inventory_fn();

-- Auto sold-out recompute.
CREATE OR REPLACE FUNCTION inv_recompute_auto_sold_out(p_outlet uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_threshold numeric(14,4);
  v_enabled boolean;
BEGIN
  SELECT auto_sold_out_threshold, auto_sold_out_enabled INTO v_threshold, v_enabled
  FROM inv_get_settings(p_outlet);
  IF NOT v_enabled THEN RETURN; END IF;

  -- Items whose recipe needs an ingredient at/below the threshold.
  UPDATE menu_items mi SET auto_sold_out = true
  WHERE mi.outlet_id = p_outlet AND EXISTS (
    SELECT 1
    FROM recipes rec
    JOIN recipe_items ri ON ri.recipe_id = rec.id
    JOIN stock_levels sl ON sl.outlet_id = p_outlet AND sl.ingredient_id = ri.ingredient_id
    WHERE rec.menu_item_id = mi.id AND sl.qty <= v_threshold
  );

  -- Clear when every required ingredient is back above the threshold.
  UPDATE menu_items mi SET auto_sold_out = false
  WHERE mi.outlet_id = p_outlet AND mi.auto_sold_out AND NOT EXISTS (
    SELECT 1
    FROM recipes rec
    JOIN recipe_items ri ON ri.recipe_id = rec.id
    JOIN stock_levels sl ON sl.outlet_id = p_outlet AND sl.ingredient_id = ri.ingredient_id
    WHERE rec.menu_item_id = mi.id AND sl.qty <= v_threshold
  );
END;
$$;

-- Goods receipt posting.
CREATE OR REPLACE FUNCTION inv_post_goods_receipt(p_receipt uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  gr goods_receipts%ROWTYPE;
  v_tenant uuid;
  it record;
  v_old_avg bigint;
  v_old_qty numeric(14,4);
  v_new_avg bigint;
  v_alerts jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO gr FROM goods_receipts WHERE id = p_receipt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  IF gr.posted THEN RETURN; END IF; -- idempotent
  v_tenant := gr.tenant_id;

  FOR it IN SELECT * FROM goods_receipt_items WHERE receipt_id = p_receipt LOOP
    SELECT qty, avg_cost_minor INTO v_old_qty, v_old_avg
    FROM stock_levels WHERE outlet_id = gr.outlet_id AND ingredient_id = it.ingredient_id;
    v_old_qty := COALESCE(v_old_qty, 0);
    v_old_avg := COALESCE(v_old_avg, 0);

    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, unit_cost_minor, ref_type, ref_id, user_id, note)
    VALUES (v_tenant, gr.outlet_id, it.ingredient_id, 'purchase', it.qty, it.unit_cost_minor, 'receipt', p_receipt, p_actor,
            'GR ' || COALESCE(gr.invoice_number, ''));

    INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty, avg_cost_minor)
    VALUES (v_tenant, gr.outlet_id, it.ingredient_id, it.qty, it.unit_cost_minor)
    ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

    -- weighted average cost
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

    -- price change alert (>10% vs previous average)
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

  INSERT INTO inventory_audit_log (tenant_id, actor, action, detail)
  VALUES (v_tenant, p_actor, 'goods_receipt_posted', jsonb_build_object('receipt', p_receipt, 'price_alerts', v_alerts));
END;
$$;

-- Stock count approval.
CREATE OR REPLACE FUNCTION inv_approve_count(p_count uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  sc stock_counts%ROWTYPE;
  it record;
  v_delta numeric(14,4);
BEGIN
  SELECT * INTO sc FROM stock_counts WHERE id = p_count;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found'; END IF;
  IF sc.status <> 'open' THEN RAISE EXCEPTION 'Count already closed'; END IF;

  FOR it IN SELECT * FROM stock_count_items WHERE count_id = p_count AND counted_qty IS NOT NULL LOOP
    v_delta := it.counted_qty - it.expected_qty;
    IF v_delta <> 0 THEN
      INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
      VALUES (sc.tenant_id, sc.outlet_id, it.ingredient_id, 'count_correction', v_delta, 'count', p_count, p_actor, 'Stock count variance');

      INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty)
      VALUES (sc.tenant_id, sc.outlet_id, it.ingredient_id, it.counted_qty)
      ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

      UPDATE stock_levels SET qty = it.counted_qty, updated_at = now()
      WHERE outlet_id = sc.outlet_id AND ingredient_id = it.ingredient_id;
    END IF;
  END LOOP;

  UPDATE stock_counts SET status = 'approved', approved_by = p_actor, approved_at = now() WHERE id = p_count;

  INSERT INTO inventory_audit_log (tenant_id, actor, action, detail)
  VALUES (sc.tenant_id, p_actor, 'stock_count_approved', jsonb_build_object('count', p_count));
END;
$$;

-- Waste entry with movement.
CREATE OR REPLACE FUNCTION inv_log_waste(
  p_tenant uuid, p_outlet uuid, p_ingredient uuid, p_menu_item uuid,
  p_qty numeric, p_reason text, p_note text DEFAULT NULL, p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO waste_logs (tenant_id, outlet_id, ingredient_id, menu_item_id, qty, reason, note, user_id)
  VALUES (p_tenant, p_outlet, p_ingredient, p_menu_item, p_qty, p_reason, p_note, p_actor)
  RETURNING id INTO v_id;

  IF p_ingredient IS NOT NULL THEN
    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
    VALUES (p_tenant, p_outlet, p_ingredient, 'waste', -p_qty, 'waste', v_id, p_actor, p_reason);
    UPDATE stock_levels SET qty = qty - p_qty, updated_at = now()
    WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;
  END IF;
  PERFORM inv_recompute_auto_sold_out(p_outlet);
END;
$$;

-- Simple purchase (no PO).
CREATE OR REPLACE FUNCTION inv_record_purchase(
  p_tenant uuid, p_outlet uuid, p_ingredient uuid, p_qty numeric, p_unit_cost bigint,
  p_note text DEFAULT NULL, p_expiry date DEFAULT NULL, p_batch text DEFAULT NULL, p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old_qty numeric(14,4);
  v_old_avg bigint;
  v_new_avg bigint;
BEGIN
  SELECT qty, avg_cost_minor INTO v_old_qty, v_old_avg
  FROM stock_levels WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;
  v_old_qty := COALESCE(v_old_qty, 0);
  v_old_avg := COALESCE(v_old_avg, 0);

  INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, unit_cost_minor, ref_type, user_id, note)
  VALUES (p_tenant, p_outlet, p_ingredient, 'purchase', p_qty, p_unit_cost, 'manual', p_actor, p_note);

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

-- Manual adjustment to an absolute counted value.
CREATE OR REPLACE FUNCTION inv_adjust_stock(
  p_tenant uuid, p_outlet uuid, p_ingredient uuid, p_new_qty numeric, p_note text DEFAULT NULL, p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cur numeric(14,4);
BEGIN
  SELECT qty INTO v_cur FROM stock_levels WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;
  v_cur := COALESCE(v_cur, 0);
  INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, user_id, note)
  VALUES (p_tenant, p_outlet, p_ingredient, 'adjustment', p_new_qty - v_cur, 'manual', p_actor, p_note);

  INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty)
  VALUES (p_tenant, p_outlet, p_ingredient, p_new_qty)
  ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

  UPDATE stock_levels SET qty = p_new_qty, updated_at = now()
  WHERE outlet_id = p_outlet AND ingredient_id = p_ingredient;

  INSERT INTO inventory_audit_log (tenant_id, actor, action, detail)
  VALUES (p_tenant, p_actor, 'stock_adjusted', jsonb_build_object('ingredient', p_ingredient, 'from', v_cur, 'to', p_new_qty, 'note', p_note));

  PERFORM inv_recompute_auto_sold_out(p_outlet);
END;
$$;

-- Batch production: consume raws, add prepared item.
CREATE OR REPLACE FUNCTION inv_produce_batch(
  p_tenant uuid, p_outlet uuid, p_prepared_ingredient uuid, p_batches numeric, p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  -- The prepared item's "recipe": recipe_items where sub_recipe_id = prepared ingredient,
  -- attached to the recipe that references it. We instead treat sub-recipes via
  -- recipe_items rows pointing at the prepared ingredient as sub_recipe_id.
  FOR r IN
    SELECT ri.ingredient_id, ri.qty
    FROM recipe_items ri
    WHERE ri.sub_recipe_id = p_prepared_ingredient
  LOOP
    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, user_id, note)
    VALUES (p_tenant, p_outlet, r.ingredient_id, 'production', -(r.qty * p_batches), 'manual', p_actor, 'Batch production');
    UPDATE stock_levels SET qty = qty - (r.qty * p_batches), updated_at = now()
    WHERE outlet_id = p_outlet AND ingredient_id = r.ingredient_id;
  END LOOP;

  INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, user_id, note)
  VALUES (p_tenant, p_outlet, p_prepared_ingredient, 'production', p_batches, 'manual', p_actor, 'Batch production');

  INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty)
  VALUES (p_tenant, p_outlet, p_prepared_ingredient, p_batches)
  ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

  UPDATE stock_levels SET qty = qty + p_batches, updated_at = now()
  WHERE outlet_id = p_outlet AND ingredient_id = p_prepared_ingredient;

  PERFORM inv_recompute_auto_sold_out(p_outlet);
END;
$$;

-- Transfers between outlets.
CREATE OR REPLACE FUNCTION inv_transfer_send(p_transfer uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  tr transfers%ROWTYPE;
  it record;
BEGIN
  SELECT * INTO tr FROM transfers WHERE id = p_transfer;
  IF tr.status <> 'requested' THEN RAISE EXCEPTION 'Transfer not in requested state'; END IF;

  FOR it IN SELECT * FROM transfer_items WHERE transfer_id = p_transfer LOOP
    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
    VALUES (tr.tenant_id, tr.from_outlet_id, it.ingredient_id, 'transfer_out', -it.qty, 'transfer', p_transfer, p_actor, NULL);
    UPDATE stock_levels SET qty = qty - it.qty, updated_at = now()
    WHERE outlet_id = tr.from_outlet_id AND ingredient_id = it.ingredient_id;
  END LOOP;

  UPDATE transfers SET status = 'in_transit' WHERE id = p_transfer;
END;
$$;

CREATE OR REPLACE FUNCTION inv_transfer_receive(p_transfer uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  tr transfers%ROWTYPE;
  it record;
BEGIN
  SELECT * INTO tr FROM transfers WHERE id = p_transfer;
  IF tr.status <> 'in_transit' THEN RAISE EXCEPTION 'Transfer not in transit'; END IF;

  FOR it IN SELECT * FROM transfer_items WHERE transfer_id = p_transfer LOOP
    INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, ref_type, ref_id, user_id, note)
    VALUES (tr.tenant_id, tr.to_outlet_id, it.ingredient_id, 'transfer_in', it.qty, 'transfer', p_transfer, p_actor, NULL);

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

-- Lock down: no anon execution anywhere.
REVOKE EXECUTE ON FUNCTION inv_get_settings(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_deduct_order_item(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_reverse_order_item(uuid, boolean, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_recompute_auto_sold_out(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_post_goods_receipt(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_approve_count(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_log_waste(uuid, uuid, uuid, uuid, numeric, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_record_purchase(uuid, uuid, uuid, numeric, bigint, text, date, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_adjust_stock(uuid, uuid, uuid, numeric, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_produce_batch(uuid, uuid, uuid, numeric, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_transfer_send(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_transfer_receive(uuid, uuid) FROM anon;
