/*
# Song Requests — server RPCs

## What this migration adds

The SECURITY DEFINER functions the guest page, DJ screen, and venue display
call. Guests never touch the song_* tables directly — every guest action
goes through a token-validated RPC that enforces limits, cooldowns, the
blocked-words list, duplicate detection (vote instead of duplicate), and
length caps. Staff/DJ actions go through authenticated RPCs that check
`is_staff_of(tenant_id)` and the right role.

## Guest RPCs (anon, token-validated)
- `song_guest_status(p_token)` — returns settings (sanitised), open/closed
  state, the caller's most recent request, and the public queue (now
  playing, up next, recently played). This is the single read the guest
  page uses; no direct table SELECT needed.
- `song_guest_submit(p_token, p_title, p_artist, p_dedication, p_nickname)`
  — creates a request or, if a matching normalised_key is already in the
  queue, adds a vote instead. Enforces: feature on, schedule open, not
  paused, area allowed, per-table per-hour limit, min-seconds cooldown,
  queue size cap, blocked words / blocked songs, length caps, HTML strip.
- `song_guest_vote(p_token, p_request_id)` — one vote per session per
  request.

## Staff/DJ RPCs (authenticated)
- `song_staff_list(p_outlet)` — full queue for the DJ screen.
- `song_staff_action(p_request_id, p_action, p_reason)` — approve / decline
  / play / played / skip / remove. Logs to song_request_audit_log.
- `song_staff_reorder(p_request_id, p_direction)` — move up/down.
- `song_staff_set_now(p_outlet, p_title, p_artist, p_dedication, p_table_label)`
  — set the Now Playing panel + dedication popup.
- `song_staff_pause(p_outlet, p_paused)` — instant pause/resume.
- `song_staff_update_settings(p_outlet, p_settings jsonb)` — owner/manager
  only. Upserts the settings row.
- `song_staff_blocked_terms(p_tenant, p_kind, p_term, p_add boolean)` —
  owner/manager add/remove a blocked term.

## Security
- Guest RPCs revoked from authenticated, granted to anon. They resolve the
  tenant/outlet from the qr_token and never accept a tenant_id argument,
  so a guest can only ever touch one outlet.
- Staff RPCs revoked from anon, granted to authenticated. Each checks
  is_staff_of + has_role with the right role set.
- All text inputs are trimmed, length-capped, and HTML-stripped via a
  helper `song_sanitise(p_text, p_max)` that removes <, >, & and clips.
- Money is bigint minor units; quantities are int.

## Idempotency / safety
- song_guest_submit is idempotent on normalised_key: a second submit for
  the same song within the active queue becomes a vote, not a duplicate.
- No destructive ops; no transactions control (DO blocks only).
*/

-- ============================================================ helpers
CREATE OR REPLACE FUNCTION public.song_sanitise(p_text text, p_max int DEFAULT 100)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT left(btrim(
    regexp_replace(COALESCE(p_text, ''), '[<>&"''\\\x00-\x1f]', ' ', 'g')
  ), p_max)
$$;

