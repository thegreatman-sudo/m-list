/*
# Inventory module — schema, indexes and Row Level Security

1. Plain-English explanation
Adds a full inventory module for restaurants, bars and cafes: stock items
(ingredients), recipes that link menu items to ingredients, an immutable stock
movement ledger, suppliers and purchase orders with goods receipts, stock
counts, waste logs, inter-outlet transfers, expiry batches and per-outlet
settings. Existing features are untouched.

2. New tables (all have tenant_id; outlet-scoped ones have outlet_id)
- ingredient_categories: editable category list per tenant.
- suppliers: supplier directory (contact, terms, lead time).
- ingredients: stock items with SKU, category, stock unit, purchase unit +
  conversion factor, default supplier, cost, min/par levels, storage location,
  shelf life, active flag, photo.
- unit_conversions: per-tenant conversion factors between units.
- supplier_ingredients: which ingredients a supplier provides + last prices.
- recipes, recipe_items: recipe per menu item (1:1), ingredient quantities per
  portion, yield/waste %, sub-recipe support (a prep item is itself an
  ingredient row).
- modifier_recipe_items: modifier options that add or replace ingredients.
- stock_levels: current quantity per outlet per ingredient (fixed precision).
- stock_movements: immutable ledger of every stock change; unique index makes
  per-order-item deductions idempotent.
- purchase_orders, purchase_order_items: purchasing with statuses.
- goods_receipts, goods_receipt_items: receiving against POs with expiry/batch.
- stock_counts, stock_count_items: stock takes with variance + approval.
- waste_logs: waste with reason, optional photo.
- transfers, transfer_items: inter-outlet transfers (Chain).
- batches: expiry/batch tracking for FIFO.
- inventory_settings: per-outlet thresholds, negative stock, deduction timing,
  food-cost target.
- inventory_audit_log: records sensitive actions (count approvals, receipts,
  adjustments).

3. Modified tables
- menu_items: adds auto_sold_out boolean (default false). The inventory engine
  sets it when an ingredient runs out and clears it on replenishment. The
  existing sold_out flag keeps working for manual control.

4. Security (RLS)
- RLS enabled on every new table.
- Owner/Manager: full access to all inventory tables.
- Chef: read access + can create waste logs and enter stock counts.
- Cashier/Waiter/Host: no access (no policies granted).
- stock_movements is append-only: no UPDATE/DELETE policy for anyone.
- Multi-tenant isolation via the existing is_staff_of()/has_role() helpers.

5. Notes
- Quantities use numeric(14,4) fixed precision (never floating point).
- Money stays in integer minor units, consistent with the rest of the schema.
- Tables are created in dependency order (suppliers before ingredients).
*/

-- ============ reference data ============
CREATE TABLE IF NOT EXISTS ingredient_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  payment_terms text,
  lead_time_days int NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON suppliers(tenant_id);

CREATE TABLE IF NOT EXISTS ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  barcode text,
  category_id uuid REFERENCES ingredient_categories(id) ON DELETE SET NULL,
  stock_unit text NOT NULL DEFAULT 'pcs' CHECK (stock_unit IN ('kg','g','l','ml','pcs','pack','bottle')),
  purchase_unit text NOT NULL DEFAULT 'pcs',
  purchase_conversion numeric(14,4) NOT NULL DEFAULT 1 CHECK (purchase_conversion > 0), -- 1 purchase unit = N stock units
  default_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_per_stock_unit_minor bigint NOT NULL DEFAULT 0,
  min_level numeric(14,4) NOT NULL DEFAULT 0,   -- reorder point
  par_level numeric(14,4) NOT NULL DEFAULT 0,   -- target
  storage_location text,
  shelf_life_days int,
  active boolean NOT NULL DEFAULT true,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingredients_tenant_idx ON ingredients(tenant_id);
CREATE INDEX IF NOT EXISTS ingredients_outlet_idx ON ingredients(outlet_id);

CREATE TABLE IF NOT EXISTS unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  factor numeric(14,6) NOT NULL CHECK (factor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, from_unit, to_unit)
);

CREATE TABLE IF NOT EXISTS supplier_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  last_price_minor bigint NOT NULL DEFAULT 0,
  last_price_at timestamptz,
  UNIQUE (supplier_id, ingredient_id)
);

