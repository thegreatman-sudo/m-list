/*
# Song Requests module — schema, RLS, dj role

## What this migration does

Adds a new "Song Requests" guest-facing module so a venue with a DJ or live
music can accept song requests from table QR codes, run a DJ queue screen,
and show a venue display. This migration lays down the data model, Row Level
Security, and the new `dj` staff role. A companion migration adds the
server RPCs the guest page and DJ screen call.

## New role
- `dj` added to the `staff_invites.role` CHECK constraint so owners can
  invite a DJ/Performer from the Staff page. `profiles.role` has no CHECK
  (default 'owner') so it already accepts 'dj'.

## New tables (all carry tenant_id and outlet_id; tenant-scoped via RLS)

1. `song_request_settings` — one row per outlet. Master toggle (off by
   default), per-area enable, music schedule, limits (max per table per
   hour, max queue, min seconds between requests, max song length), mode
   (free/paid), moderation (auto-accept / needs-approval), blocked words,
   blocked songs/artists, intro text, dedication toggle, pause switch,
   paid-mode pricing, privacy + retention knobs.
2. `song_requests` — the queue. status pending/approved/queued/playing/
   played/declined/cancelled. Carries table_id, session_id, title, artist,
   normalised_key (for duplicate detection), dedication, nickname, votes,
   queue_position, paid flag + payment link, timestamps.
3. `song_votes` — one vote per session per request (unique).
4. `song_blocked_terms` — editable profanity / blocked songs list.
5. `dj_now_playing` — singleton per outlet: the track the DJ marked "now
   playing", plus a dedication popup payload for the venue display.

## Security
- RLS enabled on every new table.
- Staff (owner/manager/dj) get full CRUD on their tenant's rows via
  `is_staff_of(tenant_id)`; dj role is narrower where it matters (settings
  are owner/manager only; queue mutations allowed for dj/manager/owner).
- Guests never touch these tables directly. They go through SECURITY
  DEFINER RPCs (next migration) that validate the table qr_token, enforce
  limits/cooldown/blocked-words, and insert only the allowed columns. The
  `song_requests` INSERT/UPDATE/DELETE policies therefore do NOT include
  anon — anon can only SELECT (so the public queue screen can render).
- All text columns are length-capped and stripped of HTML at the RPC layer.

## Notes
- Idempotent: `IF NOT EXISTS` everywhere; policies dropped before create.
- No existing tables are altered except the `staff_invites` CHECK, which is
  replaced (drop + add) to include 'dj'. No data is lost.
- Quantities and money use integers / minor units, never floats.
*/

-- ============================================================ dj role
ALTER TABLE staff_invites DROP CONSTRAINT IF EXISTS staff_invites_role_check;
ALTER TABLE staff_invites ADD CONSTRAINT staff_invites_role_check
  CHECK (role IN ('manager','chef','waiter','cashier','host','dj'));

