import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Music, Play, Check, X, ChevronUp, ChevronDown, SkipForward, Trash2,
  Volume2, VolumeX, PauseCircle, PlayCircle, Clock, Heart,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { songApi, type SongStaffList, type SongStaffRow } from '@/lib/songRequests';
import { cn, formatDuration } from '@/lib/format';
import { Button, Spinner, Badge } from '@/components/ui';

const QUICK_REASONS = ['not appropriate', 'already played', "can't play it", 'not available'];

export function DJApp() {
  const { profile, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [data, setData] = useState<SongStaffList | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [sortBy, setSortBy] = useState<'oldest' | 'votes' | 'manual'>('oldest');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showDecline, setShowDecline] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.tenant_id) setTenantId(profile.tenant_id);
  }, [profile?.tenant_id]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('outlets').select('id').eq('tenant_id', tenantId).limit(1).maybeSingle()
      .then(({ data: o }) => { if (o) setOutletId(o.id); });
  }, [tenantId]);

  const refresh = async () => {
    if (!outletId) return;
    const { data: d, error } = await songApi.staff.list(outletId);
    if (error) { setErr(error.message); setLoading(false); return; }
    setData(d as unknown as SongStaffList);
    setLoading(false);
  };

  useEffect(() => {
    if (!outletId) return;
    refresh();
    const ch = supabase
      .channel(`dj_${outletId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'song_requests', filter: `outlet_id=eq.${outletId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dj_now_playing', filter: `outlet_id=eq.${outletId}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [outletId, sortBy]);

  // New-request sound + flash
  const [lastPendingCount, setLastPendingCount] = useState(0);
  useEffect(() => {
    if (!data) return;
    const n = data.pending.length;
    if (n > lastPendingCount && lastPendingCount >= 0 && !muted) {
      try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 880; g.gain.value = 0.1;
        o.start(); o.stop(ctx.currentTime + 0.25);
        setTimeout(() => ctx.close(), 400);
        document.title = '♪ New request — MenuList';
      } catch { /* audio unavailable */ }
    }
    setLastPendingCount(n);
    if (n === 0) document.title = 'DJ — MenuList';
  }, [data?.pending.length, muted, lastPendingCount]);

  const act = async (id: string, action: string, reason: string | null = null) => {
    setBusyId(id);
    const { error } = await songApi.staff.action(id, action, reason);
    setBusyId(null);
    if (error) setErr(error.message);
    else await refresh();
  };

  const reorder = async (id: string, dir: 'up' | 'down') => {
    setBusyId(id);
    const { error } = await songApi.staff.reorder(id, dir);
    setBusyId(null);
    if (error) setErr(error.message);
    else await refresh();
  };

  if (authLoading || (loading && !data)) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900 text-ink-100 p-6">
        <div className="text-center">
          <Music size={48} className="mx-auto text-saffron-400 mb-4" />
          <h1 className="font-display text-2xl font-bold">DJ screen</h1>
          <p className="text-ink-300 mt-2 mb-6 text-sm max-w-sm">Sign in with a DJ, Manager, or Owner account to run the song queue.</p>
          <Button onClick={() => navigate('/login?next=%2Fdj')}>Sign in</Button>
        </div>
      </div>
    );
  }

  if (err && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900 text-ink-100 p-6">
        <div className="text-center max-w-md">
          <Music size={40} className="mx-auto text-rose2-400 mb-3" />
          <div className="font-semibold">Couldn't load the queue</div>
          <div className="text-sm text-ink-400 mt-1">{err}</div>
          <Button className="mt-4" onClick={refresh}>Retry</Button>
        </div>
      </div>
    );
  }

  const pending = data?.pending ?? [];
  const queue = data?.queue ?? [];
  const np = data?.now_playing;

  const sortedQueue = [...queue].sort((a, b) => {
    if (sortBy === 'votes') return b.votes - a.votes;
    if (sortBy === 'oldest') return new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime();
    return (a.queue_position ?? 0) - (b.queue_position ?? 0);
  });

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      {/* Top bar */}
      <div className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-3">
          <Music size={22} className="text-saffron-400" />
          <div className="font-display font-bold text-lg">DJ Queue</div>
          {pending.length > 0 && (
            <span className="rounded-full bg-rose2-500/20 text-rose2-300 border border-rose2-500/40 px-2.5 py-0.5 text-xs font-bold df-pulse">
              {pending.length} pending
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setMuted((m) => !m)} className="h-10 w-10 rounded-xl border border-ink-600 flex items-center justify-center hover:bg-ink-800" aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <button onClick={() => songApi.staff.pause(outletId!, !(data?.settings?.paused ?? false)).then(refresh)}
              className={cn('h-10 px-3 rounded-xl border text-sm font-medium inline-flex items-center gap-1.5',
                data?.settings?.paused ? 'border-emerald2-500/50 text-emerald2-400 bg-emerald2-500/10' : 'border-ink-600 hover:bg-ink-800')}>
              {data?.settings?.paused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
              {data?.settings?.paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Main column */}
        <div className="space-y-6">
          {/* Now playing */}
          <div className="rounded-2xl border border-saffron-500/30 bg-gradient-to-br from-saffron-600/15 to-ink-800 p-6">
            <div className="text-xs uppercase tracking-wider text-saffron-400 font-semibold mb-2">Now playing</div>
            {np?.title ? (
              <>
                <div className="font-display text-3xl font-bold leading-tight">{np.title}</div>
                <div className="text-ink-300 text-lg mt-1">{np.artist}</div>
                {np.dedication && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-ink-900/60 border border-ink-600 px-3 py-1.5 text-sm">
                    <Heart size={14} className="text-rose2-400" />
                    {np.dedication}
                    {np.dedication_table_label && <span className="text-ink-400">· {np.dedication_table_label}</span>}
                  </div>
                )}
                <div className="mt-4 text-xs text-ink-400">Set {np.set_at ? new Date(np.set_at).toLocaleTimeString() : ''}</div>
              </>
            ) : (
              <div className="text-ink-400">Nothing marked as playing. Pick a song from the queue.</div>
            )}
          </div>

          {/* Pending approvals */}
          {pending.length > 0 && (
            <div>
              <h2 className="font-display font-semibold text-lg mb-3">Needs approval ({pending.length})</h2>
              <div className="space-y-3">
                {pending.map((r) => (
                  <RequestCard key={r.id} r={r} busy={busyId === r.id}
                    onApprove={() => act(r.id, 'approve')}
                    onDecline={(reason) => act(r.id, 'decline', reason)} />
                ))}
              </div>
            </div>
          )}

          {/* Queue */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-semibold text-lg">Queue ({queue.length})</h2>
              <div className="flex gap-1">
                {(['oldest', 'votes', 'manual'] as const).map((s) => (
                  <button key={s} onClick={() => setSortBy(s)}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium capitalize',
                      sortBy === s ? 'bg-saffron-600 text-white' : 'bg-ink-800 text-ink-300 hover:bg-ink-700')}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {queue.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-ink-600 p-10 text-center text-ink-400 text-sm">
                Queue is empty. Approved requests appear here.
              </div>
            ) : (
              <div className="space-y-3">
                {sortedQueue.map((r, i) => (
                  <div key={r.id} className="rounded-2xl border border-ink-600 bg-ink-800 p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-ink-700 flex items-center justify-center font-display font-bold text-saffron-400 shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold leading-tight truncate">{r.title}</div>
                        <div className="text-sm text-ink-400 truncate">{r.artist}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                          {r.table_label && <span>{r.table_label}</span>}
                          {r.area && <span>· {r.area}</span>}
                          <span>· <Heart size={10} className="inline text-rose2-400" /> {r.votes}</span>
                          <span>· {formatDuration(Math.floor((Date.now() - new Date(r.requested_at).getTime()) / 1000))} ago</span>
                          {r.paid && <Badge className="bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30">paid</Badge>}
                          {r.boost && <Badge className="bg-amber2-500/15 text-amber2-400 border-amber2-500/30">boost</Badge>}
                        </div>
                        {r.dedication && <div className="mt-2 text-sm text-amber2-300">"{r.dedication}"</div>}
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button disabled={busyId === r.id} onClick={() => act(r.id, 'play')}
                          className="h-11 px-4 rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white font-semibold inline-flex items-center gap-1.5 text-sm disabled:opacity-50">
                          <Play size={15} /> Play
                        </button>
                        <div className="flex gap-1.5">
                          <button disabled={busyId === r.id} onClick={() => reorder(r.id, 'up')} aria-label="Move up"
                            className="h-9 w-9 rounded-lg border border-ink-600 flex items-center justify-center hover:bg-ink-700 disabled:opacity-50">
                            <ChevronUp size={15} />
                          </button>
                          <button disabled={busyId === r.id} onClick={() => reorder(r.id, 'down')} aria-label="Move down"
                            className="h-9 w-9 rounded-lg border border-ink-600 flex items-center justify-center hover:bg-ink-700 disabled:opacity-50">
                            <ChevronDown size={15} />
                          </button>
                          <button disabled={busyId === r.id} onClick={() => act(r.id, 'skip')} aria-label="Skip"
                            className="h-9 w-9 rounded-lg border border-ink-600 flex items-center justify-center hover:bg-ink-700 disabled:opacity-50">
                            <SkipForward size={15} />
                          </button>
                          <button disabled={busyId === r.id} onClick={() => act(r.id, 'decline', 'removed by DJ')} aria-label="Remove"
                            className="h-9 w-9 rounded-lg border border-ink-600 flex items-center justify-center hover:bg-rose2-500/20 text-rose2-400 disabled:opacity-50">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-ink-600 bg-ink-800 p-4">
            <div className="text-xs uppercase tracking-wider text-ink-400 font-semibold mb-2">Session</div>
            <div className="text-sm text-ink-300">{session.user.email ?? 'Signed in'}</div>
            <div className="text-xs text-ink-500 mt-1 capitalize">{profile?.role}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RequestCard({ r, busy, onApprove, onDecline }: {
  r: SongStaffRow; busy: boolean;
  onApprove: () => void; onDecline: (reason: string | null) => void;
}) {
  const [showReasons, setShowReasons] = useState(false);
  return (
    <div className="rounded-2xl border border-amber2-500/40 bg-amber2-500/5 p-4">
      <div className="flex items-start gap-3">
        <Clock size={20} className="text-amber2-400 mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold leading-tight">{r.title}</div>
          <div className="text-sm text-ink-400">{r.artist}</div>
          <div className="mt-1 text-xs text-ink-400">
            {r.table_label}{r.area ? ` · ${r.area}` : ''} · {r.votes} votes
          </div>
          {r.dedication && <div className="mt-2 text-sm text-amber2-300">"{r.dedication}"</div>}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button disabled={busy} onClick={onApprove}
            className="h-10 px-3 rounded-xl bg-emerald2-600 hover:bg-emerald2-500 text-white font-semibold inline-flex items-center gap-1 text-sm disabled:opacity-50">
            <Check size={15} /> Approve
          </button>
          <button disabled={busy} onClick={() => setShowReasons((s) => !s)}
            className="h-10 px-3 rounded-xl border border-ink-500 hover:bg-ink-700 font-medium inline-flex items-center gap-1 text-sm disabled:opacity-50">
            <X size={15} /> Decline
          </button>
        </div>
      </div>
      {showReasons && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-600 pt-3">
          {QUICK_REASONS.map((reason) => (
            <button key={reason} disabled={busy} onClick={() => { onDecline(reason); setShowReasons(false); }}
              className="px-3 py-1.5 rounded-lg bg-ink-700 hover:bg-ink-600 text-xs capitalize disabled:opacity-50">
              {reason}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