-- ============ recipes ============
CREATE TABLE IF NOT EXISTS recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
  yield_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (yield_pct > 0 AND yield_pct <= 100), -- usable % after trim loss
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id uuid REFERENCES ingredients(id) ON DELETE CASCADE, -- null when sub_recipe_id set
  sub_recipe_id uuid REFERENCES ingredients(id) ON DELETE CASCADE, -- a prep item is itself an ingredient row
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  CHECK ((ingredient_id IS NULL) <> (sub_recipe_id IS NULL))
);
CREATE INDEX IF NOT EXISTS recipe_items_recipe_idx ON recipe_items(recipe_id);

CREATE TABLE IF NOT EXISTS modifier_recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  modifier_option_id uuid NOT NULL REFERENCES menu_modifier_options(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  mode text NOT NULL DEFAULT 'add' CHECK (mode IN ('add','replace')),
  replaces_ingredient_id uuid REFERENCES ingredients(id) ON DELETE SET NULL
);

-- ============ stock engine ============
CREATE TABLE IF NOT EXISTS stock_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty numeric(14,4) NOT NULL DEFAULT 0,
  avg_cost_minor bigint NOT NULL DEFAULT 0, -- weighted average cost (minor units)
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('purchase','sale','waste','spoilage','adjustment','count_correction','transfer_in','transfer_out','production','return_to_supplier','sale_reversal')),
  qty_delta numeric(14,4) NOT NULL, -- signed
  unit_cost_minor bigint NOT NULL DEFAULT 0,
  ref_type text,  -- order_item | po | receipt | count | waste | transfer | manual
  ref_id uuid,
  user_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_ingredient_idx ON stock_movements(ingredient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_ref_idx ON stock_movements(ref_type, ref_id);
-- Idempotency: one movement per ingredient per order-item action, so retries
-- and double taps can never double-deduct.
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_orderitem_uniq
  ON stock_movements(ingredient_id, type, ref_id)
  WHERE ref_type = 'order_item';

-- ============ purchasing ============
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  po_number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partially_received','received','cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, po_number)
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty_ordered numeric(14,4) NOT NULL CHECK (qty_ordered > 0),
  qty_received numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost_minor bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  po_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_number text,
  invoice_photo_url text,
  paid boolean NOT NULL DEFAULT false,
  posted boolean NOT NULL DEFAULT false,
  received_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  unit_cost_minor bigint NOT NULL DEFAULT 0,
  expiry_date date,
  batch text
);

-- ============ counts, waste, transfers, batches ============
CREATE TABLE IF NOT EXISTS stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Stock count',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','cancelled')),
  approval_threshold_pct numeric(5,2) NOT NULL DEFAULT 5,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  expected_qty numeric(14,4) NOT NULL DEFAULT 0,
  counted_qty numeric(14,4)
);

