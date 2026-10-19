import { useEffect, useState } from 'react';
import type { PostgrestSingleResponse } from '@supabase/postgrest-js';
import { supabase } from '@/lib/supabase';

interface QueryOptions {
  table: string;
  select?: string;
  filter?: Record<string, unknown>;
  eq?: [string, unknown][];
  order?: { column: string; ascending?: boolean };
  single?: boolean;
  /** If provided, re-runs the query when this string changes. */
  deps?: unknown[];
  /** Optional realtime channel table to subscribe to for refetch. */
  realtimeTable?: string;
  /** Optional filter on realtime events. */
  realtimeFilter?: string;
}

export function useQuery<T>(opts: QueryOptions) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIt = async () => {
    setLoading(true);
    let q = supabase.from(opts.table).select(opts.select ?? '*');
    if (opts.eq) {
      for (const [col, val] of opts.eq) q = q.eq(col, val as string);
    }
    if (opts.filter) {
      for (const [k, v] of Object.entries(opts.filter)) q = q.eq(k, v as string);
    }
    if (opts.order) {
      q = q.order(opts.order.column, { ascending: opts.order.ascending ?? true });
    }
    const res = (opts.single ? await q.maybeSingle() : await q) as PostgrestSingleResponse<T>;
    if (res.error) setError(res.error.message);
    else {
      setData(res.data as T);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchIt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.deps ?? []);

  useEffect(() => {
    if (!opts.realtimeTable) return;
    const channel = supabase
      .channel(`q_${opts.table}_${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: opts.realtimeTable,
          filter: opts.realtimeFilter,
        },
        () => fetchIt()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.realtimeTable, opts.realtimeFilter]);

  return { data, loading, error, refetch: fetchIt };
}
