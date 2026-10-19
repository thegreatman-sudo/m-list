/*
# Enable RLS on remaining inventory tables

1. Problem
- Four inventory tables had policies written but RLS itself was never enabled:
  `stock_movements`, `stock_counts`, `stock_count_items`, `waste_logs`.
- Because RLS was off, any authenticated user from ANY tenant could read those
  rows (the policies were ignored entirely). Tenant isolation was broken for
  the stock ledger, stock counts and waste log.

2. Changes
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on the four tables above.
- No policy changes: the correct policies (scoped via `is_staff_of` +
  `has_role`) already exist on `stock_movements` and `stock_counts`.
- `stock_count_items` and `waste_logs` get policies scoped through their parent
  (`stock_counts` / same-tenant check) mirroring the pattern used on
  `goods_receipt_items` and `transfer_items`.

3. Security
- Restores strict tenant isolation on all inventory tables.
*/

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_sci_select_staff" ON stock_count_items;
CREATE POLICY "inv_sci_select_staff" ON stock_count_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM stock_counts sc
    WHERE sc.id = stock_count_items.count_id
      AND is_staff_of(sc.tenant_id)
      AND has_role(sc.tenant_id, ARRAY['owner','manager','chef']::text[])
  )
);

DROP POLICY IF EXISTS "inv_sci_insert_staff" ON stock_count_items;
CREATE POLICY "inv_sci_insert_staff" ON stock_count_items FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM stock_counts sc
    WHERE sc.id = stock_count_items.count_id
      AND is_staff_of(sc.tenant_id)
      AND has_role(sc.tenant_id, ARRAY['owner','manager','chef']::text[])
  )
);

DROP POLICY IF EXISTS "inv_waste_select_staff" ON waste_logs;
CREATE POLICY "inv_waste_select_staff" ON waste_logs FOR SELECT
TO authenticated
USING (
  is_staff_of(tenant_id)
  AND has_role(tenant_id, ARRAY['owner','manager','chef']::text[])
);

DROP POLICY IF EXISTS "inv_waste_insert_staff" ON waste_logs;
CREATE POLICY "inv_waste_insert_staff" ON waste_logs FOR INSERT
TO authenticated
WITH CHECK (
  is_staff_of(tenant_id)
  AND has_role(tenant_id, ARRAY['owner','manager','chef']::text[])
);