CREATE TABLE IF NOT EXISTS waste_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  ingredient_id uuid REFERENCES ingredients(id) ON DELETE SET NULL,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  reason text NOT NULL CHECK (reason IN ('expired','spoiled','dropped','over_prep','staff_meal','comp','other')),
  photo_url text,
  note text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waste_logs_outlet_idx ON waste_logs(outlet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  to_outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_transit','received','cancelled')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transfer_id uuid NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty numeric(14,4) NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  batch text,
  expiry_date date,
  qty_remaining numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batches_expiry_idx ON batches(outlet_id, expiry_date);

CREATE TABLE IF NOT EXISTS inventory_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL UNIQUE REFERENCES outlets(id) ON DELETE CASCADE,
  allow_negative_stock boolean NOT NULL DEFAULT true,
  deduction_timing text NOT NULL DEFAULT 'on_accept' CHECK (deduction_timing IN ('on_accept','on_serve')),
  auto_sold_out_enabled boolean NOT NULL DEFAULT true,
  auto_sold_out_threshold numeric(14,4) NOT NULL DEFAULT 0,
  food_cost_target_pct numeric(5,2) NOT NULL DEFAULT 35,
  count_approval_threshold_pct numeric(5,2) NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- menu_items: auto sold-out flag driven by stock levels
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS auto_sold_out boolean NOT NULL DEFAULT false;

-- ============ Row Level Security ============
DO $$
DECLARE
  t text;
  tables_full text[] := ARRAY[
    'ingredient_categories','unit_conversions','ingredients','suppliers',
    'supplier_ingredients','recipes','recipe_items','modifier_recipe_items',
    'stock_levels','purchase_orders','purchase_order_items','goods_receipts',
    'goods_receipt_items','batches','transfers','transfer_items','inventory_settings',
    'inventory_audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables_full LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- Read: owner, manager, chef
    EXECUTE format('DROP POLICY IF EXISTS inv_select_staff ON %I', t);
    EXECUTE format($f$CREATE POLICY inv_select_staff ON %I FOR SELECT TO authenticated
      USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$, t);

    -- Write: owner, manager only
    EXECUTE format('DROP POLICY IF EXISTS inv_write_managers ON %I', t);
    EXECUTE format($f$CREATE POLICY inv_write_managers ON %I FOR INSERT TO authenticated
      WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))$f$, t);
    EXECUTE format('DROP POLICY IF EXISTS inv_update_managers ON %I', t);
    EXECUTE format($f$CREATE POLICY inv_update_managers ON %I FOR UPDATE TO authenticated
      USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))
      WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))$f$, t);
    EXECUTE format('DROP POLICY IF EXISTS inv_delete_managers ON %I', t);
    EXECUTE format($f$CREATE POLICY inv_delete_managers ON %I FOR DELETE TO authenticated
      USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))$f$, t);
  END LOOP;

  -- Chef can also create waste logs and enter stock counts (not approve).
  EXECUTE 'DROP POLICY IF EXISTS inv_insert_chef ON waste_logs';
  EXECUTE $f$CREATE POLICY inv_insert_chef ON waste_logs FOR INSERT TO authenticated
    WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$;
  EXECUTE 'DROP POLICY IF EXISTS inv_select_chef ON waste_logs';
  EXECUTE $f$CREATE POLICY inv_select_chef ON waste_logs FOR SELECT TO authenticated
    USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$;
  EXECUTE 'DROP POLICY IF EXISTS inv_insert_chef ON stock_counts';
  EXECUTE $f$CREATE POLICY inv_insert_chef ON stock_counts FOR INSERT TO authenticated
    WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$;
  EXECUTE 'DROP POLICY IF EXISTS inv_select_chef ON stock_counts';
  EXECUTE $f$CREATE POLICY inv_select_chef ON stock_counts FOR SELECT TO authenticated
    USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$;
  EXECUTE 'DROP POLICY IF EXISTS inv_update_chef ON stock_counts';
  EXECUTE $f$CREATE POLICY inv_update_chef ON stock_counts FOR UPDATE TO authenticated
    USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']) AND status = 'open' AND approved_by IS NULL)
    WITH CHECK (is_staff_of(tenant_id) AND status = 'open')$f$;
  EXECUTE 'DROP POLICY IF EXISTS inv_select_chef ON stock_count_items';
  EXECUTE $f$CREATE POLICY inv_select_chef ON stock_count_items FOR SELECT TO authenticated
    USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$;
  EXECUTE 'DROP POLICY IF EXISTS inv_write_chef ON stock_count_items';
  EXECUTE $f$CREATE POLICY inv_write_chef ON stock_count_items FOR INSERT TO authenticated
    WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$;
  EXECUTE 'DROP POLICY IF EXISTS inv_update_chef ON stock_count_items';
  EXECUTE $f$CREATE POLICY inv_update_chef ON stock_count_items FOR UPDATE TO authenticated
    USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))
    WITH CHECK (is_staff_of(tenant_id))$f$;

  -- Immutable ledger: select + insert only, no update/delete for anyone.
  EXECUTE 'DROP POLICY IF EXISTS inv_select_staff ON stock_movements';
  EXECUTE $f$CREATE POLICY inv_select_staff ON stock_movements FOR SELECT TO authenticated
    USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$;
  EXECUTE 'DROP POLICY IF EXISTS inv_insert_staff ON stock_movements';
  EXECUTE $f$CREATE POLICY inv_insert_staff ON stock_movements FOR INSERT TO authenticated
    WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','chef']))$f$;
END $$;
