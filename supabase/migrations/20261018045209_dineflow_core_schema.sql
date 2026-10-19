/*
# DineFlow core schema (single demo tenant, no-auth)

DineFlow is a restaurant SaaS with QR ordering, KDS, POS, waiter app, reservations.
This migration creates the core data model for a single demo venue so the app
can be exercised end-to-end without authentication. Guests order from a QR code;
staff use KDS / Waiter / POS / Reservations / Admin surfaces. All tables are
intentionally shared/public for this demo, so policies use `TO anon, authenticated`
with `USING (true)` — this is correct for a single-tenant demo, NOT for a real
multi-tenant product.

1. New tables
- `outlets` — physical venue (one demo outlet seeded later).
- `areas` — floor areas (Ground Floor, Bar, Rooftop...).
- `tables` — physical tables with QR tokens and status.
- `menu_categories` — menu categories (Starters, Mains, Drinks, Desserts).
- `menu_items` — items with price, station, prep time, dietary tags, availability.
- `menu_modifiers` — optional/required option groups (size, sugar, add-ons).
- `menu_modifier_options` — options with price deltas.
- `table_sessions` — a session opened when a guest scans a table QR.
- `orders` — an order placed in a session (multiple rounds per session).
- `order_items` — line items with modifiers, status, station.
- `service_requests` — "call waiter" digital bell entries.
- `bills` — a bill for a table session (subtotal/tax/service/tip/total).
- `payments` — payments against a bill.
- `reservations` — guest bookings tied to a table and date/time.
- `service_request_ack` — waiter acknowledgement of a bell call (embedded below).

2. Money
- All money stored as integer minor units (IDR has no decimals but we keep
  the convention consistent). `price_minor`, `total_minor`, etc.

3. Realtime
- Tables used in realtime views are added to the supabase_realtime publication
  so the frontend can subscribe to inserts/updates/deletes.

4. Security
- RLS enabled on every table.
- Policies are `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)`
  because this is a single-tenant demo with no sign-in screen. This is the
  documented exception, not a shortcut around ownership checks.

5. Notes
- Soft-deletes via `deleted_at timestamptz`.
- `qr_token` is a random non-guessable string per table.
- `station` is one of: kitchen, bar, dessert, coffee, expo.
*/

CREATE TABLE IF NOT EXISTS outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  currency_code text NOT NULL DEFAULT 'IDR',
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  tax_percent numeric NOT NULL DEFAULT 0,
  service_charge_percent numeric NOT NULL DEFAULT 0,
  opening_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_approval_mode text NOT NULL DEFAULT 'auto', -- auto | waiter | pay_first
  min_order_minor bigint NOT NULL DEFAULT 0,
  max_order_minor bigint NOT NULL DEFAULT 50000000,
  idle_session_minutes int NOT NULL DEFAULT 180,
  logo_url text,
  hero_url text,
  brand_color text NOT NULL DEFAULT '#0f172a',
  accent_color text NOT NULL DEFAULT '#f97316',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_outlets" ON outlets;
CREATE POLICY "anon_select_outlets" ON outlets FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_outlets" ON outlets;
CREATE POLICY "anon_insert_outlets" ON outlets FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_outlets" ON outlets;
CREATE POLICY "anon_update_outlets" ON outlets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_outlets" ON outlets;
CREATE POLICY "anon_delete_outlets" ON outlets FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  allows_reservations boolean NOT NULL DEFAULT true,
  min_spend_minor bigint NOT NULL DEFAULT 0,
  default_station text NOT NULL DEFAULT 'kitchen',
  active_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_areas" ON areas;
CREATE POLICY "anon_select_areas" ON areas FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_areas" ON areas;
CREATE POLICY "anon_insert_areas" ON areas FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_areas" ON areas;
CREATE POLICY "anon_update_areas" ON areas FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_areas" ON areas;
CREATE POLICY "anon_delete_areas" ON areas FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  label text NOT NULL,
  min_seats int NOT NULL DEFAULT 2,
  max_seats int NOT NULL DEFAULT 4,
  shape text NOT NULL DEFAULT 'round', -- round | square | rect
  pos_x int NOT NULL DEFAULT 0,
  pos_y int NOT NULL DEFAULT 0,
  rotation int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'available', -- available | reserved | occupied | awaiting_payment | cleaning | out_of_service
  notes text,
  qr_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(9), 'hex'),
  pin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_tables" ON tables;
