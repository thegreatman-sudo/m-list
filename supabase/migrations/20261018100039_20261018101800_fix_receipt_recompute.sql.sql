/*
# Inventory engine fix — clear auto sold-out after goods receipt

1. Plain-English explanation
When a goods receipt replenishes an ingredient, menu items that had been
auto-sold-out because that ingredient was empty must come back automatically.
inv_post_goods_receipt updated stock but never re-ran the sold-out recompute,
so items stayed hidden until some other action touched the outlet.

2. Changes
- inv_post_goods_receipt: calls inv_recompute_auto_sold_out(gr.outlet_id)
  after posting.

3. Security: unchanged.
*/

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
  VALUES (v_tenant, p_actor, 'goods_receipt_posted', jsonb_build_object('receipt', p_receipt, 'price_alerts', v_alerts));
END;
$$;

REVOKE EXECUTE ON FUNCTION inv_post_goods_receipt(uuid, uuid) FROM anon;
