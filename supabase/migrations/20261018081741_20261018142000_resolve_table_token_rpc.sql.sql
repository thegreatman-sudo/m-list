/*
# resolve_table_token RPC + rate_limits table

## What this does
Adds the server-side token resolution used by the `resolve-table-token` edge
function when a guest scans a QR code. It validates the token, checks whether
the outlet is currently open (based on opening_hours + the outlet's timezone),
finds or creates the open table session, and returns the tenant, outlet, area,
table, and active menu — without exposing any internal IDs to the guest.

Also adds a `rate_limits` table for per-IP throttling. Edge function instances
don't share memory, so rate-limit counters must live in the database.

## New database objects

1. `rate_limits` table
   - `key` text PK — e.g. "resolve-table-token:1.2.3.4"
   - `count` int — requests in the current window
   - `window_start` timestamptz — when the current window began
   - RLS enabled; no anon/authenticated policies (service-role only from edge
     functions). This prevents clients from reading or tampering with counters.

2. `resolve_table_token(p_token text)` RPC
   - SECURITY DEFINER, granted to service_role (edge function calls it).
   - Validates token length, looks up the table by qr_token.
   - Checks the outlet's opening_hours against the current time in the outlet's
     timezone. Returns is_open flag. When closed, still returns the outlet +
     menu (browse-only) but does NOT create a session.
   - Finds or creates the open table_session.
   - Returns a JSON object with: outlet public fields, area, table label,
     a sessionToken (opaque, maps to session_id server-side), is_open, and the
     full menu (categories, items, modifiers).

## Security
- `rate_limits`: RLS enabled, no policies for anon/authenticated — only the
  service role can read/write. 
- The RPC is SECURITY DEFINER, revoked from anon/authenticated, granted to
  service_role only. The guest never calls it directly; the edge function
  calls it after rate-limiting.
- The guest receives a `sessionToken` (the qr_token itself, which is already
  an unguessable secret) rather than internal UUIDs. Internal IDs like
  tenant_id, outlet_id, table_id, session_id are NOT included in the response.
*/

-- ---------- rate_limits ----------
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role can access (bypasses RLS).