CREATE POLICY "anon_select_tables" ON tables FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_tables" ON tables;
CREATE POLICY "anon_insert_tables" ON tables FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_tables" ON tables;
CREATE POLICY "anon_update_tables" ON tables FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_tables" ON tables;
CREATE POLICY "anon_delete_tables" ON tables FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_menu_categories" ON menu_categories;
CREATE POLICY "anon_select_menu_categories" ON menu_categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_menu_categories" ON menu_categories;
CREATE POLICY "anon_insert_menu_categories" ON menu_categories FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_menu_categories" ON menu_categories;
CREATE POLICY "anon_update_menu_categories" ON menu_categories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_menu_categories" ON menu_categories;
CREATE POLICY "anon_delete_menu_categories" ON menu_categories FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_minor bigint NOT NULL DEFAULT 0,
  photo_url text,
  station text NOT NULL DEFAULT 'kitchen', -- kitchen | bar | dessert | coffee
  prep_time_seconds int NOT NULL DEFAULT 600,
  dietary_tags text[] NOT NULL DEFAULT '{}',
  allergens text[] NOT NULL DEFAULT '{}',
  calories int,
  sku text,
  available boolean NOT NULL DEFAULT true,
  sold_out boolean NOT NULL DEFAULT false,
  daily_limit int,
  daily_sold int NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_menu_items" ON menu_items;
CREATE POLICY "anon_select_menu_items" ON menu_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_menu_items" ON menu_items;
CREATE POLICY "anon_insert_menu_items" ON menu_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_menu_items" ON menu_items;
CREATE POLICY "anon_update_menu_items" ON menu_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_menu_items" ON menu_items;
CREATE POLICY "anon_delete_menu_items" ON menu_items FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS menu_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  min_select int NOT NULL DEFAULT 0,
  max_select int NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0
);

ALTER TABLE menu_modifiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_menu_modifiers" ON menu_modifiers;
CREATE POLICY "anon_select_menu_modifiers" ON menu_modifiers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_menu_modifiers" ON menu_modifiers;
CREATE POLICY "anon_insert_menu_modifiers" ON menu_modifiers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_menu_modifiers" ON menu_modifiers;
CREATE POLICY "anon_update_menu_modifiers" ON menu_modifiers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_menu_modifiers" ON menu_modifiers;
CREATE POLICY "anon_delete_menu_modifiers" ON menu_modifiers FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS menu_modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_id uuid NOT NULL REFERENCES menu_modifiers(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta_minor bigint NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);

ALTER TABLE menu_modifier_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_menu_modifier_options" ON menu_modifier_options;
CREATE POLICY "anon_select_menu_modifier_options" ON menu_modifier_options FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_menu_modifier_options" ON menu_modifier_options;
CREATE POLICY "anon_insert_menu_modifier_options" ON menu_modifier_options FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_menu_modifier_options" ON menu_modifier_options;
CREATE POLICY "anon_update_menu_modifier_options" ON menu_modifier_options FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_menu_modifier_options" ON menu_modifier_options;
CREATE POLICY "anon_delete_menu_modifier_options" ON menu_modifier_options FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS table_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  guest_count int NOT NULL DEFAULT 1,
  reservation_id uuid,
  status text NOT NULL DEFAULT 'open', -- open | closed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_table_sessions" ON table_sessions;
CREATE POLICY "anon_select_table_sessions" ON table_sessions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_table_sessions" ON table_sessions;
CREATE POLICY "anon_insert_table_sessions" ON table_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_table_sessions" ON table_sessions;
CREATE POLICY "anon_update_table_sessions" ON table_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_table_sessions" ON table_sessions;
CREATE POLICY "anon_delete_table_sessions" ON table_sessions FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  order_number int NOT NULL,
  type text NOT NULL DEFAULT 'dine_in', -- dine_in | takeaway
  source text NOT NULL DEFAULT 'qr', -- qr | waiter | web | pos
  status text NOT NULL DEFAULT 'received', -- received | accepted | preparing | ready | served | closed | voided
  notes text,
  guest_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_orders" ON orders;
