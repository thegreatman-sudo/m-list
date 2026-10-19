import { useEffect, useState } from 'react';
import {
  Music, Send, Vote, Radio, ListMusic,
} from 'lucide-react';
import { songApi, type SongGuestStatus, type SongQueueEntry } from '@/lib/songRequests';
import { cn } from '@/lib/format';
import { Button, Modal, Spinner } from '@/components/ui';

export function SongRequestPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [status, setStatus] = useState<SongGuestStatus | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [dedication, setDedication] = useState('');
  const [nickname, setNickname] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data, error } = await songApi.guest.status(token);
    if (error) { setErr('Something went wrong. Please try again.'); setLoading(false); return; }
    setStatus(data as unknown as SongGuestStatus);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [token]);

  // Poll every 12s while open so status changes appear live-ish without a
  // direct table subscription (guests don't know the outlet id).
  useEffect(() => {
    const t = setInterval(() => { if (status?.open) load(); }, 12000);
    return () => clearInterval(t);
    /* eslint-disable-line react-hooks/exhaustive-deps */
  }, [token, status?.open]);

  const submit = async () => {
    if (!title.trim() || !artist.trim()) return;
    setSending(true); setErr(null); setMsg(null);
    const { error } = await songApi.guest.submit(token, title.trim(), artist.trim(),
      dedication.trim() || null, nickname.trim() || null);
    setSending(false);
    if (error) setErr(friendly(error.message));
    else { setTitle(''); setArtist(''); setDedication(''); setNickname(''); setMsg('Request sent'); await load(); }
  };

  const vote = async (id: string) => {
    const { error } = await songApi.guest.vote(token, id);
    if (error) setErr(friendly(error.message));
    else await load();
  };

  if (loading) {
    return <Modal open onClose={onClose} title="Request a song"><div className="py-8"><Spinner className="mx-auto" /></div></Modal>;
  }

  if (!status?.enabled) {
    return (
      <Modal open onClose={onClose} title="Request a song">
        <div className="py-8 text-center">
          <Music size={40} className="mx-auto text-ink-500 mb-3" />
          <div className="text-ink-200 font-medium">Song requests aren't available right now</div>
          <div className="text-sm text-ink-400 mt-1">Ask staff if live music is on tonight.</div>
        </div>
      </Modal>
    );
  }

  const my = status.my_request;
  const np = status.now_playing;
  const queue = status.queue ?? [];

  return (
    <Modal open onClose={onClose} title="Request a song">
      {status.intro_text && <p className="text-sm text-ink-300 mb-3">{status.intro_text}</p>}
      {!status.open && (
        <div className="rounded-xl bg-amber2-500/10 border border-amber2-500/30 px-3 py-2 text-xs text-amber2-400 mb-3">
          {status.paused
            ? 'Requests are paused for a moment — please check back soon.'
            : 'Requests are closed right now. Come back during music hours!'}
        </div>
      )}

      {my && (
        <div className="rounded-xl border border-saffron-500/40 bg-saffron-500/10 p-3 mb-4">
          <div className="text-xs text-saffron-400 font-semibold mb-0.5">Your request</div>
          <div className="font-semibold text-sm">{my.title} — {my.artist}</div>
          <div className="text-xs text-ink-300 mt-1">{statusText(my)}</div>
        </div>
      )}

      {np?.title && (
        <div className="rounded-xl bg-ink-700/60 p-3 mb-4">
          <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-0.5">Now playing</div>
          <div className="font-display font-bold">{np.title}</div>
          <div className="text-sm text-ink-300">{np.artist}</div>
        </div>
      )}

      {status.open && !my && (
        <div className="space-y-3 mb-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" maxLength={120}
            className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" />
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" maxLength={120}
            className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" />
          {status.dedication_enabled && (
            <input value={dedication} onChange={(e) => setDedication(e.target.value)} maxLength={100}
              placeholder="Dedication (optional) — e.g. Happy birthday Rina"
              className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" />
          )}
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40}
            placeholder="Your name or nickname (optional)"
            className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" />
          <Button full size="lg" disabled={sending || !title.trim() || !artist.trim()} onClick={submit}>
            {sending ? <Spinner /> : <><Send size={16} /> Send request</>}
          </Button>
        </div>
      )}

      {msg && <div className="rounded-lg bg-emerald2-500/10 border border-emerald2-500/30 px-3 py-2 text-xs text-emerald2-400 mb-3">{msg}</div>}
      {err && <div className="rounded-lg bg-rose2-500/10 border border-rose2-500/30 px-3 py-2 text-xs text-rose2-400 mb-3">{err}</div>}

      <div className="border-t border-ink-600 pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-ink-400 font-semibold">Song queue</div>
          <ListMusic size={14} className="text-ink-400" />
        </div>
        {queue.length === 0 ? (
          <div className="text-sm text-ink-400 py-4 text-center">No songs queued yet — be the first!</div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto df-no-scrollbar">
            {queue.map((q) => <QueueRow key={q.id} q={q} onVote={() => vote(q.id)} />)}
          </div>
        )}
      </div>
    </Modal>
  );
}

function QueueRow({ q, onVote }: { q: SongQueueEntry; onVote: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-ink-700/50 p-2.5">
      <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
        q.status === 'playing' ? 'bg-saffron-600 text-white df-pulse' : 'bg-ink-600 text-ink-300')}>
        {q.status === 'playing' ? <Radio size={14} /> : <Music size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{q.title}</div>
        <div className="text-xs text-ink-400 truncate">{q.artist}{q.nickname ? ` · ${q.nickname}` : ''}</div>
      </div>
      {q.status !== 'playing' && (
        <button onClick={onVote} className="h-8 px-2.5 rounded-lg bg-ink-600 hover:bg-saffron-600/30 text-xs font-medium inline-flex items-center gap-1 shrink-0">
          <Vote size={12} /> {q.votes}
        </button>
      )}
      {q.status === 'playing' && <span className="text-xs text-saffron-400 font-semibold">Playing</span>}
    </div>
  );
}

function statusText(my: NonNullable<SongGuestStatus['my_request']>): string {
  switch (my.status) {
    case 'pending': return 'Pending — waiting for the DJ to approve';
    case 'approved': return 'Approved';
    case 'queued': return my.queue_position ? `In queue (position #${my.queue_position})` : 'In queue';
    case 'playing': return 'Playing now';
    case 'played': return 'Played';
    case 'declined': return my.decline_reason ? `Declined — ${my.decline_reason}` : 'Declined';
    default: return '';
  }
}

function friendly(m: string): string {
  if (m.includes('request again in')) return m;
  if (m.includes('limit for this hour')) return 'Your table has reached its request limit for this hour.';
  if (m.includes('queue is full')) return 'The queue is full right now — please try again later.';
  if (m.includes("can't be accepted") || m.includes("can''t be accepted")) return 'This request cannot be accepted. Please try another song.';
  if (m.includes('required')) return 'Please fill in both the song and the artist.';
  return 'Something went wrong. Please try again.';
}
