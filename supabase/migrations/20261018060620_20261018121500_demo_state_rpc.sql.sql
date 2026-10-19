/*
# Demo snapshot RPC + tenant backfill helpers

1. Plain-English explanation
The public marketing site offers a read-only demo of the original Saffron &
Smoke venue. Logged-out visitors cannot query tenant tables directly (that is
the point of multi-tenant RLS), so this migration adds a SECURITY DEFINER
function that returns a snapshot of the DEMO tenant's live data — and only the
demo tenant's — to anonymous visitors. All demo staff views are read-only;
guest ordering on the demo tables still works through the existing guest RPCs.

2. New functions
- `demo_get_state()` — snapshot of demo tenant: outlet info, tables, open
  orders + items, today's reservations, open service requests. Hard-restricted
  to the tenant flagged is_demo = true; returns empty object otherwise.

3. Security
- Granted to anon + authenticated; derives nothing from user input except the
  constant demo tenant flag.
*/

CREATE OR REPLACE FUNCTION demo_get_state()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_outlet outlets%ROWTYPE;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE is_demo = true LIMIT 1;
  IF v_tenant IS NULL THEN
    RETURN json_build_object('available', false);
  END IF;

  SELECT * INTO v_outlet FROM outlets WHERE tenant_id = v_tenant LIMIT 1;

  RETURN json_build_object(
    'available', true,
    'outlet', json_build_object(
      'id', v_outlet.id, 'name', v_outlet.name, 'currency_code', v_outlet.currency_code,
      'tax_percent', v_outlet.tax_percent, 'service_charge_percent', v_outlet.service_charge_percent,
      'opening_hours', v_outlet.opening_hours
    ),
    'areas', (
      SELECT COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name, 'sort_order', a.sort_order) ORDER BY a.sort_order), '[]'::json)
      FROM areas a WHERE a.outlet_id = v_outlet.id AND a.archived_at IS NULL
    ),
    'tables', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', t.id, 'area_id', t.area_id, 'label', t.label, 'status', t.status,
               'qr_token', t.qr_token, 'min_seats', t.min_seats, 'max_seats', t.max_seats
             ) ORDER BY t.label), '[]'::json)
      FROM tables t WHERE t.outlet_id = v_outlet.id
    ),
    'orders', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', o.id, 'table_id', o.table_id, 'order_number', o.order_number,
               'status', o.status, 'source', o.source, 'created_at', o.created_at
             ) ORDER BY o.created_at DESC), '[]'::json)
      FROM (
        SELECT * FROM orders
        WHERE outlet_id = v_outlet.id AND created_at > now() - interval '12 hours'
        LIMIT 100
      ) o
    ),
    'order_items', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', oi.id, 'order_id', oi.order_id, 'name', oi.name, 'station', oi.station,
               'quantity', oi.quantity, 'unit_price_minor', oi.unit_price_minor,
               'modifiers', oi.modifiers, 'status', oi.status, 'allergy_alert', oi.allergy_alert,
               'created_at', oi.created_at
             ) ORDER BY oi.created_at), '[]'::json)
      FROM (
        SELECT oi.* FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.outlet_id = v_outlet.id AND o.created_at > now() - interval '12 hours'
        LIMIT 400
      ) oi
    ),
    'reservations', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', r.id, 'guest_name', r.guest_name, 'party_size', r.party_size,
               'booking_time', r.booking_time, 'status', r.status, 'table_id', r.table_id
             ) ORDER BY r.booking_time), '[]'::json)
      FROM reservations r
      WHERE r.outlet_id = v_outlet.id AND r.booking_date = CURRENT_DATE
    ),
    'service_requests', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', s.id, 'table_id', s.table_id, 'reason', s.reason,
               'status', s.status, 'created_at', s.created_at
             ) ORDER BY s.created_at DESC), '[]'::json)
      FROM service_requests s
      WHERE s.outlet_id = v_outlet.id AND s.status <> 'done'
        AND s.created_at > now() - interval '6 hours'
    ),
    'bills', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', b.id, 'table_id', b.table_id, 'total_minor', b.total_minor, 'status', b.status
             )), '[]'::json)
      FROM bills b
      WHERE b.outlet_id = v_outlet.id AND b.status = 'open'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION demo_get_state() TO anon, authenticated;