CREATE POLICY "anon_select_orders" ON orders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_orders" ON orders;
CREATE POLICY "anon_update_orders" ON orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_orders" ON orders;
CREATE POLICY "anon_delete_orders" ON orders FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  station text NOT NULL DEFAULT 'kitchen',
  quantity int NOT NULL DEFAULT 1,
  unit_price_minor bigint NOT NULL DEFAULT 0,
  modifiers jsonb NOT NULL DEFAULT '[]'::jsonb, -- array of {name, price_delta_minor}
  notes text,
  status text NOT NULL DEFAULT 'received', -- received | accepted | preparing | ready | served | voided | rejected
  allergy_alert boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_order_items" ON order_items;
CREATE POLICY "anon_select_order_items" ON order_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_order_items" ON order_items;
CREATE POLICY "anon_insert_order_items" ON order_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_order_items" ON order_items;
CREATE POLICY "anon_update_order_items" ON order_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_order_items" ON order_items;
CREATE POLICY "anon_delete_order_items" ON order_items FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  reason text NOT NULL, -- need_help | request_bill | water_refill | clean_table | cutlery | other
  detail text,
  status text NOT NULL DEFAULT 'sent', -- sent | seen | on_the_way | done
  acknowledged_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_service_requests" ON service_requests;
CREATE POLICY "anon_select_service_requests" ON service_requests FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_service_requests" ON service_requests;
CREATE POLICY "anon_insert_service_requests" ON service_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_service_requests" ON service_requests;
CREATE POLICY "anon_update_service_requests" ON service_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_service_requests" ON service_requests;
CREATE POLICY "anon_delete_service_requests" ON service_requests FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  subtotal_minor bigint NOT NULL DEFAULT 0,
  discount_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  service_minor bigint NOT NULL DEFAULT 0,
  tip_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open', -- open | paid | refunded
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_bills" ON bills;
CREATE POLICY "anon_select_bills" ON bills FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_bills" ON bills;
CREATE POLICY "anon_insert_bills" ON bills FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_bills" ON bills;
CREATE POLICY "anon_update_bills" ON bills FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_bills" ON bills;
CREATE POLICY "anon_delete_bills" ON bills FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  method text NOT NULL, -- cash | qris | card | transfer | voucher
  amount_minor bigint NOT NULL DEFAULT 0,
  provider_ref text,
  status text NOT NULL DEFAULT 'completed', -- pending | completed | failed | refunded
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_payments" ON payments;
CREATE POLICY "anon_select_payments" ON payments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
CREATE POLICY "anon_insert_payments" ON payments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_payments" ON payments;
CREATE POLICY "anon_update_payments" ON payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_payments" ON payments;
CREATE POLICY "anon_delete_payments" ON payments FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  table_id uuid REFERENCES tables(id) ON DELETE SET NULL,
  guest_name text NOT NULL,
  guest_phone text,
  guest_email text,
  party_size int NOT NULL DEFAULT 2,
  area_preference text,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  duration_minutes int NOT NULL DEFAULT 90,
  status text NOT NULL DEFAULT 'confirmed', -- pending | confirmed | arrived | seated | completed | cancelled | no_show
  notes text,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_reservations" ON reservations;
CREATE POLICY "anon_select_reservations" ON reservations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_reservations" ON reservations;
CREATE POLICY "anon_insert_reservations" ON reservations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_reservations" ON reservations;
CREATE POLICY "anon_update_reservations" ON reservations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_reservations" ON reservations;
CREATE POLICY "anon_delete_reservations" ON reservations FOR DELETE TO anon, authenticated USING (true);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_tables_outlet ON tables(outlet_id);
CREATE INDEX IF NOT EXISTS idx_tables_area ON tables(area_id);
CREATE INDEX IF NOT EXISTS idx_tables_qr_token ON tables(qr_token);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_outlet ON menu_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_station ON order_items(station);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_bills_session ON bills(session_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(booking_date);

-- Realtime publication: add all tables so frontend subscriptions work.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'outlets','areas','tables','menu_categories','menu_items',
    'menu_modifiers','menu_modifier_options','table_sessions','orders',
    'order_items','service_requests','bills','payments','reservations'
  ])
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I;', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
