import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Supabase env vars are missing. Check .env for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});

export const SUPABASE_URL = url;

/** Demo tenant id — used only by the public read-only demo. */
export const DEMO_TENANT_ID = '99999999-9999-9999-9999-999999999999';

/** Demo outlet id — the seeded venue used by surfaces that are not yet tenant-scoped. */
export const OUTLET_ID = '11111111-1111-1111-1111-111111111111';
