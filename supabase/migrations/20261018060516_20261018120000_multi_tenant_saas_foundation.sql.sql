/*
# Multi-tenant SaaS foundation for DineFlow

1. Plain-English explanation
DineFlow becomes a real multi-tenant product. Every restaurant that signs up is
a "tenant". All restaurant data gains a tenant_id column plus row-level
security so one restaurant can never see another's data. Staff are real auth
users with a role and an optional PIN for shared tablets. New tenants start
empty. The existing Saffron & Smoke venue becomes a flagged demo tenant used
only by the public demo page.

2. New tables
- tenants: restaurant customers, trial window, onboarding progress.
- profiles: auth users with tenant membership + role + hashed PIN.
- staff_invites: email invites, atomically claimed on acceptance.
- orders_seq: per-outlet order numbering (atomic increment).

3. Modified tables
- outlets, areas, tables, menu_categories, menu_items, table_sessions, orders,
  order_items, service_requests, bills, payments, reservations all gain
  tenant_id. Existing rows are stamped with the demo tenant id.
- outlets gains website publishing columns and payment_methods.

4. Security
- RLS on all tables; anon direct access replaced by SECURITY DEFINER guest RPCs
  keyed on the secret table qr_token; staff access scoped by tenant membership
  and role. Helper functions set search_path. Guest functions granted to anon.

5. Notes
- Demo tenant id: '99999999-9999-9999-9999-999999999999'.
- Trigger creates a profile row for every new auth user.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================ new tables
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL,
  country text NOT NULL DEFAULT 'ID',
  is_demo boolean NOT NULL DEFAULT false,
  trial_ends_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  onboarding_step int NOT NULL DEFAULT 1,
  payment_methods text[] NOT NULL DEFAULT '{qris,cash,card}',
  currency_code text NOT NULL DEFAULT 'IDR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  pin_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager','chef','waiter','cashier','host')),
  invited_by uuid NOT NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  accepted_at timestamptz,
  accepted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  UNIQUE (tenant_id, email)
);

ALTER TABLE staff_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS orders_seq (
  outlet_id uuid PRIMARY KEY REFERENCES outlets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  next_number int NOT NULL DEFAULT 1001
);

ALTER TABLE orders_seq ENABLE ROW LEVEL SECURITY;

-- ============================================================ tenant_id columns
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE areas ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE table_sessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS website_published boolean NOT NULL DEFAULT false;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS website_slug text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS payment_methods text[] NOT NULL DEFAULT '{qris,cash,card}';
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS website_hero_title text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS website_tagline text;

CREATE UNIQUE INDEX IF NOT EXISTS outlets_website_slug_key ON outlets (website_slug) WHERE website_slug IS NOT NULL;

-- ============================================================ demo tenant + stamp existing rows
DO $$
DECLARE
  v_demo uuid := '99999999-9999-9999-9999-999999999999';
BEGIN
  INSERT INTO tenants (id, name, owner_user_id, is_demo, onboarding_step, trial_ends_at)
  VALUES (v_demo, 'Saffron & Smoke (Demo)', '00000000-0000-0000-0000-000000000000', true, 7, now() - interval '1 day')
  ON CONFLICT (id) DO NOTHING;

  UPDATE outlets SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE areas SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE tables SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE menu_categories SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE menu_items SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE table_sessions SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE orders SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE order_items SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE service_requests SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE bills SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE payments SET tenant_id = v_demo WHERE tenant_id IS NULL;
  UPDATE reservations SET tenant_id = v_demo WHERE tenant_id IS NULL;
END $$;

INSERT INTO orders_seq (outlet_id, tenant_id, next_number)
SELECT o.id, o.tenant_id, COALESCE((SELECT MAX(order_number) + 1 FROM orders WHERE outlet_id = o.id), 1001)
FROM outlets o
ON CONFLICT (outlet_id) DO NOTHING;

-- ============================================================ helpers
CREATE OR REPLACE FUNCTION is_staff_of(p_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND tenant_id = p_tenant
  );
$$;

CREATE OR REPLACE FUNCTION has_role(p_tenant uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND tenant_id = p_tenant AND role = ANY (p_roles)
  );
$$;

REVOKE EXECUTE ON FUNCTION is_staff_of(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION has_role(uuid, text[]) FROM anon;

-- ============================================================ profile trigger
CREATE OR REPLACE FUNCTION on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name, email)
  VALUES (NEW.id, 'owner', COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION on_auth_user_created();

-- ============================================================ tenant signup (owner already has auth user)
CREATE OR REPLACE FUNCTION sign_up_tenant(p_restaurant_name text, p_country text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_outlet uuid;
  v_slug text;
  v_country text := COALESCE(NULLIF(btrim(COALESCE(p_country, '')), ''), 'ID');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_restaurant_name IS NULL OR length(btrim(p_restaurant_name)) < 2 THEN
    RAISE EXCEPTION 'Restaurant name is required';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND tenant_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Account already belongs to a restaurant';
  END IF;

  INSERT INTO tenants (name, owner_user_id, country)
  VALUES (btrim(p_restaurant_name), v_uid, v_country)
  RETURNING id INTO v_tenant;

  UPDATE profiles SET tenant_id = v_tenant, role = 'owner', updated_at = now()
  WHERE id = v_uid;

  v_slug := lower(regexp_replace(btrim(p_restaurant_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := left(btrim(COALESCE(v_slug, '')), 40);
  IF v_slug = '' OR v_slug IS NULL THEN
    v_slug := 'restaurant-' || substr(md5(v_tenant::text), 1, 6);
  END IF;
  IF EXISTS (SELECT 1 FROM outlets WHERE website_slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 5);
  END IF;

  INSERT INTO outlets (tenant_id, name, slug, website_slug, website_hero_title,
                       website_tagline, currency_code, tax_percent,
                       service_charge_percent, opening_hours, payment_methods)
  VALUES (
    v_tenant, btrim(p_restaurant_name), substr(md5(v_tenant::text), 1, 12), v_slug,
    btrim(p_restaurant_name), 'Order at your table in seconds.',
    CASE v_country WHEN 'US' THEN 'USD' WHEN 'GB' THEN 'GBP' WHEN 'SG' THEN 'SGD' ELSE 'IDR' END,
    CASE v_country WHEN 'ID' THEN 11 ELSE 0 END,
    CASE v_country WHEN 'ID' THEN 5 ELSE 0 END,
    '{"mon":["11:00-22:00"],"tue":["11:00-22:00"],"wed":["11:00-22:00"],"thu":["11:00-22:00"],"fri":["11:00-23:00"],"sat":["11:00-23:00"],"sun":["11:00-22:00"]}'::jsonb,
    '{qris,cash,card}'
  )
  RETURNING id INTO v_outlet;

  INSERT INTO orders_seq (outlet_id, tenant_id) VALUES (v_outlet, v_tenant);

  RETURN v_tenant;
END;
$$;

REVOKE EXECUTE ON FUNCTION sign_up_tenant(text, text) FROM anon;

-- ============================================================ staff invite acceptance
CREATE OR REPLACE FUNCTION accept_staff_invite(p_token text, p_pin text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invite staff_invites%ROWTYPE;
  v_uid uuid := auth.uid();
  v_pin text := COALESCE(p_pin, '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4-6 digits';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND tenant_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Account already belongs to a restaurant';
  END IF;

  UPDATE staff_invites
  SET accepted_at = now(), accepted_by = v_uid
  WHERE token = p_token AND accepted_at IS NULL AND expires_at > now()
  RETURNING * INTO v_invite;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invite is invalid or already used';
  END IF;

  UPDATE profiles
  SET tenant_id = v_invite.tenant_id, role = v_invite.role,
      pin_hash = crypt(v_pin, gen_salt('bf')), updated_at = now()
  WHERE id = v_uid;

  RETURN v_invite.role;
END;
$$;

REVOKE EXECUTE ON FUNCTION accept_staff_invite(text, text) FROM anon;

-- ============================================================ PIN check (edge-function use)
CREATE OR REPLACE FUNCTION check_pin(p_email text, p_pin text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_pin text := COALESCE(p_pin, '');
BEGIN
  IF v_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'Invalid PIN';
  END IF;
  SELECT * INTO v_profile FROM profiles
  WHERE email = lower(btrim(COALESCE(p_email, ''))) AND tenant_id IS NOT NULL AND pin_hash IS NOT NULL
  LIMIT 1;
  IF v_profile.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_profile.pin_hash = crypt(v_pin, v_profile.pin_hash) THEN
    RETURN v_profile.id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION check_pin(text, text) FROM anon, authenticated;

-- ============================================================ guest RPCs
CREATE OR REPLACE FUNCTION guest_get_table(p_token text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_outlet outlets%ROWTYPE;
  v_table tables%ROWTYPE;
  v_session table_sessions%ROWTYPE;
  v_bill bills%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id;
  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  SELECT * INTO v_bill FROM bills
    WHERE session_id = v_session.id AND status = 'open'
    ORDER BY created_at DESC LIMIT 1;

  RETURN json_build_object(
    'tenant_id', v_outlet.tenant_id,
    'outlet', json_build_object(
      'id', v_outlet.id, 'name', v_outlet.name, 'currency_code', v_outlet.currency_code,
      'timezone', v_outlet.timezone, 'tax_percent', v_outlet.tax_percent,
      'service_charge_percent', v_outlet.service_charge_percent,
      'opening_hours', v_outlet.opening_hours,
      'order_approval_mode', v_outlet.order_approval_mode,
      'min_order_minor', v_outlet.min_order_minor, 'max_order_minor', v_outlet.max_order_minor,
      'logo_url', v_outlet.logo_url, 'hero_url', v_outlet.hero_url,
      'brand_color', v_outlet.brand_color, 'accent_color', v_outlet.accent_color
    ),
    'table', json_build_object('id', v_table.id, 'label', v_table.label, 'status', v_table.status),
    'session_id', v_session.id,
    'bill_id', v_bill.id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_get_table(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION guest_get_table(text) TO anon;

CREATE OR REPLACE FUNCTION guest_get_menu(p_token text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet_id uuid;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  v_outlet_id := v_table.outlet_id;

  RETURN json_build_object(
    'categories', (
      SELECT COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name, 'sort_order', c.sort_order)
               ORDER BY c.sort_order), '[]'::json)
      FROM menu_categories c WHERE c.outlet_id = v_outlet_id
    ),
    'items', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', i.id, 'category_id', i.category_id, 'name', i.name,
               'description', i.description, 'price_minor', i.price_minor,
               'photo_url', i.photo_url, 'station', i.station,
               'prep_time_seconds', i.prep_time_seconds, 'dietary_tags', to_json(i.dietary_tags),
               'allergens', to_json(i.allergens), 'calories', i.calories,
               'available', i.available, 'sold_out', i.sold_out, 'sort_order', i.sort_order
             ) ORDER BY i.sort_order), '[]'::json)
      FROM menu_items i WHERE i.outlet_id = v_outlet_id
    ),
    'modifiers', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', m.id, 'item_id', m.item_id, 'name', m.name, 'required', m.required,
               'min_select', m.min_select, 'max_select', m.max_select, 'sort_order', m.sort_order,
               'options', (
                 SELECT COALESCE(json_agg(json_build_object(
                          'id', o.id, 'modifier_id', o.modifier_id, 'name', o.name,
                          'price_delta_minor', o.price_delta_minor,
                          'is_default', o.is_default, 'sort_order', o.sort_order
                        ) ORDER BY o.sort_order), '[]'::json)
                 FROM menu_modifier_options o WHERE o.modifier_id = m.id
               )
             ) ORDER BY m.sort_order), '[]'::json)
      FROM (
        SELECT mm.* FROM menu_modifiers mm
        JOIN menu_items mi ON mi.id = mm.item_id
        WHERE mi.outlet_id = v_outlet_id
      ) m
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_get_menu(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION guest_get_menu(text) TO anon;

CREATE OR REPLACE FUNCTION guest_get_orders(p_token text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_session table_sessions%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  IF v_session.id IS NULL THEN
    RETURN json_build_object('orders', '[]'::json, 'items', '[]'::json, 'session_id', NULL);
  END IF;
  RETURN json_build_object(
    'session_id', v_session.id,
    'orders', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', o.id, 'order_number', o.order_number, 'status', o.status,
               'notes', o.notes, 'guest_name', o.guest_name, 'created_at', o.created_at
             ) ORDER BY o.created_at DESC), '[]'::json)
      FROM orders o WHERE o.session_id = v_session.id
    ),
    'items', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', oi.id, 'order_id', oi.order_id, 'name', oi.name, 'station', oi.station,
               'quantity', oi.quantity, 'unit_price_minor', oi.unit_price_minor,
               'modifiers', oi.modifiers, 'notes', oi.notes, 'status', oi.status,
               'created_at', oi.created_at
             ) ORDER BY oi.created_at), '[]'::json)
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.session_id = v_session.id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_get_orders(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION guest_get_orders(text) TO anon;

CREATE OR REPLACE FUNCTION guest_get_bill(p_token text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_session table_sessions%ROWTYPE;
  v_bill bills%ROWTYPE;
  v_outlet outlets%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id;
  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  IF v_session.id IS NULL THEN
    RETURN json_build_object('bill', NULL, 'items', '[]'::json, 'session_id', NULL,
                             'tax_percent', v_outlet.tax_percent,
                             'service_charge_percent', v_outlet.service_charge_percent);
  END IF;
  SELECT * INTO v_bill FROM bills
    WHERE session_id = v_session.id AND status = 'open'
    ORDER BY created_at DESC LIMIT 1;
  RETURN json_build_object(
    'bill', CASE WHEN v_bill.id IS NULL THEN NULL ELSE json_build_object(
      'id', v_bill.id, 'session_id', v_bill.session_id, 'table_id', v_bill.table_id,
      'subtotal_minor', v_bill.subtotal_minor, 'discount_minor', v_bill.discount_minor,
      'tax_minor', v_bill.tax_minor, 'service_minor', v_bill.service_minor,
      'tip_minor', v_bill.tip_minor, 'total_minor', v_bill.total_minor,
      'status', v_bill.status) END,
    'session_id', v_session.id,
    'items', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', oi.id, 'name', oi.name, 'quantity', oi.quantity,
               'unit_price_minor', oi.unit_price_minor, 'modifiers', oi.modifiers,
               'notes', oi.notes, 'status', oi.status
             ) ORDER BY oi.created_at), '[]'::json)
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.session_id = v_session.id AND oi.status NOT IN ('voided','rejected')
    ),
    'tax_percent', v_outlet.tax_percent,
    'service_charge_percent', v_outlet.service_charge_percent
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_get_bill(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION guest_get_bill(text) TO anon;

CREATE OR REPLACE FUNCTION place_order_guest(
  p_token text,
  p_lines jsonb,
  p_notes text DEFAULT NULL,
  p_guest_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet outlets%ROWTYPE;
  v_session table_sessions%ROWTYPE;
  v_bill bills%ROWTYPE;
  v_order_id uuid;
  v_order_number int;
  v_line jsonb;
  v_item menu_items%ROWTYPE;
  v_item_id uuid;
  v_qty int;
  v_rows jsonb := '[]'::jsonb;
  v_item_ids uuid[];
  v_valid_count int;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;
  IF jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'Too many items in one order';
  END IF;

  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id;

  SELECT array_agg(DISTINCT (l->>'itemId')::uuid) INTO v_item_ids
  FROM jsonb_array_elements(p_lines) l
  WHERE l->>'itemId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF v_item_ids IS NULL THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;
  SELECT count(*) INTO v_valid_count
  FROM menu_items WHERE id = ANY (v_item_ids) AND outlet_id = v_outlet.id;
  IF v_valid_count <> array_length(v_item_ids, 1) THEN
    RAISE EXCEPTION 'Some items are no longer available';
  END IF;

  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  IF v_session.id IS NULL THEN
    INSERT INTO table_sessions (table_id, outlet_id, tenant_id, status, guest_count)
    VALUES (v_table.id, v_table.outlet_id, v_table.tenant_id, 'open', 1)
    RETURNING * INTO v_session;
  END IF;

  SELECT * INTO v_bill FROM bills
    WHERE session_id = v_session.id AND status = 'open'
    ORDER BY created_at DESC LIMIT 1;
  IF v_bill.id IS NULL THEN
    INSERT INTO bills (session_id, table_id, outlet_id, tenant_id, status)
    VALUES (v_session.id, v_table.id, v_table.outlet_id, v_table.tenant_id, 'open')
    RETURNING * INTO v_bill;
  END IF;

  UPDATE orders_seq SET next_number = next_number + 1
  WHERE outlet_id = v_outlet.id
  RETURNING next_number - 1 INTO v_order_number;

  INSERT INTO orders (session_id, table_id, outlet_id, tenant_id, order_number,
                      type, source, status, notes, guest_name)
  VALUES (v_session.id, v_table.id, v_outlet.id, v_outlet.tenant_id, v_order_number,
          'dine_in', 'qr', 'received', NULLIF(btrim(COALESCE(p_notes, '')), ''),
          NULLIF(btrim(COALESCE(p_guest_name, '')), ''))
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := COALESCE((v_line->>'quantity')::int, 0);
    IF v_qty < 1 OR v_qty > 20 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    -- regex guard before the cast: a malformed id raises a clean error
    IF (v_line->>'itemId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid item in cart';
    END IF;
    v_item_id := (v_line->>'itemId')::uuid;
    SELECT * INTO v_item FROM menu_items WHERE id = v_item_id;
    IF v_item.id IS NULL OR v_item.outlet_id <> v_outlet.id THEN
      RAISE EXCEPTION 'Some items are no longer available';
    END IF;
    IF v_item.sold_out OR NOT v_item.available THEN
      RAISE EXCEPTION 'One of the items just sold out — please review your cart';
    END IF;

    v_rows := v_rows || jsonb_build_object(
      'order_id', v_order_id,
      'outlet_id', v_outlet.id,
      'tenant_id', v_outlet.tenant_id,
      'item_id', v_item.id,
      'name', v_item.name,
      'station', v_item.station,
      'quantity', v_qty,
      'unit_price_minor', v_item.price_minor,
      'modifiers', CASE WHEN jsonb_typeof(COALESCE(v_line->'modifiers', '[]'::jsonb)) = 'array'
                        THEN v_line->'modifiers' ELSE '[]'::jsonb END,
      'notes', NULLIF(btrim(COALESCE(v_line->>'notes', '')), ''),
      'status', 'received',
      'allergy_alert', (array_length(COALESCE(v_item.allergens, ARRAY[]::text[]), 1) > 0
                        AND NOT ('none' = ANY (COALESCE(v_item.allergens, ARRAY['none'::text]))))
    );
  END LOOP;

  INSERT INTO order_items (order_id, outlet_id, tenant_id, item_id, name, station,
                           quantity, unit_price_minor, modifiers, notes, status, allergy_alert)
  SELECT
    (r->>'order_id')::uuid, (r->>'outlet_id')::uuid, (r->>'tenant_id')::uuid,
    (r->>'item_id')::uuid, r->>'name', r->>'station', (r->>'quantity')::int,
    (r->>'unit_price_minor')::bigint, COALESCE(r->'modifiers', '[]'::jsonb), r->>'notes',
    'received', (r->>'allergy_alert')::boolean
  FROM jsonb_array_elements(v_rows) r;

  UPDATE tables SET status = 'occupied', updated_at = now() WHERE id = v_table.id;

  RETURN json_build_object('orderId', v_order_id, 'orderNumber', v_order_number,
                           'sessionId', v_session.id, 'billId', v_bill.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION place_order_guest(text, jsonb, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION place_order_guest(text, jsonb, text, text) TO anon;

CREATE OR REPLACE FUNCTION guest_call_waiter(p_token text, p_reason text, p_detail text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_reason NOT IN ('need_help','request_bill','water_refill','clean_table','cutlery','other') THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  INSERT INTO service_requests (table_id, outlet_id, tenant_id, reason, detail, status)
  VALUES (v_table.id, v_table.outlet_id, v_table.tenant_id, p_reason,
          NULLIF(btrim(COALESCE(p_detail, '')), ''), 'sent')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_call_waiter(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION guest_call_waiter(text, text, text) TO anon;

CREATE OR REPLACE FUNCTION guest_pay_bill(
  p_token text,
  p_method text,
  p_tip_minor bigint DEFAULT 0,
  p_provider_ref text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_session table_sessions%ROWTYPE;
  v_bill bills%ROWTYPE;
  v_outlet outlets%ROWTYPE;
  v_subtotal bigint := 0;
  v_tax bigint;
  v_service bigint;
  v_tip bigint;
  v_total bigint;
  v_bill_id uuid;
BEGIN
  IF p_method NOT IN ('qris','card','cash') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;
  IF p_tip_minor IS NULL OR p_tip_minor < 0 OR p_tip_minor > 5000000 THEN
    RAISE EXCEPTION 'Invalid tip';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;

  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id;

  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'No open session for this table';
  END IF;

  SELECT * INTO v_bill FROM bills
    WHERE session_id = v_session.id AND status = 'open'
    ORDER BY created_at DESC LIMIT 1;
  IF v_bill.id IS NULL THEN
    RAISE EXCEPTION 'Nothing to pay yet';
  END IF;

  SELECT COALESCE(SUM(
    (oi.unit_price_minor + COALESCE((SELECT SUM((m->>'price_delta_minor')::bigint)
                                     FROM jsonb_array_elements(COALESCE(oi.modifiers, '[]'::jsonb)) m
                                     WHERE (m->>'price_delta_minor') ~ '^-?[0-9]+$'), 0)) * oi.quantity), 0)
  INTO v_subtotal
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.session_id = v_session.id AND oi.status NOT IN ('voided','rejected');

  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay yet';
  END IF;

  v_tip := p_tip_minor;
  v_tax := ROUND((v_subtotal * v_outlet.tax_percent) / 100);
  v_service := ROUND((v_subtotal * v_outlet.service_charge_percent) / 100);
  v_total := v_subtotal + v_tax + v_service + v_tip;

  UPDATE bills SET
    subtotal_minor = v_subtotal, tax_minor = v_tax, service_minor = v_service,
    tip_minor = v_tip, total_minor = v_total, status = 'paid',
    closed_at = now(), updated_at = now()
  WHERE id = v_bill.id
  RETURNING id INTO v_bill_id;

  INSERT INTO payments (bill_id, tenant_id, method, amount_minor, provider_ref, status)
  VALUES (v_bill_id, v_outlet.tenant_id, p_method, v_total, NULLIF(btrim(COALESCE(p_provider_ref, '')), ''), 'completed');

  UPDATE table_sessions SET status = 'closed', closed_at = now(), updated_at = now()
  WHERE id = v_session.id;
  UPDATE tables SET status = 'cleaning', updated_at = now() WHERE id = v_table.id;

  RETURN json_build_object('total', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_pay_bill(text, text, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION guest_pay_bill(text, text, bigint, text) TO anon;

CREATE OR REPLACE FUNCTION guest_book_table(
  p_token text,
  p_name text,
  p_phone text,
  p_party_size int,
  p_date date,
  p_time text,
  p_area_pref text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet_id uuid;
  v_reservation_id uuid;
  v_taken uuid[];
  v_best tables%ROWTYPE;
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF p_party_size < 1 OR p_party_size > 20 THEN
    RAISE EXCEPTION 'Party size must be between 1 and 20';
  END IF;
  IF p_time IS NULL OR p_time !~ '^[0-9]{2}:[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid time';
  END IF;
  IF p_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Date must be today or later';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;

  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  v_outlet_id := v_table.outlet_id;

  SELECT array_agg(r.table_id) INTO v_taken
  FROM reservations r
  WHERE r.outlet_id = v_outlet_id AND r.booking_date = p_date
    AND r.booking_time = p_time::time
    AND r.status NOT IN ('cancelled','no_show');

  SELECT * INTO v_best
  FROM tables t
  WHERE t.outlet_id = v_outlet_id
    AND (NULLIF(btrim(COALESCE(p_area_pref, '')), '') IS NULL OR EXISTS (
      SELECT 1 FROM areas a WHERE a.id = t.area_id AND a.name = btrim(p_area_pref)
    ))
    AND (v_taken IS NULL OR NOT (t.id = ANY (v_taken)))
    AND t.max_seats >= p_party_size
  ORDER BY t.max_seats ASC
  LIMIT 1;

  IF v_best.id IS NULL THEN
    RAISE EXCEPTION 'No table available for that time — try another slot';
  END IF;

  INSERT INTO reservations (outlet_id, tenant_id, table_id, guest_name, guest_phone,
                            party_size, area_preference, booking_date, booking_time,
                            status, notes)
  VALUES (v_outlet_id, v_table.tenant_id, v_best.id, btrim(p_name),
          NULLIF(btrim(COALESCE(p_phone, '')), ''),
          p_party_size, NULLIF(btrim(COALESCE(p_area_pref, '')), ''),
          p_date, p_time::time, 'confirmed',
          NULLIF(btrim(COALESCE(p_notes, '')), ''))
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_book_table(text, text, text, int, date, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION guest_book_table(text, text, text, int, date, text, text, text) TO anon;

CREATE OR REPLACE FUNCTION public_site_data(p_slug text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_outlet outlets%ROWTYPE;
BEGIN
  IF p_slug IS NULL OR length(btrim(p_slug)) < 2 THEN
    RAISE EXCEPTION 'Site not found';
  END IF;
  SELECT * INTO v_outlet FROM outlets
  WHERE website_slug = lower(btrim(p_slug)) AND website_published = true;
  IF v_outlet.id IS NULL THEN
    RAISE EXCEPTION 'Site not found';
  END IF;
  RETURN json_build_object(
    'outlet', json_build_object(
      'name', v_outlet.name, 'website_slug', v_outlet.website_slug,
      'website_hero_title', v_outlet.website_hero_title,
      'website_tagline', v_outlet.website_tagline,
      'opening_hours', v_outlet.opening_hours,
      'logo_url', v_outlet.logo_url, 'hero_url', v_outlet.hero_url
    ),
    'menu', (
      SELECT COALESCE(json_agg(json_build_object(
               'category', c.name,
               'items', (
                 SELECT COALESCE(json_agg(json_build_object(
                          'name', i.name, 'description', i.description,
                          'price_minor', i.price_minor, 'photo_url', i.photo_url,
                          'dietary_tags', to_json(i.dietary_tags)
                        ) ORDER BY i.sort_order), '[]'::json)
                 FROM menu_items i
                 WHERE i.category_id = c.id AND i.available = true AND i.sold_out = false
               )
             ) ORDER BY c.sort_order), '[]'::json)
      FROM menu_categories c WHERE c.outlet_id = v_outlet.id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public_site_data(text) TO anon, authenticated;

-- ============================================================ policies
-- Outlets
DROP POLICY IF EXISTS "anon_select_outlets" ON outlets;
DROP POLICY IF EXISTS "anon_insert_outlets" ON outlets;
DROP POLICY IF EXISTS "anon_update_outlets" ON outlets;
DROP POLICY IF EXISTS "anon_delete_outlets" ON outlets;
CREATE POLICY "staff_select_outlets" ON outlets FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_outlets" ON outlets FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));
CREATE POLICY "staff_update_outlets" ON outlets FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Areas
DROP POLICY IF EXISTS "anon_select_areas" ON areas;
DROP POLICY IF EXISTS "anon_insert_areas" ON areas;
DROP POLICY IF EXISTS "anon_update_areas" ON areas;
DROP POLICY IF EXISTS "anon_delete_areas" ON areas;
CREATE POLICY "staff_select_areas" ON areas FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_areas" ON areas FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));
CREATE POLICY "staff_update_areas" ON areas FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','host']))
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','host']));
CREATE POLICY "staff_delete_areas" ON areas FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Tables
DROP POLICY IF EXISTS "anon_select_tables" ON tables;
DROP POLICY IF EXISTS "anon_insert_tables" ON tables;
DROP POLICY IF EXISTS "anon_update_tables" ON tables;
DROP POLICY IF EXISTS "anon_delete_tables" ON tables;
CREATE POLICY "staff_select_tables" ON tables FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_tables" ON tables FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','host']));
CREATE POLICY "staff_update_tables" ON tables FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','waiter','host','cashier']))
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','waiter','host','cashier']));
CREATE POLICY "staff_delete_tables" ON tables FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Menu categories
DROP POLICY IF EXISTS "anon_select_menu_categories" ON menu_categories;
DROP POLICY IF EXISTS "anon_insert_menu_categories" ON menu_categories;
DROP POLICY IF EXISTS "anon_update_menu_categories" ON menu_categories;
DROP POLICY IF EXISTS "anon_delete_menu_categories" ON menu_categories;
CREATE POLICY "staff_select_menu_categories" ON menu_categories FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_menu_categories" ON menu_categories FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));
CREATE POLICY "staff_update_menu_categories" ON menu_categories FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));
CREATE POLICY "staff_delete_menu_categories" ON menu_categories FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Menu items
DROP POLICY IF EXISTS "anon_select_menu_items" ON menu_items;
DROP POLICY IF EXISTS "anon_insert_menu_items" ON menu_items;
DROP POLICY IF EXISTS "anon_update_menu_items" ON menu_items;
DROP POLICY IF EXISTS "anon_delete_menu_items" ON menu_items;
CREATE POLICY "staff_select_menu_items" ON menu_items FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_menu_items" ON menu_items FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));
CREATE POLICY "staff_update_menu_items" ON menu_items FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));
CREATE POLICY "staff_delete_menu_items" ON menu_items FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Menu modifiers
DROP POLICY IF EXISTS "anon_select_menu_modifiers" ON menu_modifiers;
DROP POLICY IF EXISTS "anon_insert_menu_modifiers" ON menu_modifiers;
DROP POLICY IF EXISTS "anon_update_menu_modifiers" ON menu_modifiers;
DROP POLICY IF EXISTS "anon_delete_menu_modifiers" ON menu_modifiers;
CREATE POLICY "staff_select_menu_modifiers" ON menu_modifiers FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.id = menu_modifiers.item_id AND is_staff_of(mi.tenant_id)
    )
  );
CREATE POLICY "staff_insert_menu_modifiers" ON menu_modifiers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.id = menu_modifiers.item_id AND is_staff_of(mi.tenant_id)
        AND has_role(mi.tenant_id, ARRAY['owner','manager'])
    )
  );
CREATE POLICY "staff_update_menu_modifiers" ON menu_modifiers FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.id = menu_modifiers.item_id AND is_staff_of(mi.tenant_id)
        AND has_role(mi.tenant_id, ARRAY['owner','manager'])
    )
  );
CREATE POLICY "staff_delete_menu_modifiers" ON menu_modifiers FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.id = menu_modifiers.item_id AND is_staff_of(mi.tenant_id)
        AND has_role(mi.tenant_id, ARRAY['owner','manager'])
    )
  );

-- Menu modifier options
DROP POLICY IF EXISTS "anon_select_menu_modifier_options" ON menu_modifier_options;
DROP POLICY IF EXISTS "anon_insert_menu_modifier_options" ON menu_modifier_options;
DROP POLICY IF EXISTS "anon_update_menu_modifier_options" ON menu_modifier_options;
DROP POLICY IF EXISTS "anon_delete_menu_modifier_options" ON menu_modifier_options;
CREATE POLICY "staff_select_menu_modifier_options" ON menu_modifier_options FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM menu_modifiers mm
      JOIN menu_items mi ON mi.id = mm.item_id
      WHERE mm.id = menu_modifier_options.modifier_id AND is_staff_of(mi.tenant_id)
    )
  );
CREATE POLICY "staff_insert_menu_modifier_options" ON menu_modifier_options FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM menu_modifiers mm
      JOIN menu_items mi ON mi.id = mm.item_id
      WHERE mm.id = menu_modifier_options.modifier_id AND is_staff_of(mi.tenant_id)
        AND has_role(mi.tenant_id, ARRAY['owner','manager'])
    )
  );
CREATE POLICY "staff_update_menu_modifier_options" ON menu_modifier_options FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM menu_modifiers mm
      JOIN menu_items mi ON mi.id = mm.item_id
      WHERE mm.id = menu_modifier_options.modifier_id AND is_staff_of(mi.tenant_id)
        AND has_role(mi.tenant_id, ARRAY['owner','manager'])
    )
  );
CREATE POLICY "staff_delete_menu_modifier_options" ON menu_modifier_options FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM menu_modifiers mm
      JOIN menu_items mi ON mi.id = mm.item_id
      WHERE mm.id = menu_modifier_options.modifier_id AND is_staff_of(mi.tenant_id)
        AND has_role(mi.tenant_id, ARRAY['owner','manager'])
    )
  );

-- Table sessions
DROP POLICY IF EXISTS "anon_select_table_sessions" ON table_sessions;
DROP POLICY IF EXISTS "anon_insert_table_sessions" ON table_sessions;
DROP POLICY IF EXISTS "anon_update_table_sessions" ON table_sessions;
DROP POLICY IF EXISTS "anon_delete_table_sessions" ON table_sessions;
CREATE POLICY "staff_select_table_sessions" ON table_sessions FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_table_sessions" ON table_sessions FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_update_table_sessions" ON table_sessions FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id))
  WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_delete_table_sessions" ON table_sessions FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Orders
DROP POLICY IF EXISTS "anon_select_orders" ON orders;
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
DROP POLICY IF EXISTS "anon_update_orders" ON orders;
DROP POLICY IF EXISTS "anon_delete_orders" ON orders;
CREATE POLICY "staff_select_orders" ON orders FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_orders" ON orders FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_update_orders" ON orders FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id))
  WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_delete_orders" ON orders FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Order items
DROP POLICY IF EXISTS "anon_select_order_items" ON order_items;
DROP POLICY IF EXISTS "anon_insert_order_items" ON order_items;
DROP POLICY IF EXISTS "anon_update_order_items" ON order_items;
DROP POLICY IF EXISTS "anon_delete_order_items" ON order_items;
CREATE POLICY "staff_select_order_items" ON order_items FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_order_items" ON order_items FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_update_order_items" ON order_items FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id))
  WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_delete_order_items" ON order_items FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Service requests
DROP POLICY IF EXISTS "anon_select_service_requests" ON service_requests;
DROP POLICY IF EXISTS "anon_insert_service_requests" ON service_requests;
DROP POLICY IF EXISTS "anon_update_service_requests" ON service_requests;
DROP POLICY IF EXISTS "anon_delete_service_requests" ON service_requests;
CREATE POLICY "staff_select_service_requests" ON service_requests FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_service_requests" ON service_requests FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_update_service_requests" ON service_requests FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id))
  WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_delete_service_requests" ON service_requests FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Bills
DROP POLICY IF EXISTS "anon_select_bills" ON bills;
DROP POLICY IF EXISTS "anon_insert_bills" ON bills;
DROP POLICY IF EXISTS "anon_update_bills" ON bills;
DROP POLICY IF EXISTS "anon_delete_bills" ON bills;
CREATE POLICY "staff_select_bills" ON bills FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_bills" ON bills FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_update_bills" ON bills FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id))
  WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_delete_bills" ON bills FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Payments
DROP POLICY IF EXISTS "anon_select_payments" ON payments;
DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
DROP POLICY IF EXISTS "anon_update_payments" ON payments;
DROP POLICY IF EXISTS "anon_delete_payments" ON payments;
CREATE POLICY "staff_select_payments" ON payments FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_payments" ON payments FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id));
CREATE POLICY "staff_update_payments" ON payments FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','cashier']))
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','cashier']));
CREATE POLICY "staff_delete_payments" ON payments FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Reservations
DROP POLICY IF EXISTS "anon_select_reservations" ON reservations;
DROP POLICY IF EXISTS "anon_insert_reservations" ON reservations;
DROP POLICY IF EXISTS "anon_update_reservations" ON reservations;
DROP POLICY IF EXISTS "anon_delete_reservations" ON reservations;
CREATE POLICY "staff_select_reservations" ON reservations FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));
CREATE POLICY "staff_insert_reservations" ON reservations FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','host']));
CREATE POLICY "staff_update_reservations" ON reservations FOR UPDATE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','host','waiter']))
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager','host','waiter']));
CREATE POLICY "staff_delete_reservations" ON reservations FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- tenants
CREATE POLICY "tenant_select_own" ON tenants FOR SELECT
  TO authenticated USING (
    id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    OR owner_user_id = auth.uid()
  );
CREATE POLICY "tenant_update_own" ON tenants FOR UPDATE
  TO authenticated
  USING (has_role(id, ARRAY['owner','manager']))
  WITH CHECK (has_role(id, ARRAY['owner','manager']));

-- profiles
CREATE POLICY "profile_select_self_and_staff" ON profiles FOR SELECT
  TO authenticated USING (
    id = auth.uid()
    OR (tenant_id IS NOT NULL AND is_staff_of(tenant_id))
  );
CREATE POLICY "profile_update_self" ON profiles FOR UPDATE
  TO authenticated USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (full_name, pin_hash, updated_at) ON profiles TO authenticated;

-- staff invites
CREATE POLICY "staff_select_invites" ON staff_invites FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));
CREATE POLICY "staff_insert_invites" ON staff_invites FOR INSERT
  TO authenticated WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));
CREATE POLICY "staff_delete_invites" ON staff_invites FOR DELETE
  TO authenticated USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- orders_seq
CREATE POLICY "staff_select_orders_seq" ON orders_seq FOR SELECT
  TO authenticated USING (is_staff_of(tenant_id));

-- ============================================================ indexes
CREATE INDEX IF NOT EXISTS idx_outlets_tenant ON outlets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_areas_tenant ON areas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tables_tenant ON tables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_menu_categories_tenant ON menu_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_tenant ON menu_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_table_sessions_tenant ON table_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_tenant ON service_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bills_tenant ON bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant ON reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(lower(email));
CREATE INDEX IF NOT EXISTS idx_staff_invites_tenant ON staff_invites(tenant_id);

-- realtime for new tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['tenants','profiles','staff_invites'])
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I;', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;