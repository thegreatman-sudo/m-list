/*
# Inventory — PO numbering and sample-data seeding RPCs (fixed)

1. Plain-English explanation
Adds two helper functions the inventory UI calls:
- inv_next_po_number(tenant): generates the next sequential PO number
  (PO-0001, PO-0002, ...) unique per tenant, from existing rows.
- inv_seed_sample_data(tenant, outlet): loads 31 realistic sample ingredients
  across categories, three suppliers, categories and sample recipes for the
  demo restaurant, so a new user can explore the module with real-looking
  data instead of an empty screen. Guard-railed by an owner/manager role check.

2. Fix from previous attempt: the PO number used a two-argument MAX which does
   not exist in Postgres; replaced with GREATEST inside COALESCE.

3. Security: SECURITY DEFINER, anon revoked, caller must be owner/manager of
   the tenant they pass.

4. Notes: quantities numeric(14,4); costs in minor units.
*/

CREATE OR REPLACE FUNCTION inv_next_po_number(p_tenant uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 'PO-' || lpad((COALESCE(GREATEST(MAX(
    CASE WHEN po_number ~ '\\d+' THEN (regexp_replace(po_number, '\D', '', 'g'))::int ELSE 0 END
  ), 0), 0) + 1)::text, 4, '0')
  FROM purchase_orders WHERE tenant_id = p_tenant
$$;

CREATE OR REPLACE FUNCTION inv_seed_sample_data(p_tenant uuid, p_outlet uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cat_ids uuid[];
  sup1 uuid; sup2 uuid; sup3 uuid;
  v_eggs uuid;
BEGIN
  IF NOT has_role(p_tenant, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF EXISTS (SELECT 1 FROM ingredients WHERE tenant_id = p_tenant AND outlet_id = p_outlet) THEN
    RETURN;
  END IF;

  INSERT INTO ingredient_categories (tenant_id, name, sort_order) VALUES
    (p_tenant, 'Produce', 1), (p_tenant, 'Meat', 2), (p_tenant, 'Dairy', 3),
    (p_tenant, 'Dry goods', 4), (p_tenant, 'Beverage', 5), (p_tenant, 'Packaging', 6)
  ON CONFLICT (tenant_id, name) DO NOTHING;
  SELECT array_agg(id ORDER BY sort_order) INTO cat_ids FROM ingredient_categories WHERE tenant_id = p_tenant;

  INSERT INTO suppliers (tenant_id, name, contact_person, phone, email, payment_terms, lead_time_days, notes) VALUES
    (p_tenant, 'Pasuruan Fresh Produce', 'Andi', '+62 812 3456 7801', 'sales@pasuruanfresh.example', 'Net 7', 1, 'Vegetables and fruits, delivers mornings'),
    (p_tenant, 'Bogor Prime Meats', 'Siti', '+62 812 3456 7802', 'orders@bogorprime.example', 'Net 14', 2, 'Beef and poultry'),
    (p_tenant, 'Jakarta Beverage Supply', 'Rudi', '+62 812 3456 7803', 'hello@jktbev.example', 'COD', 3, 'Coffee, tea, soft drinks')
  RETURNING id INTO sup1, sup2, sup3;

  INSERT INTO ingredients (tenant_id, outlet_id, name, sku, category_id, stock_unit, purchase_unit, purchase_conversion, default_supplier_id, cost_per_stock_unit_minor, min_level, par_level, storage_location, shelf_life_days)
  VALUES
   (p_tenant, p_outlet, 'Tomatoes',        'PRD-001', cat_ids[1], 'kg', 'crate', 20, sup1,  12000,  5, 25, 'Walk-in',    7),
   (p_tenant, p_outlet, 'Onions',          'PRD-002', cat_ids[1], 'kg', 'sack',  25, sup1,   9000,  5, 20, 'Dry store', 30),
   (p_tenant, p_outlet, 'Garlic',          'PRD-003', cat_ids[1], 'kg', 'kg',     1, sup1,  35000,  1,  5, 'Dry store', 60),
   (p_tenant, p_outlet, 'Lettuce',         'PRD-004', cat_ids[1], 'kg', 'crate', 10, sup1,  18000,  2, 10, 'Walk-in',    5),
   (p_tenant, p_outlet, 'Cucumbers',       'PRD-005', cat_ids[1], 'kg', 'crate', 15, sup1,  10000,  2, 10, 'Walk-in',    7),
   (p_tenant, p_outlet, 'Bell peppers',    'PRD-006', cat_ids[1], 'kg', 'crate', 12, sup1,  28000,  2,  8, 'Walk-in',    7),
   (p_tenant, p_outlet, 'Lemons',          'PRD-007', cat_ids[1], 'kg', 'box',   20, sup1,  22000,  1,  6, 'Walk-in',   14),
   (p_tenant, p_outlet, 'Potatoes',        'PRD-008', cat_ids[1], 'kg', 'sack',  25, sup1,  11000,  8, 30, 'Dry store', 21),
   (p_tenant, p_outlet, 'Carrots',         'PRD-009', cat_ids[1], 'kg', 'sack',  20, sup1,  10000,  3, 15, 'Walk-in',   14),
   (p_tenant, p_outlet, 'Beef chuck',      'MEA-001', cat_ids[2], 'kg', 'box',   10, sup2, 110000,  4, 20, 'Freezer',    5),
   (p_tenant, p_outlet, 'Chicken thigh',   'MEA-002', cat_ids[2], 'kg', 'box',   10, sup2,  38000,  4, 15, 'Chiller',    3),
   (p_tenant, p_outlet, 'Beef patty 90g',  'MEA-003', cat_ids[2], 'pcs','box',  48, sup2,   9500, 24, 96, 'Freezer',   90),
   (p_tenant, p_outlet, 'Bacon slices',    'MEA-004', cat_ids[2], 'kg', 'pack',   5, sup2,  78000,  1,  5, 'Chiller',   14),
   (p_tenant, p_outlet, 'Mozzarella',      'DAI-001', cat_ids[3], 'kg', 'block',  3, sup1,  85000,  2,  8, 'Chiller',   21),
   (p_tenant, p_outlet, 'Cheddar slices',  'DAI-002', cat_ids[3], 'pcs','pack', 20, sup1,   2500, 40,120, 'Chiller',   30),
   (p_tenant, p_outlet, 'Butter',          'DAI-003', cat_ids[3], 'g',  'block',250, sup1,     28, 500, 2500, 'Chiller',  60),
   (p_tenant, p_outlet, 'Milk',            'DAI-004', cat_ids[3], 'l',  'carton', 1, sup1,  16000,  6, 24, 'Chiller',    7),
   (p_tenant, p_outlet, 'Oat milk',        'DAI-005', cat_ids[3], 'l',  'carton', 1, sup1,  28000,  3, 12, 'Chiller',  180),
   (p_tenant, p_outlet, 'Cream',           'DAI-006', cat_ids[3], 'l',  'carton', 1, sup1,  32000,  2,  8, 'Chiller',   10),
   (p_tenant, p_outlet, 'Flour',           'DRY-001', cat_ids[4], 'kg', 'sack',  25, sup2,   8000, 10, 50, 'Dry store',180),
   (p_tenant, p_outlet, 'Rice',            'DRY-002', cat_ids[4], 'kg', 'sack',  25, sup2,  12500, 10, 50, 'Dry store',180),
   (p_tenant, p_outlet, 'Pasta',           'DRY-003', cat_ids[4], 'kg', 'carton',10, sup2,  18000,  4, 20, 'Dry store',360),
   (p_tenant, p_outlet, 'Olive oil',       'DRY-004', cat_ids[4], 'l',  'bottle', 1, sup2,  85000,  2,  8, 'Dry store',360),
   (p_tenant, p_outlet, 'Sugar',           'DRY-005', cat_ids[4], 'kg', 'sack',  25, sup2,  14000,  5, 25, 'Dry store',360),
   (p_tenant, p_outlet, 'Salt',            'DRY-006', cat_ids[4], 'kg', 'pack',   1, sup2,   6000,  1,  5, 'Dry store',720),
   (p_tenant, p_outlet, 'Eggs',            'DRY-007', cat_ids[4], 'pcs','tray',  30, sup1,   2500, 30,120, 'Chiller',   14),
   (p_tenant, p_outlet, 'Coffee beans',    'BEV-001', cat_ids[5], 'kg', 'bag',    1, sup3, 220000,  2,  8, 'Dry store', 90),
   (p_tenant, p_outlet, 'Tea bags',        'BEV-002', cat_ids[5], 'pcs','box', 100, sup3,    400,100,400, 'Dry store',360),
   (p_tenant, p_outlet, 'Sparkling water', 'BEV-003', cat_ids[5], 'bottle','case',24, sup3,  8500, 12, 48, 'Chiller',  180),
   (p_tenant, p_outlet, 'Burger buns',     'PKG-001', cat_ids[6], 'pcs','carton',24, sup2,   3500, 24, 96, 'Dry store',  4),
   (p_tenant, p_outlet, 'Takeaway boxes',  'PKG-002', cat_ids[6], 'pcs','carton',50, sup3,   1200, 50,250, 'Dry store',999);

  INSERT INTO stock_levels (tenant_id, outlet_id, ingredient_id, qty, avg_cost_minor)
  SELECT p_tenant, p_outlet, i.id, i.par_level * 0.7, i.cost_per_stock_unit_minor
  FROM ingredients i WHERE i.tenant_id = p_tenant AND i.outlet_id = p_outlet
  ON CONFLICT (outlet_id, ingredient_id) DO NOTHING;

  INSERT INTO stock_movements (tenant_id, outlet_id, ingredient_id, type, qty_delta, unit_cost_minor, ref_type, note)
  SELECT p_tenant, p_outlet, i.id, 'purchase', i.par_level * 0.7, i.cost_per_stock_unit_minor, 'manual', 'Opening stock'
  FROM ingredients i WHERE i.tenant_id = p_tenant AND i.outlet_id = p_outlet;

  INSERT INTO recipes (tenant_id, outlet_id, menu_item_id, yield_pct)
  SELECT p_tenant, p_outlet, mi.id, 100
  FROM menu_items mi
  WHERE mi.outlet_id = p_outlet AND mi.name IN ('Classic Beef Burger','Margherita Pizza','Nasi Goreng')
    AND NOT EXISTS (SELECT 1 FROM recipes r WHERE r.menu_item_id = mi.id);

  INSERT INTO recipe_items (tenant_id, recipe_id, ingredient_id, qty)
  SELECT p_tenant, r.id, ing.id, v.qty
  FROM recipes r
  JOIN (VALUES
    ('Classic Beef Burger', 'Beef patty 90g', 1),
    ('Classic Beef Burger', 'Burger buns', 1),
    ('Classic Beef Burger', 'Cheddar slices', 1),
    ('Classic Beef Burger', 'Tomatoes', 0.05),
    ('Classic Beef Burger', 'Lettuce', 0.03),
    ('Margherita Pizza', 'Flour', 0.25),
    ('Margherita Pizza', 'Mozzarella', 0.12),
    ('Margherita Pizza', 'Tomatoes', 0.1),
    ('Nasi Goreng', 'Rice', 0.25),
    ('Nasi Goreng', 'Garlic', 0.01),
    ('Nasi Goreng', 'Eggs', 2)
  ) AS v(dish, ingredient, qty) ON true
  JOIN ingredients ing ON ing.tenant_id = p_tenant AND ing.outlet_id = p_outlet AND ing.name = v.ingredient
  JOIN menu_items mi ON mi.outlet_id = p_outlet AND mi.name = v.dish
  WHERE r.menu_item_id = mi.id
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION inv_next_po_number(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION inv_seed_sample_data(uuid, uuid) FROM anon;