-- ---------- resolve_table_token ----------
CREATE OR REPLACE FUNCTION resolve_table_token(p_token text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet outlets%ROWTYPE;
  v_area areas%ROWTYPE;
  v_session table_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_day text;
  v_current_time text;
  v_is_open boolean := false;
  v_hours jsonb;
  v_ranges jsonb;
  v_range jsonb;
  v_open_time text;
  v_close_time text;
  v_open_minutes int;
  v_close_minutes int;
  v_now_minutes int;
  v_tz text;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;

  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;

  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id AND deleted_at IS NULL;
  IF v_outlet.id IS NULL THEN
    RAISE EXCEPTION 'Outlet not found';
  END IF;

  SELECT * INTO v_area FROM areas WHERE id = v_table.area_id AND archived_at IS NULL;

  -- Check if outlet is open right now, based on opening_hours + outlet timezone.
  v_tz := COALESCE(v_outlet.timezone, 'Asia/Jakarta');
  v_day := to_char(v_now AT TIME ZONE v_tz, 'dy');
  v_current_time := to_char(v_now AT TIME ZONE v_tz, 'HH24:MI');
  v_hours := COALESCE(v_outlet.opening_hours, '{}'::jsonb);
  v_ranges := v_hours -> v_day;

  IF v_ranges IS NOT NULL AND jsonb_typeof(v_ranges) = 'array' THEN
    v_now_minutes := (substring(v_current_time, 1, 2))::int * 60 + (substring(v_current_time, 4, 2))::int;
    FOR v_range IN SELECT * FROM jsonb_array_elements(v_ranges) LOOP
      v_open_time := v_range ->> 0;
      v_close_time := split_part(v_range ->> 0, '-', 2);
      v_open_time := split_part(v_range ->> 0, '-', 1);
      v_close_time := split_part(v_range ->> 0, '-', 2);
      v_open_minutes := (substring(v_open_time, 1, 2))::int * 60 + (substring(v_open_time, 4, 2))::int;
      v_close_minutes := (substring(v_close_time, 1, 2))::int * 60 + (substring(v_close_time, 4, 2))::int;
      -- Handle midnight wrap (e.g. "22:00-02:00")
      IF v_close_minutes <= v_open_minutes THEN
        v_close_minutes := v_close_minutes + 24 * 60;
        IF v_now_minutes < v_open_minutes THEN
          v_now_minutes := v_now_minutes + 24 * 60;
        END IF;
      END IF;
      IF v_now_minutes >= v_open_minutes AND v_now_minutes < v_close_minutes THEN
        v_is_open := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- Only create/find a session if the outlet is open.
  IF v_is_open THEN
    SELECT * INTO v_session FROM table_sessions
      WHERE table_id = v_table.id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF v_session.id IS NULL THEN
      INSERT INTO table_sessions (table_id, outlet_id, tenant_id, status, guest_count)
      VALUES (v_table.id, v_table.outlet_id, v_table.tenant_id, 'open', 1)
      RETURNING * INTO v_session;
    END IF;
  END IF;

  RETURN json_build_object(
    'outlet', json_build_object(
      'name', v_outlet.name,
      'currency_code', v_outlet.currency_code,
      'timezone', v_outlet.timezone,
      'tax_percent', v_outlet.tax_percent,
      'service_charge_percent', v_outlet.service_charge_percent,
      'opening_hours', v_outlet.opening_hours,
      'order_approval_mode', v_outlet.order_approval_mode,
      'min_order_minor', v_outlet.min_order_minor,
      'max_order_minor', v_outlet.max_order_minor,
      'logo_url', v_outlet.logo_url,
      'hero_url', v_outlet.hero_url,
      'brand_color', v_outlet.brand_color,
      'accent_color', v_outlet.accent_color,
      'website_hero_title', v_outlet.website_hero_title,
      'website_tagline', v_outlet.website_tagline
    ),
    'area', CASE WHEN v_area.id IS NULL THEN NULL ELSE json_build_object(
      'name', v_area.name,
      'default_station', v_area.default_station
    ) END,
    'table', json_build_object(
      'label', v_table.label,
      'min_seats', v_table.min_seats,
      'max_seats', v_table.max_seats
    ),
    'is_open', v_is_open,
    'sessionToken', CASE WHEN v_session.id IS NULL THEN NULL ELSE p_token END,
    'menu', json_build_object(
      'categories', (
        SELECT COALESCE(json_agg(json_build_object(
                 'id', c.id, 'name', c.name, 'sort_order', c.sort_order
               ) ORDER BY c.sort_order), '[]'::json)
        FROM menu_categories c WHERE c.outlet_id = v_outlet.id
      ),
      'items', (
        SELECT COALESCE(json_agg(json_build_object(
                 'id', i.id, 'category_id', i.category_id, 'name', i.name,
                 'description', i.description, 'price_minor', i.price_minor,
                 'photo_url', i.photo_url, 'station', i.station,
                 'prep_time_seconds', i.prep_time_seconds,
                 'dietary_tags', to_json(i.dietary_tags),
                 'allergens', to_json(i.allergens), 'calories', i.calories,
                 'available', i.available, 'sold_out', i.sold_out,
                 'sort_order', i.sort_order
               ) ORDER BY i.sort_order), '[]'::json)
        FROM menu_items i WHERE i.outlet_id = v_outlet.id
      ),
      'modifiers', (
        SELECT COALESCE(json_agg(json_build_object(
                 'id', m.id, 'item_id', m.item_id, 'name', m.name,
                 'required', m.required, 'min_select', m.min_select,
                 'max_select', m.max_select, 'sort_order', m.sort_order,
                 'options', (
                   SELECT COALESCE(json_agg(json_build_object(
                            'id', o.id, 'modifier_id', o.modifier_id,
                            'name', o.name, 'price_delta_minor', o.price_delta_minor,
                            'is_default', o.is_default, 'sort_order', o.sort_order
                          ) ORDER BY o.sort_order), '[]'::json)
                   FROM menu_modifier_options o WHERE o.modifier_id = m.id
                 )
               ) ORDER BY m.sort_order), '[]'::json)
        FROM (
          SELECT mm.* FROM menu_modifiers mm
          JOIN menu_items mi ON mi.id = mm.item_id
          WHERE mi.outlet_id = v_outlet.id
        ) m
      )
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_table_token(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_table_token(text) TO service_role;