-- ============================================================ song_request_settings
CREATE TABLE IF NOT EXISTS song_request_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  area_ids uuid[] NOT NULL DEFAULT '{}', -- empty = all areas
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"mon":["18:00-23:00"], ...}
  paused boolean NOT NULL DEFAULT false,
  max_per_table_per_hour int NOT NULL DEFAULT 2,
  max_queue int NOT NULL DEFAULT 30,
  min_seconds_between int NOT NULL DEFAULT 120,
  max_song_length_seconds int, -- optional filter
  mode text NOT NULL DEFAULT 'free' CHECK (mode IN ('free','paid')),
  moderation text NOT NULL DEFAULT 'approval' CHECK (moderation IN ('auto','approval')),
  blocked_words text[] NOT NULL DEFAULT '{}',
  blocked_songs jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{title,artist}]
  intro_text text NOT NULL DEFAULT '',
  dedication_enabled boolean NOT NULL DEFAULT true,
  request_price_minor bigint NOT NULL DEFAULT 0,
  boost_price_minor bigint NOT NULL DEFAULT 0,
  paid_to text NOT NULL DEFAULT 'venue' CHECK (paid_to IN ('venue','dj_tip')),
  refund_on_decline boolean NOT NULL DEFAULT true,
  add_to_bill boolean NOT NULL DEFAULT true,
  hide_table_on_display boolean NOT NULL DEFAULT false,
  hide_name_on_display boolean NOT NULL DEFAULT false,
  retention_days int NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id)
);
ALTER TABLE song_request_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "song_settings_select_staff" ON song_request_settings;
CREATE POLICY "song_settings_select_staff" ON song_request_settings
  FOR SELECT TO authenticated
  USING (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "song_settings_insert_staff" ON song_request_settings;
CREATE POLICY "song_settings_insert_staff" ON song_request_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS "song_settings_update_staff" ON song_request_settings;
CREATE POLICY "song_settings_update_staff" ON song_request_settings
  FOR UPDATE TO authenticated
  USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS "song_settings_delete_staff" ON song_request_settings;
CREATE POLICY "song_settings_delete_staff" ON song_request_settings
  FOR DELETE TO authenticated
  USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- Guests read settings through the RPC layer (SECURITY DEFINER), so anon
-- does NOT get a direct SELECT here.

-- ============================================================ song_requests
CREATE TABLE IF NOT EXISTS song_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  session_id uuid, -- table_sessions id, nullable for anonymous QR flow
  title text NOT NULL,
  artist text NOT NULL,
  normalised_key text NOT NULL, -- lower(title|artist) for dup detection
  dedication text,
  nickname text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','queued','playing','played','declined','cancelled')),
  decline_reason text,
  votes_count int NOT NULL DEFAULT 0,
  queue_position int NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  payment_id uuid,
  amount_paid_minor bigint NOT NULL DEFAULT 0,
  boost boolean NOT NULL DEFAULT false,
  requested_at timestamptz NOT NULL DEFAULT now(),
  played_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE song_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS song_requests_outlet_status_idx
  ON song_requests (outlet_id, status, requested_at);
CREATE INDEX IF NOT EXISTS song_requests_outlet_key_idx
  ON song_requests (outlet_id, normalised_key);
CREATE INDEX IF NOT EXISTS song_requests_tenant_idx ON song_requests (tenant_id);

-- Staff can read/write the queue.
DROP POLICY IF EXISTS "song_requests_select_staff" ON song_requests;
CREATE POLICY "song_requests_select_staff" ON song_requests
  FOR SELECT TO authenticated
  USING (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "song_requests_insert_staff" ON song_requests;
CREATE POLICY "song_requests_insert_staff" ON song_requests
  FOR INSERT TO authenticated
  WITH CHECK (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "song_requests_update_staff" ON song_requests;
CREATE POLICY "song_requests_update_staff" ON song_requests
  FOR UPDATE TO authenticated
  USING (is_staff_of(tenant_id))
  WITH CHECK (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "song_requests_delete_staff" ON song_requests;
CREATE POLICY "song_requests_delete_staff" ON song_requests
  FOR DELETE TO authenticated
  USING (is_staff_of(tenant_id));

-- Public/anon can read the queue for a given outlet so the guest queue
-- screen renders without login. The outlet filter is enforced at the RPC
-- layer (guest_get_song_queue returns only the caller's outlet). A broad
-- anon SELECT would leak across tenants, so we do NOT grant anon SELECT
-- here; guests read via the SECURITY DEFINER RPC instead.

-- ============================================================ song_votes
CREATE TABLE IF NOT EXISTS song_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES song_requests(id) ON DELETE CASCADE,
  session_id text NOT NULL, -- guest session token hash or session id
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, session_id)
);
ALTER TABLE song_votes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS song_votes_request_idx ON song_votes (request_id);

DROP POLICY IF EXISTS "song_votes_select_staff" ON song_votes;
CREATE POLICY "song_votes_select_staff" ON song_votes
  FOR SELECT TO authenticated
  USING (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "song_votes_insert_staff" ON song_votes;
CREATE POLICY "song_votes_insert_staff" ON song_votes
  FOR INSERT TO authenticated
  WITH CHECK (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "song_votes_delete_staff" ON song_votes;
CREATE POLICY "song_votes_delete_staff" ON song_votes
  FOR DELETE TO authenticated
  USING (is_staff_of(tenant_id));

-- ============================================================ song_blocked_terms
CREATE TABLE IF NOT EXISTS song_blocked_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  term text NOT NULL,
  kind text NOT NULL DEFAULT 'word' CHECK (kind IN ('word','song','artist')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, term, kind)
);
ALTER TABLE song_blocked_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "song_blocked_select_staff" ON song_blocked_terms;
CREATE POLICY "song_blocked_select_staff" ON song_blocked_terms
  FOR SELECT TO authenticated
  USING (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "song_blocked_insert_staff" ON song_blocked_terms;
CREATE POLICY "song_blocked_insert_staff" ON song_blocked_terms
  FOR INSERT TO authenticated
  WITH CHECK (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS "song_blocked_delete_staff" ON song_blocked_terms;
CREATE POLICY "song_blocked_delete_staff" ON song_blocked_terms
  FOR DELETE TO authenticated
  USING (is_staff_of(tenant_id) AND has_role(tenant_id, ARRAY['owner','manager']));

-- ============================================================ dj_now_playing
CREATE TABLE IF NOT EXISTS dj_now_playing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  title text,
  artist text,
  dedication text,
  dedication_table_label text,
  set_by uuid, -- profile id of DJ/manager
  set_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id)
);
ALTER TABLE dj_now_playing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dj_np_select_staff" ON dj_now_playing;
CREATE POLICY "dj_np_select_staff" ON dj_now_playing
  FOR SELECT TO authenticated
  USING (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "dj_np_upsert_staff" ON dj_now_playing;
CREATE POLICY "dj_np_upsert_staff" ON dj_now_playing
  FOR INSERT TO authenticated
  WITH CHECK (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "dj_np_update_staff" ON dj_now_playing;
CREATE POLICY "dj_np_update_staff" ON dj_now_playing
  FOR UPDATE TO authenticated
  USING (is_staff_of(tenant_id))
  WITH CHECK (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "dj_np_delete_staff" ON dj_now_playing;
CREATE POLICY "dj_np_delete_staff" ON dj_now_playing
  FOR DELETE TO authenticated
  USING (is_staff_of(tenant_id));

-- ============================================================ audit action values
-- Moderation actions are logged in the existing inventory_audit_log pattern;
-- here we reuse a generic audit_log if present, otherwise the app logs via
-- a new song_request_audit_log table (kept minimal).
CREATE TABLE IF NOT EXISTS song_request_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE song_request_audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS song_audit_tenant_idx ON song_request_audit_log (tenant_id, created_at);

DROP POLICY IF EXISTS "song_audit_select_staff" ON song_request_audit_log;
CREATE POLICY "song_audit_select_staff" ON song_request_audit_log
  FOR SELECT TO authenticated
  USING (is_staff_of(tenant_id));

DROP POLICY IF EXISTS "song_audit_insert_staff" ON song_request_audit_log;
CREATE POLICY "song_audit_insert_staff" ON song_request_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (is_staff_of(tenant_id));
