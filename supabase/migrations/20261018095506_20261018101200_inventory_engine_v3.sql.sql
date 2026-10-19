/*
# Inventory engine v3 — sub-recipe model fix + resolver rewrite

1. Plain-English explanation
Fixes how sub-recipes (prep items like house sauce) store their composition.
Previously a recipe row could point to EITHER a raw ingredient OR a
sub-recipe, which made a sub-recipe's own ingredients unrepresentable.
New model: a recipe row with sub_recipe_id set means "this quantity of the
raw ingredient goes into that prepared sub-recipe item"; rows with
sub_recipe_id NULL are the dish's own ingredients. This keeps one table and
lets the deduction engine expand a dish into its raw ingredients through one
level of sub-recipes.

2. Changes
- recipe_items: replaces the either/or CHECK with one that requires
  ingredient_id NOT NULL always, and sub_recipe_id optional.
- inv_recipe_needs: rewritten with the corrected recursive expansion.
  Dish-level quantities are divided by the recipe yield; sub-recipe
  quantities are per one unit of the prepared item.

3. Security: unchanged. No data exists yet, so the constraint change is safe.
*/

ALTER TABLE recipe_items DROP CONSTRAINT IF EXISTS recipe_items_check;
ALTER TABLE recipe_items DROP CONSTRAINT IF EXISTS recipe_items_ingredient_check;

-- ingredient_id is always required; sub_recipe_id optionally marks the row
-- as part of a sub-recipe instead of the dish itself.
ALTER TABLE recipe_items
  ALTER COLUMN ingredient_id SET NOT NULL,
  ADD CONSTRAINT recipe_items_shape_check CHECK (qty > 0);

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
    -- dish-level rows, divided by yield (trim loss)
    SELECT b.ingredient_id, b.qty * p_portions / (COALESCE((SELECT yield_pct FROM recipes WHERE menu_item_id = p_menu_item), 100) / 100.0)
    FROM base b WHERE b.sub_recipe_id IS NULL
    UNION ALL
    -- expand prepared items one level: their rows' qty is per unit prepared
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
  GROUP BY an.ingredient_id
$$;

REVOKE EXECUTE ON FUNCTION inv_recipe_needs(uuid, numeric, jsonb) FROM anon;
