/*
# Fix song_guest_status queue query (v2)

## What happened
Two bugs in the queue aggregation of `song_guest_status`:
1. A LATERAL alias colliding with the PL/pgSQL variable `v_table` (ambiguous label).
2. An outer ORDER BY on non-aggregated columns inside a json_agg query (42803).

## What this migration does
Replaces the function: queue aggregation joins `tables t` and uses `t.label`;
ordering happens inside json_agg only (no outer ORDER BY). Privacy switches
(dedication, nickname, table label) still apply.

## Safety
- Function replacement only; no data changes. Idempotent.
*/

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
  IF v_settings.id IS NULL OR NOT v_settings.enabled THEN
    RETURN json_build_object('enabled', false);
  END IF;
  IF array_length(v_settings.area_ids, 1) IS NOT NULL
     AND NOT (v_table.area_id = ANY (v_settings.area_ids)) THEN
    RETURN json_build_object('enabled', false, 'area_disabled', true);
  END IF;

  v_day := lower(to_char(now() AT TIME ZONE COALESCE(v_outlet.timezone, 'Asia/Jakarta'), 'dy'));
  v_now := to_char(now() AT TIME ZONE COALESCE(v_outlet.timezone, 'Asia/Jakarta'), 'HH24:MI');
  v_open := false;
  BEGIN
    DECLARE r text; lo text; hi text;
    BEGIN
      FOR r IN SELECT jsonb_array_elements_text(COALESCE(v_settings.schedule->v_day, '[]'::jsonb)) LOOP
        lo := split_part(r, '-', 1);
        hi := split_part(r, '-', 2);
        IF v_now >= lo AND v_now < hi THEN v_open := true; END IF;
      END LOOP;
    END;
  END;

  SELECT * INTO v_session FROM table_sessions
    WHERE table_id = v_table.id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;

  SELECT to_jsonb(r) INTO v_my_request
  FROM song_requests r
  WHERE r.outlet_id = v_outlet.id AND r.table_id = v_table.id
    AND r.status IN ('pending','approved','queued','playing')
  ORDER BY r.requested_at DESC LIMIT 1;

  SELECT COALESCE(json_agg(json_build_object(
    'id', q.id, 'title', q.title, 'artist', q.artist,
    'dedication', CASE WHEN v_settings.dedication_enabled THEN q.dedication ELSE NULL END,
    'nickname', CASE WHEN v_settings.hide_name_on_display THEN NULL ELSE q.nickname END,
    'table_label', CASE WHEN v_settings.hide_table_on_display THEN NULL ELSE t.label END,
    'votes', q.votes_count, 'status', q.status,
    'requested_at', q.requested_at, 'queue_position', q.queue_position
  ) ORDER BY q.queue_position, q.votes_count DESC, q.requested_at), '[]'::json) INTO v_queue
  FROM song_requests q
  JOIN tables t ON t.id = q.table_id
  WHERE q.outlet_id = v_outlet.id AND q.status IN ('approved','queued','playing');

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
      SELECT COALESCE(json_agg(x), '[]'::json)
      FROM (
        SELECT json_build_object('id', r.id, 'title', r.title, 'artist', r.artist, 'played_at', r.played_at) AS x
        FROM song_requests r
        WHERE r.outlet_id = v_outlet.id AND r.status = 'played'
        ORDER BY r.played_at DESC LIMIT 10
      ) sub
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.song_guest_status(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.song_guest_status(text) TO anon;
