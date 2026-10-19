// Song requests client. Guests go through token-validated RPCs; staff go
// through authenticated RPCs that check role + tenant membership server-side.
import { supabase } from '@/lib/supabase';

export interface SongGuestStatus {
  enabled: boolean;
  area_disabled?: boolean;
  paused?: boolean;
  open?: boolean;
  intro_text?: string;
  dedication_enabled?: boolean;
  mode?: 'free' | 'paid';
  request_price_minor?: number;
  max_per_table_per_hour?: number;
  max_queue?: number;
  my_request?: SongMyRequest | null;
  queue?: SongQueueEntry[];
  now_playing?: SongNowPlaying | null;
  recently_played?: { id: string; title: string; artist: string; played_at: string }[];
}

export interface SongMyRequest {
  id: string;
  title: string;
  artist: string;
  status: string;
  decline_reason?: string | null;
  queue_position?: number;
  votes_count?: number;
  requested_at?: string;
}

export interface SongQueueEntry {
  id: string;
  title: string;
  artist: string;
  dedication: string | null;
  nickname: string | null;
  table_label: string | null;
  votes: number;
  status: string;
  requested_at: string;
  queue_position: number;
}

export interface SongNowPlaying {
  title: string | null;
  artist: string | null;
  dedication: string | null;
  dedication_table_label: string | null;
  set_at: string;
}

export interface SongStaffRow {
  id: string;
  title: string;
  artist: string;
  dedication: string | null;
  nickname: string | null;
  table_label: string | null;
  area: string | null;
  votes: number;
  status: string;
  requested_at: string;
  queue_position?: number;
  paid?: boolean;
  amount_paid_minor?: number;
  boost?: boolean;
}

export interface SongSettings {
  enabled: boolean;
  area_ids: string[];
  schedule: Record<string, string[]>;
  paused: boolean;
  max_per_table_per_hour: number;
  max_queue: number;
  min_seconds_between: number;
  max_song_length_seconds: number | null;
  mode: 'free' | 'paid';
  moderation: 'auto' | 'approval';
  blocked_words: string[];
  blocked_songs: { title: string; artist: string }[];
  intro_text: string;
  dedication_enabled: boolean;
  request_price_minor: number;
  boost_price_minor: number;
  paid_to: 'venue' | 'dj_tip';
  refund_on_decline: boolean;
  add_to_bill: boolean;
  hide_table_on_display: boolean;
  hide_name_on_display: boolean;
  retention_days: number;
}

export interface SongStaffList {
  pending: SongStaffRow[];
  queue: SongStaffRow[];
  now_playing: SongNowPlaying | null;
  settings: SongSettings | null;
}

export const songApi = {
  guest: {
    status: (token: string) =>
      supabase.rpc('song_guest_status', { p_token: token }),
    submit: (token: string, title: string, artist: string, dedication: string | null, nickname: string | null) =>
      supabase.rpc('song_guest_submit', {
        p_token: token, p_title: title, p_artist: artist,
        p_dedication: dedication, p_nickname: nickname,
      }),
    vote: (token: string, requestId: string) =>
      supabase.rpc('song_guest_vote', { p_token: token, p_request_id: requestId }),
  },
  staff: {
    list: (outletId: string) =>
      supabase.rpc('song_staff_list', { p_outlet: outletId }),
    action: (requestId: string, action: string, reason: string | null = null) =>
      supabase.rpc('song_staff_action', { p_request_id: requestId, p_action: action, p_reason: reason }),
    reorder: (requestId: string, direction: 'up' | 'down') =>
      supabase.rpc('song_staff_reorder', { p_request_id: requestId, p_direction: direction }),
    setNow: (outletId: string, title: string | null, artist: string | null, dedication: string | null, tableLabel: string | null) =>
      supabase.rpc('song_staff_set_now', {
        p_outlet: outletId, p_title: title, p_artist: artist,
        p_dedication: dedication, p_table_label: tableLabel,
      }),
    pause: (outletId: string, paused: boolean) =>
      supabase.rpc('song_staff_pause', { p_outlet: outletId, p_paused: paused }),
    updateSettings: (outletId: string, settings: Partial<SongSettings>) =>
      supabase.rpc('song_staff_update_settings', {
        p_outlet: outletId, p_settings: settings as unknown as Record<string, unknown>,
      }),
    blockedTerm: (tenantId: string, kind: 'word' | 'song' | 'artist', term: string, add: boolean) =>
      supabase.rpc('song_staff_blocked_term', {
        p_tenant: tenantId, p_kind: kind, p_term: term, p_add: add,
      }),
  },
};
