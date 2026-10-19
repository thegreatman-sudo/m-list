/*
# Inventory engine v4 — sub-recipe expansion correctness

1. Plain-English explanation
Fixes the recipe resolver so a prepared sub-recipe (e.g. house sauce) is never
double-counted: when an ingredient has its own composition (prep rows), the
engine expands it into those raw ingredients instead of deducting the prepared
item itself. Leaves — plain ingredients with no composition — are what gets
deducted. Works through multiple nesting levels.

2. Changes
- inv_recipe_needs: final selection now filters to leaf ingredients only.

3. Security: unchanged (SECURITY DEFINER, anon revoked).
*/

CREATE OR REPLACE FUNCTION inv_recipe_needs(
  p_menu_item uuid,
  p_portions numeric,
  p_modifiers jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (ingredient_id uuid, qty numeric(14,4))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE base AS (
    SELECT ri.ingredient_id, ri.sub_recipe_id, ri.qty
    FROM recipes rec
    JOIN recipe_items ri ON ri.recipe_id = rec.id
    WHERE rec.menu_item_id = p_menu_item
  ),
  flat(ingredient_id, q) AS (
    SELECT b.ingredient_id, b.qty * p_portions / (COALESCE((SELECT yield_pct FROM recipes WHERE menu_item_id = p_menu_item), 100) / 100.0)
    FROM base b WHERE b.sub_recipe_id IS NULL
    UNION ALL
    SELECT ri.ingredient_id, ri.qty * f.q
    FROM flat f
    JOIN recipe_items ri ON ri.sub_recipe_id = f.ingredient_id
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
  SELECT an.ingredient_id, SUM(an.q)::numeric(14,4)
  FROM allneeds an
  WHERE an.ingredient_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM recipe_items sub WHERE sub.sub_recipe_id = an.ingredient_id)
  GROUP BY an.ingredient_id
$$;

REVOKE EXECUTE ON FUNCTION inv_recipe_needs(uuid, numeric, jsonb) FROM anon;
