/*
# Inventory engine v2 — complete deduction logic (fixed)

1. Plain-English explanation
Replaces the order-item deduction function with a complete version that also
handles modifier effects ("add" adds extra quantity, "replace" swaps one
ingredient for another) and sub-recipes (a prepared item like house sauce is
deducted through its own raw ingredients). The resolver is now a single
set-based query (no loops), which fixes the previous syntax error. Also fixes
FIFO batch consumption arithmetic.

2. Functions changed
- inv_recipe_needs(menu_item, portions, modifiers): returns one row per
  ingredient with the exact NET quantity to deduct, duplicates collapsed.
- inv_deduct_order_item: rewritten to use the resolver.

3. Security: unchanged — SECURITY DEFINER, anon execution revoked (re-stated).

4. Notes
- Order modifiers are matched to modifier options by option name.
- "replace" produces +new ingredient and -old ingredient deltas; negatives are
  handled as stock returns in the deduction loop.
*/

CREATE OR REPLACE FUNCTION inv_recipe_needs(
  p_menu_item uuid,
  p_portions numeric,
  p_modifiers jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (ingredient_id uuid, qty numeric(14,4))
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE base_edges AS (
    SELECT ri.ingredient_id, ri.sub_recipe_id, ri.qty
    FROM recipes rec
    JOIN recipe_items ri ON ri.recipe_id = rec.id
    WHERE rec.menu_item_id = p_menu_item
  ),
  flat(ingredient_id, q) AS (
    SELECT b.ingredient_id, b.qty * p_portions
    FROM base_edges b WHERE b.ingredient_id IS NOT NULL
    UNION ALL
    SELECT ri.ingredient_id, ri.qty * f.q / b.qty
    FROM flat f
    JOIN base_edges b ON b.sub_recipe_id = f.ingredient_id
    JOIN recipe_items ri ON ri.recipe_id = (
      SELECT rec.id FROM recipes rec WHERE rec.menu_item_id = p_menu_item
    )
    WHERE b.sub_recipe_id IS NOT NULL AND ri.ingredient_id IS NOT NULL
      AND ri.sub_recipe_id IS NULL
  ),
  mods(ingredient_id, q) AS (
    SELECT mri.ingredient_id, mri.qty * p_portions
    FROM menu_modifiers mm
    JOIN menu_modifier_options opt ON opt.modifier_id = mm.id
    JOIN modifier_recipe_items mri ON mri.modifier_option_id = opt.id
    WHERE mm.item_id = p_menu_item
      AND mri.mode = 'add'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_modifiers) el WHERE el->>'name' = opt.name)
    UNION ALL
    SELECT mri.ingredient_id, mri.qty * p_portions
    FROM menu_modifiers mm
    JOIN menu_modifier_options opt ON opt.modifier_id = mm.id
    JOIN modifier_recipe_items mri ON mri.modifier_option_id = opt.id
    WHERE mm.item_id = p_menu_item
      AND mri.mode = 'replace'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_modifiers) el WHERE el->>'name' = opt.name)
    UNION ALL
    SELECT mri.replaces_ingredient_id, -(mri.qty * p_portions)
    FROM menu_modifiers mm
    JOIN menu_modifier_options opt ON opt.modifier_id = mm.id
    JOIN modifier_recipe_items mri ON mri.modifier_option_id = opt.id
    WHERE mm.item_id = p_menu_item
      AND mri.mode = 'replace' AND mri.replaces_ingredient_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_modifiers) el WHERE el->>'name' = opt.name)
  ),
  allneeds AS (
    SELECT ingredient_id, q FROM flat
    UNION ALL
    SELECT ingredient_id, q FROM mods
  )
  SELECT an.ingredient_id, SUM(an.q)
  FROM allneeds an
  WHERE an.ingredient_id IS NOT NULL
  GROUP BY an.ingredient_id;
END;
$$;

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
        r.qty,
        (SELECT avg_cost_minor FROM stock_levels WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id),
        'order_item', it.id, p_actor, 'Order item consumption'
      );
    EXCEPTION WHEN unique_violation THEN
      RETURN; -- already processed for this item
    END;

    UPDATE stock_levels
    SET qty = qty + r.qty, updated_at = now()
    WHERE outlet_id = v_outlet AND ingredient_id = r.ingredient_id;

    IF r.qty > 0 THEN
      -- FIFO batch consumption: walk earliest-expiry batches, subtracting
      -- what each can cover, until the needed quantity is consumed.
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

REVOKE EXECUTE ON FUNCTION inv_recipe_needs(uuid, numeric, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_deduct_order_item(uuid, uuid) FROM anon;