CREATE OR REPLACE FUNCTION public.song_norm_key(p_title text, p_artist text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT lower(regexp_replace(
    regexp_replace(COALESCE(p_title,'') || '|' || COALESCE(p_artist,''),
    '[^a-zA-Z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- ============================================================ guest: status + queue
CREATE OR REPLACE FUNCTION public.song_guest_status(p_token text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet outlets%ROWTYPE;
  v_settings song_request_settings%ROWTYPE;
  v_area areas%ROWTYPE;
  v_now text;
  v_day text;
  v_open boolean;
  v_next_open text;
  v_session table_sessions%ROWTYPE;
  v_my_request jsonb;
  v_queue jsonb;
  v_now_playing jsonb;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id;
  SELECT * INTO v_area FROM areas WHERE id = v_table.area_id;

  SELECT * INTO v_settings FROM song_request_settings WHERE outlet_id = v_outlet.id;
  IF v_settings.id IS NULL THEN
    RETURN json_build_object('enabled', false);
  END IF;

  -- Feature off => nothing for the guest
  IF NOT v_settings.enabled THEN
    RETURN json_build_object('enabled', false);
  END IF;

  -- Area filter
  IF array_length(v_settings.area_ids, 1) IS NOT NULL
     AND NOT (v_table.area_id = ANY (v_settings.area_ids)) THEN
    RETURN json_build_object('enabled', false, 'area_disabled', true);
  END IF;

  -- Schedule check
  v_day := lower(to_char(now() AT TIME ZONE COALESCE(v_outlet.timezone, 'Asia/Jakarta'), 'dy'));
  v_now := to_char(now() AT TIME ZONE COALESCE(v_outlet.timezone, 'Asia/Jakarta'), 'HH24:MI');
  v_open := false;
  v_next_open := NULL;
  BEGIN
    DECLARE r text; lo text; hi text;
    BEGIN
      FOR r IN SELECT jsonb_array_elements_text(v_settings.schedule->v_day) LOOP
        lo := split_part(r, '-', 1);
        hi := split_part(r, '-', 2);
        IF v_now >= lo AND v_now < hi THEN v_open := true; END IF;
      END LOOP;
    END;
  END;

  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;

  -- caller's most recent active request
  SELECT to_jsonb(r) INTO v_my_request
  FROM song_requests r
  WHERE r.outlet_id = v_outlet.id AND r.table_id = v_table.id
    AND r.status IN ('pending','approved','queued','playing')
  ORDER BY r.requested_at DESC LIMIT 1;

  -- public queue (hide dedication if disabled; hide nickname if display setting)
  SELECT COALESCE(json_agg(json_build_object(
    'id', q.id, 'title', q.title, 'artist', q.artist,
    'dedication', CASE WHEN v_settings.dedication_enabled THEN q.dedication ELSE NULL END,
    'nickname', CASE WHEN v_settings.hide_name_on_display THEN NULL ELSE q.nickname END,
    'table_label', CASE WHEN v_settings.hide_table_on_display THEN NULL ELSE v_table.label END,
    'votes', q.votes_count, 'status', q.status,
    'requested_at', q.requested_at, 'queue_position', q.queue_position
  ) ORDER BY q.queue_position, q.votes_count DESC, q.requested_at), '[]'::json) INTO v_queue
  FROM song_requests q
  JOIN tables t ON t.id = q.table_id
  LEFT JOIN LATERAL (
    SELECT label FROM tables WHERE id = q.table_id
  ) v_table ON false
  WHERE q.outlet_id = v_outlet.id AND q.status IN ('approved','queued','playing')
  ORDER BY q.queue_position, q.votes_count DESC, q.requested_at;

  SELECT to_jsonb(n) INTO v_now_playing
  FROM dj_now_playing n WHERE n.outlet_id = v_outlet.id;

  RETURN json_build_object(
    'enabled', true,
    'paused', v_settings.paused,
    'open', v_open AND NOT v_settings.paused,
    'intro_text', v_settings.intro_text,
    'dedication_enabled', v_settings.dedication_enabled,
    'mode', v_settings.mode,
    'request_price_minor', v_settings.request_price_minor,
    'max_per_table_per_hour', v_settings.max_per_table_per_hour,
    'max_queue', v_settings.max_queue,
    'my_request', v_my_request,
    'queue', v_queue,
    'now_playing', v_now_playing,
    'recently_played', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', r.id, 'title', r.title, 'artist', r.artist, 'played_at', r.played_at
      ) ORDER BY r.played_at DESC), '[]'::json)
      FROM song_requests r
      WHERE r.outlet_id = v_outlet.id AND r.status = 'played'
      ORDER BY r.played_at DESC LIMIT 10
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_guest_status(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.song_guest_status(text) TO anon;

-- ============================================================ guest: submit / vote
CREATE OR REPLACE FUNCTION public.song_guest_submit(
  p_token text,
  p_title text,
  p_artist text,
  p_dedication text DEFAULT NULL,
  p_nickname text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet outlets%ROWTYPE;
  v_settings song_request_settings%ROWTYPE;
  v_title text;
  v_artist text;
  v_ded text;
  v_nick text;
  v_key text;
  v_session table_sessions%ROWTYPE;
  v_existing song_requests%ROWTYPE;
  v_last_at timestamptz;
  v_last_hour_count int;
  v_active_count int;
  v_word text;
  v_id uuid;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id;
  SELECT * INTO v_settings FROM song_request_settings WHERE outlet_id = v_outlet.id;

  IF v_settings.id IS NULL OR NOT v_settings.enabled THEN
    RAISE EXCEPTION 'Song requests are not available';
  END IF;
  IF v_settings.paused THEN
    RAISE EXCEPTION 'Requests are paused for a moment';
  END IF;
  IF array_length(v_settings.area_ids, 1) IS NOT NULL
     AND NOT (v_table.area_id = ANY (v_settings.area_ids)) THEN
    RAISE EXCEPTION 'Song requests are not available in this area';
  END IF;

  v_title := song_sanitise(p_title, 120);
  v_artist := song_sanitise(p_artist, 120);
  v_ded := CASE WHEN v_settings.dedication_enabled THEN song_sanitise(p_dedication, 100) ELSE NULL END;
  v_nick := song_sanitise(p_nickname, 40);

  IF v_title = '' OR v_artist = '' THEN
    RAISE EXCEPTION 'Song and artist are required';
  END IF;

  v_key := song_norm_key(v_title, v_artist);

  -- blocked words
  FOR v_word IN SELECT unnest(v_settings.blocked_words) LOOP
    IF v_word <> '' AND (v_title ILIKE '%' || v_word || '%' OR v_artist ILIKE '%' || v_word || '%' OR COALESCE(v_ded,'') ILIKE '%' || v_word || '%') THEN
      RAISE EXCEPTION 'This request can''t be accepted';
    END IF;
  END LOOP;
  -- blocked songs/artists table
  IF EXISTS (SELECT 1 FROM song_blocked_terms b
             WHERE b.tenant_id = v_outlet.tenant_id
               AND ((b.kind = 'song' AND v_title ILIKE '%' || b.term || '%')
                 OR (b.kind = 'artist' AND v_artist ILIKE '%' || b.term || '%'))) THEN
    RAISE EXCEPTION 'This request can''t be accepted';
  END IF;

  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;

  -- duplicate in active queue => vote instead
  SELECT * INTO v_existing FROM song_requests
    WHERE outlet_id = v_outlet.id AND normalised_key = v_key
      AND status IN ('pending','approved','queued','playing')
    ORDER BY requested_at DESC LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    -- vote (idempotent per session)
    IF v_session.id IS NOT NULL THEN
      INSERT INTO song_votes (tenant_id, outlet_id, request_id, session_id)
      VALUES (v_outlet.tenant_id, v_outlet.id, v_existing.id, v_session.id::text)
      ON CONFLICT (request_id, session_id) DO NOTHING;
      UPDATE song_requests SET votes_count = (
        SELECT count(*) FROM song_votes WHERE request_id = v_existing.id
      ), updated_at = now() WHERE id = v_existing.id;
    END IF;
    RETURN json_build_object('status', 'voted', 'request_id', v_existing.id);
  END IF;

  -- cooldown + per-hour limit
  SELECT requested_at INTO v_last_at FROM song_requests
    WHERE outlet_id = v_outlet.id AND table_id = v_table.id
    ORDER BY requested_at DESC LIMIT 1;
  IF v_last_at IS NOT NULL AND extract(epoch from now() - v_last_at) < v_settings.min_seconds_between THEN
    RAISE EXCEPTION 'Your table can request again in % minutes',
      ceil((v_settings.min_seconds_between - extract(epoch from now() - v_last_at))/60);
  END IF;
  SELECT count(*) INTO v_last_hour_count FROM song_requests
    WHERE outlet_id = v_outlet.id AND table_id = v_table.id
      AND requested_at > now() - interval '1 hour';
  IF v_last_hour_count >= v_settings.max_per_table_per_hour THEN
    RAISE EXCEPTION 'Your table has reached its request limit for this hour';
  END IF;

  -- queue cap
  SELECT count(*) INTO v_active_count FROM song_requests
    WHERE outlet_id = v_outlet.id AND status IN ('pending','approved','queued','playing');
  IF v_active_count >= v_settings.max_queue THEN
    RAISE EXCEPTION 'The request queue is full right now';
  END IF;

  INSERT INTO song_requests (
    tenant_id, outlet_id, table_id, session_id,
    title, artist, normalised_key, dedication, nickname,
    status, queue_position
  ) VALUES (
    v_outlet.tenant_id, v_outlet.id, v_table.id, v_session.id,
    v_title, v_artist, v_key, v_ded, v_nick,
    CASE WHEN v_settings.moderation = 'auto' THEN 'queued' ELSE 'pending' END,
    v_active_count + 1
  )
  RETURNING id INTO v_id;

  RETURN json_build_object('status', 'submitted', 'request_id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_guest_submit(text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.song_guest_submit(text, text, text, text, text) TO anon;

CREATE OR REPLACE FUNCTION public.song_guest_vote(p_token text, p_request_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet outlets%ROWTYPE;
  v_session table_sessions%ROWTYPE;
  v_req song_requests%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
  SELECT * INTO v_outlet FROM outlets WHERE id = v_table.outlet_id;
  SELECT * INTO v_req FROM song_requests WHERE id = p_request_id AND outlet_id = v_outlet.id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.status NOT IN ('approved','queued') THEN
    RAISE EXCEPTION 'You can only vote for a queued song';
  END IF;
  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Session expired'; END IF;

  INSERT INTO song_votes (tenant_id, outlet_id, request_id, session_id)
  VALUES (v_outlet.tenant_id, v_outlet.id, v_req.id, v_session.id::text)
  ON CONFLICT (request_id, session_id) DO NOTHING;

  UPDATE song_requests SET votes_count = (
    SELECT count(*) FROM song_votes WHERE request_id = v_req.id
  ), updated_at = now() WHERE id = v_req.id;

  RETURN json_build_object('status', 'voted');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_guest_vote(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.song_guest_vote(text, uuid) TO anon;

-- ============================================================ staff: list
CREATE OR REPLACE FUNCTION public.song_staff_list(p_outlet uuid)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM outlets WHERE id = p_outlet;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Outlet not found'; END IF;
  IF NOT is_staff_of(v_tenant) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN json_build_object(
    'pending', COALESCE((
      SELECT json_agg(json_build_object(
        'id', r.id, 'title', r.title, 'artist', r.artist,
        'dedication', r.dedication, 'nickname', r.nickname,
        'table_label', t.label, 'area', a.name,
        'votes', r.votes_count, 'status', r.status,
        'requested_at', r.requested_at, 'paid', r.paid, 'amount_paid_minor', r.amount_paid_minor
      ) ORDER BY r.requested_at)
      FROM song_requests r
      JOIN tables t ON t.id = r.table_id
      LEFT JOIN areas a ON a.id = t.area_id
      WHERE r.outlet_id = p_outlet AND r.status = 'pending'
    ), '[]'::json),
    'queue', COALESCE((
      SELECT json_agg(json_build_object(
        'id', r.id, 'title', r.title, 'artist', r.artist,
        'dedication', r.dedication, 'nickname', r.nickname,
        'table_label', t.label, 'area', a.name,
        'votes', r.votes_count, 'status', r.status,
        'queue_position', r.queue_position, 'requested_at', r.requested_at,
        'paid', r.paid, 'amount_paid_minor', r.amount_paid_minor, 'boost', r.boost
      ) ORDER BY r.queue_position, r.votes_count DESC)
      FROM song_requests r
      JOIN tables t ON t.id = r.table_id
      LEFT JOIN areas a ON a.id = t.area_id
      WHERE r.outlet_id = p_outlet AND r.status IN ('approved','queued','playing')
    ), '[]'::json),
    'now_playing', (SELECT to_jsonb(n) FROM dj_now_playing n WHERE n.outlet_id = p_outlet),
    'settings', (SELECT to_jsonb(s) FROM song_request_settings s WHERE s.outlet_id = p_outlet)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_staff_list(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.song_staff_list(uuid) TO authenticated;

-- ============================================================ staff: action
CREATE OR REPLACE FUNCTION public.song_staff_action(
  p_request_id uuid, p_action text, p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r song_requests%ROWTYPE;
  v_tenant uuid;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO r FROM song_requests WHERE id = p_request_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_tenant := r.tenant_id;
  IF NOT is_staff_of(v_tenant) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT has_role(v_tenant, ARRAY['owner','manager','dj']) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  CASE p_action
    WHEN 'approve' THEN
      UPDATE song_requests SET status = 'queued', updated_at = now()
      WHERE id = r.id AND status = 'pending';
    WHEN 'decline' THEN
      UPDATE song_requests SET status = 'declined', decline_reason = song_sanitise(p_reason, 120),
        updated_at = now()
      WHERE id = r.id AND status IN ('pending','queued');
    WHEN 'play' THEN
      UPDATE song_requests SET status = 'playing', played_at = now(), updated_at = now()
      WHERE id = r.id AND status IN ('queued','approved');
      UPDATE dj_now_playing SET title = r.title, artist = r.artist,
        dedication = r.dedication, dedication_table_label = (SELECT label FROM tables WHERE id = r.table_id),
        set_by = v_actor, set_at = now(), updated_at = now()
      WHERE outlet_id = r.outlet_id;
    WHEN 'played' THEN
      UPDATE song_requests SET status = 'played', played_at = now(), updated_at = now()
      WHERE id = r.id;
      UPDATE dj_now_playing SET title = NULL, artist = NULL, dedication = NULL,
        dedication_table_label = NULL, updated_at = now()
      WHERE outlet_id = r.outlet_id;
    WHEN 'skip' THEN
      UPDATE song_requests SET status = 'played', played_at = now(), updated_at = now()
      WHERE id = r.id AND status = 'playing';
      UPDATE dj_now_playing SET title = NULL, artist = NULL, dedication = NULL,
        dedication_table_label = NULL, updated_at = now()
      WHERE outlet_id = r.outlet_id;
    WHEN 'remove' THEN
      DELETE FROM song_requests WHERE id = r.id;
    ELSE
      RAISE EXCEPTION 'Unknown action';
  END CASE;

  INSERT INTO song_request_audit_log (tenant_id, actor, action, detail)
  VALUES (v_tenant, v_actor, 'song_' || p_action,
    jsonb_build_object('request_id', r.id, 'reason', p_reason));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_staff_action(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.song_staff_action(uuid, text, text) TO authenticated;

-- ============================================================ staff: reorder
CREATE OR REPLACE FUNCTION public.song_staff_reorder(p_request_id uuid, p_direction text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r song_requests%ROWTYPE;
  v_tenant uuid;
  v_swap uuid;
BEGIN
  SELECT * INTO r FROM song_requests WHERE id = p_request_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_tenant := r.tenant_id;
  IF NOT is_staff_of(v_tenant) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT has_role(v_tenant, ARRAY['owner','manager','dj']) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF r.status NOT IN ('queued','approved') THEN RETURN; END IF;

  IF p_direction = 'up' THEN
    SELECT id INTO v_swap FROM song_requests
      WHERE outlet_id = r.outlet_id AND status IN ('queued','approved')
        AND queue_position < r.queue_position
      ORDER BY queue_position DESC LIMIT 1;
  ELSIF p_direction = 'down' THEN
    SELECT id INTO v_swap FROM song_requests
      WHERE outlet_id = r.outlet_id AND status IN ('queued','approved')
        AND queue_position > r.queue_position
      ORDER BY queue_position ASC LIMIT 1;
  END IF;

  IF v_swap IS NOT NULL THEN
    UPDATE song_requests SET queue_position = r.queue_position WHERE id = v_swap;
    UPDATE song_requests SET queue_position = (SELECT queue_position FROM song_requests WHERE id = v_swap)
      WHERE id = r.id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_staff_reorder(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.song_staff_reorder(uuid, text) TO authenticated;

-- ============================================================ staff: set now playing
CREATE OR REPLACE FUNCTION public.song_staff_set_now(
  p_outlet uuid, p_title text DEFAULT NULL, p_artist text DEFAULT NULL,
  p_dedication text DEFAULT NULL, p_table_label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid := auth.uid();
BEGIN
  SELECT tenant_id INTO v_tenant FROM outlets WHERE id = p_outlet;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Outlet not found'; END IF;
  IF NOT is_staff_of(v_tenant) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT has_role(v_tenant, ARRAY['owner','manager','dj']) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  INSERT INTO dj_now_playing (tenant_id, outlet_id, title, artist, dedication, dedication_table_label, set_by)
  VALUES (v_tenant, p_outlet, song_sanitise(p_title,120), song_sanitise(p_artist,120),
          song_sanitise(p_dedication,100), song_sanitise(p_table_label,20), v_actor)
  ON CONFLICT (outlet_id) DO UPDATE SET
    title = EXCLUDED.title, artist = EXCLUDED.artist,
    dedication = EXCLUDED.dedication, dedication_table_label = EXCLUDED.dedication_table_label,
    set_by = EXCLUDED.set_by, set_at = now(), updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_staff_set_now(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.song_staff_set_now(uuid, text, text, text, text) TO authenticated;

-- ============================================================ staff: pause
CREATE OR REPLACE FUNCTION public.song_staff_pause(p_outlet uuid, p_paused boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM outlets WHERE id = p_outlet;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Outlet not found'; END IF;
  IF NOT is_staff_of(v_tenant) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT has_role(v_tenant, ARRAY['owner','manager','dj']) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE song_request_settings SET paused = p_paused, updated_at = now() WHERE outlet_id = p_outlet;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_staff_pause(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.song_staff_pause(uuid, boolean) TO authenticated;

-- ============================================================ staff: update settings
CREATE OR REPLACE FUNCTION public.song_staff_update_settings(p_outlet uuid, p_settings jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  s song_request_settings%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM outlets WHERE id = p_outlet;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Outlet not found'; END IF;
  IF NOT is_staff_of(v_tenant) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT has_role(v_tenant, ARRAY['owner','manager']) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  INSERT INTO song_request_settings (tenant_id, outlet_id, enabled, area_ids, schedule, paused,
    max_per_table_per_hour, max_queue, min_seconds_between, max_song_length_seconds, mode, moderation,
    blocked_words, blocked_songs, intro_text, dedication_enabled, request_price_minor, boost_price_minor,
    paid_to, refund_on_decline, add_to_bill, hide_table_on_display, hide_name_on_display, retention_days)
  VALUES (
    v_tenant, p_outlet,
    COALESCE((p_settings->>'enabled')::boolean, false),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_settings->'area_ids')), ARRAY[]::uuid[]),
    COALESCE(p_settings->'schedule', '{}'::jsonb),
    COALESCE((p_settings->>'paused')::boolean, false),
    COALESCE((p_settings->>'max_per_table_per_hour')::int, 2),
    COALESCE((p_settings->>'max_queue')::int, 30),
    COALESCE((p_settings->>'min_seconds_between')::int, 120),
    NULLIF(p_settings->>'max_song_length_seconds','')::int,
    COALESCE(p_settings->>'mode','free'),
    COALESCE(p_settings->>'moderation','approval'),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_settings->'blocked_words')), ARRAY[]::text[]),
    COALESCE(p_settings->'blocked_songs','[]'::jsonb),
    COALESCE(p_settings->>'intro_text',''),
    COALESCE((p_settings->>'dedication_enabled')::boolean, true),
    COALESCE((p_settings->>'request_price_minor')::bigint, 0),
    COALESCE((p_settings->>'boost_price_minor')::bigint, 0),
    COALESCE(p_settings->>'paid_to','venue'),
    COALESCE((p_settings->>'refund_on_decline')::boolean, true),
    COALESCE((p_settings->>'add_to_bill')::boolean, true),
    COALESCE((p_settings->>'hide_table_on_display')::boolean, false),
    COALESCE((p_settings->>'hide_name_on_display')::boolean, false),
    COALESCE((p_settings->>'retention_days')::int, 90)
  )
  ON CONFLICT (outlet_id) DO UPDATE SET
    enabled = EXCLUDED.enabled, area_ids = EXCLUDED.area_ids, schedule = EXCLUDED.schedule,
    paused = EXCLUDED.paused, max_per_table_per_hour = EXCLUDED.max_per_table_per_hour,
    max_queue = EXCLUDED.max_queue, min_seconds_between = EXCLUDED.min_seconds_between,
    max_song_length_seconds = EXCLUDED.max_song_length_seconds, mode = EXCLUDED.mode,
    moderation = EXCLUDED.moderation, blocked_words = EXCLUDED.blocked_words,
    blocked_songs = EXCLUDED.blocked_songs, intro_text = EXCLUDED.intro_text,
    dedication_enabled = EXCLUDED.dedication_enabled,
    request_price_minor = EXCLUDED.request_price_minor,
    boost_price_minor = EXCLUDED.boost_price_minor, paid_to = EXCLUDED.paid_to,
    refund_on_decline = EXCLUDED.refund_on_decline, add_to_bill = EXCLUDED.add_to_bill,
    hide_table_on_display = EXCLUDED.hide_table_on_display,
    hide_name_on_display = EXCLUDED.hide_name_on_display,
    retention_days = EXCLUDED.retention_days, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_staff_update_settings(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.song_staff_update_settings(uuid, jsonb) TO authenticated;

-- ============================================================ staff: blocked terms
CREATE OR REPLACE FUNCTION public.song_staff_blocked_term(
  p_tenant uuid, p_kind text, p_term text, p_add boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_staff_of(p_tenant) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT has_role(p_tenant, ARRAY['owner','manager']) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_kind NOT IN ('word','song','artist') THEN RAISE EXCEPTION 'Invalid kind'; END IF;
  IF p_add THEN
    INSERT INTO song_blocked_terms (tenant_id, term, kind)
    VALUES (p_tenant, lower(song_sanitise(p_term, 80)), p_kind)
    ON CONFLICT (tenant_id, term, kind) DO NOTHING;
  ELSE
    DELETE FROM song_blocked_terms
    WHERE tenant_id = p_tenant AND kind = p_kind AND term = lower(song_sanitise(p_term, 80));
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_staff_blocked_term(uuid, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.song_staff_blocked_term(uuid, text, text, boolean) TO authenticated;
