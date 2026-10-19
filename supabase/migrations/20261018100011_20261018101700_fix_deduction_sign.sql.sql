/*
# Inventory engine fix — deduction sign error

1. Plain-English explanation
The deduction function was ADDING to stock when the kitchen accepted an item
instead of subtracting: the movement delta and the stock-level update both
used the positive recipe quantity directly. This fix negates them: a sale
need of 2 portions now records a movement of -2 and reduces stock by 2.
Negative resolved needs (modifier "replace" returning an ingredient) still
increase stock correctly, since -(-2) = +2.

2. Changes
- inv_deduct_order_item: movement qty_delta = -r.qty; stock update
  qty = qty - r.qty. FIFO consumption and sold-out recompute unchanged.

3. Security: unchanged.
*/

CREATE OR REPLACE FUNCTION inv_deduct_order_item(p_item uuid, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  it order_items%ROWTYPE;
  v_outlet uuid;
  v_tenant uuid;
  r record;
  v_qty numeric(14,4);
  v_any boolean := false;
BEGIN
  SELECT * INTO it FROM order_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN; END IF;
  v_outlet := it.outlet_id;
  SELECT tenant_id INTO v_tenant FROM outlets WHERE id = v_outlet;

  FOR r IN SELECT * FROM inv_recipe_needs(it.item_id, it.quantity, it.modifiers) LOOP
    IF r.qty = 0 THEN CONTINUE; END IF;
    v_any := true;
    v_qty := ABS(r.qty);

    BEGIN
      INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, unit_cost_minor, ref_type, ref_id, user_id, note)
      VALUES (
        v_tenant, v_outlet, r.ingredient_id,
        CASE WHEN r.qty > 0 THEN 'sale' ELSE 'sale_reversal' END,
        -r.qty,
        (SELECT avg_cost_minor FROM stock_levels WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id),
        'order_item', it.id, p_actor, 'Order item consumption'
      );
    EXCEPTION WHEN unique_violation THEN
      RETURN; -- already processed for this item
    END;

    UPDATE stock_levels
    SET qty = qty - r.qty, updated_at = now()
    WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id;

    IF r.qty > 0 THEN
      WITH claimed AS (
        SELECT id,
          LEAST(qty_remaining,
            GREATEST(v_qty - COALESCE(SUM(qty_remaining) OVER (
              ORDER BY expiry_date NULLS LAST, created_at
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0), 0)
          ) AS take
        FROM batches
        WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id AND qty_remaining > 0
      )
      UPDATE batches b SET qty_remaining = b.qty_remaining - c.take
      FROM claimed c WHERE b.id = c.id AND c.take > 0;
    END IF;

    UPDATE ingredients SET updated_at = now() WHERE id = r.ingredient_id;
  END LOOP;

  IF v_any THEN
    PERFORM inv_recompute_auto_sold_out(v_outlet);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION inv_deduct_order_item(uuid, uuid) FROM anon;
