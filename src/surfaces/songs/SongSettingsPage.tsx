import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Music, ToggleLeft, ToggleRight, Plus, X, Save, ChevronLeft, Clock, PauseCircle, PlayCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';import { supabase } from '@/lib/supabase';
import { songApi, type SongSettings } from '@/lib/songRequests';
import { cn } from '@/lib/format';
import { Button, Spinner, Badge } from '@/components/ui';

const DAYS = ['mon','tue','wed','thu','fri','sat','sun'] as const;
const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

export function SongSettingsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [settings, setSettings] = useState<SongSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newWord, setNewWord] = useState('');

  useEffect(() => {
    if (!profile?.tenant_id) return;
    setTenantId(profile.tenant_id);
    supabase.from('outlets').select('id').eq('tenant_id', profile.tenant_id).limit(1).maybeSingle()
      .then(({ data: o }) => { if (o) setOutletId(o.id); });
    supabase.from('areas').select('id, name').eq('tenant_id', profile.tenant_id).is('archived_at', null)
      .then(({ data: a }) => setAreas((a as { id: string; name: string }[]) ?? []));
  }, [profile?.tenant_id]);

  useEffect(() => {
    if (!outletId) return;
    songApi.staff.list(outletId).then(({ data, error }) => {
      if (error) { setErr(error.message); setLoading(false); return; }
      const d = data as unknown as SongSettings & { settings: SongSettings };
      setSettings(d.settings ?? null);
      setLoading(false);
    });
  }, [outletId]);

  const update = (patch: Partial<SongSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
  };

  const save = async () => {
    if (!outletId || !settings) return;
    setSaving(true); setMsg(null); setErr(null);
    const { error } = await songApi.staff.updateSettings(outletId, settings);
    setSaving(false);
    if (error) setErr(error.message);
    else setMsg('Saved');
  };

  const toggle = (on: boolean) => {
    if (!settings) return;
    update({ enabled: on });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }

  const isManager = profile?.role === 'owner' || profile?.role === 'manager';
  if (!isManager) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-950 text-ink-100 p-6">
        <div className="text-center">
          <Music size={40} className="mx-auto text-rose2-400 mb-3" />
          <div className="font-semibold">Owner or Manager access required</div>
        </div>
      </div>
    );
  }

  const s = settings ?? ({} as SongSettings);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <button onClick={() => navigate(-1)} className="text-sm text-ink-300 hover:text-ink-100 inline-flex items-center gap-1 mb-6">
          <ChevronLeft size={16} className="rotate-180" /> Back
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-xl bg-saffron-600/20 border border-saffron-500/30 flex items-center justify-center">
            <Music size={22} className="text-saffron-400" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">Song Requests</h1>
            <div className="text-sm text-ink-400">Guests request songs from the table QR page.</div>
          </div>
        </div>

        {err && <div className="rounded-xl bg-rose2-500/10 border border-rose2-500/30 px-4 py-3 text-sm text-rose2-400 mb-4">{err}</div>}
        {msg && <div className="rounded-xl bg-emerald2-500/10 border border-emerald2-500/30 px-4 py-3 text-sm text-emerald2-400 mb-4">{msg}</div>}

        {/* Master toggle */}
        <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 mb-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-semibold">Enable song requests</div>
              <div className="text-sm text-ink-400">When off, everything song-related is hidden from guests and staff.</div>
            </div>
            <button onClick={() => toggle(!s.enabled)} className="shrink-0" aria-label="Toggle song requests">
              {s.enabled ? <ToggleRight size={44} className="text-emerald2-400" /> : <ToggleLeft size={44} className="text-ink-500" />}
            </button>
          </div>
        </div>

        {s.enabled && (
          <>
            {/* Areas */}
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 mb-5">
              <div className="font-semibold mb-1">Areas</div>
              <div className="text-sm text-ink-400 mb-3">Leave all unchecked for every area. Only checked areas accept requests.</div>
              <div className="flex flex-wrap gap-2">
                {areas.map((a) => {
                  const on = s.area_ids.includes(a.id);
                  return (
                    <button key={a.id}
                      onClick={() => update({ area_ids: on ? s.area_ids.filter((x) => x !== a.id) : [...s.area_ids, a.id] })}
                      className={cn('px-3 py-1.5 rounded-full text-sm border', on ? 'bg-saffron-500/15 border-saffron-500/40 text-saffron-400' : 'border-ink-600 text-ink-300 hover:bg-ink-700')}>
                      {a.name}
                    </button>
                  );
                })}
                {areas.length === 0 && <span className="text-sm text-ink-500">No areas set up yet.</span>}
                <span className="text-xs text-ink-500 self-center">Empty = all areas</span>
              </div>
            </div>

            {/* Schedule */}
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={16} className="text-saffron-400" />
                <div className="font-semibold">Music schedule</div>
                <button onClick={() => songApi.staff.pause(outletId!, !s.paused).then(() => update({ paused: !s.paused }))}
                  className={cn('ml-auto h-9 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5',
                    s.paused ? 'border-emerald2-500/50 text-emerald2-400 bg-emerald2-5/10' : 'border-ink-600 hover:bg-ink-700')}>
                  {s.paused ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
                  {s.paused ? 'Resume requests' : 'Pause requests'}
                </button>
              </div>
              <div className="space-y-2">
                {DAYS.map((d) => {
                  const windows = s.schedule?.[d] ?? [];
                  return (
                    <div key={d} className="flex items-center gap-2">
                      <span className="w-10 text-sm text-ink-300">{DAY_LABELS[d]}</span>
                      <input
                        value={windows.join(', ') || ''}
                        placeholder="e.g. 18:00-23:00 (empty = closed)"
                        onChange={(e) => {
                          const parts = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
                          update({ schedule: { ...s.schedule, [d]: parts } });
                        }}
                        className="flex-1 h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Limits */}
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 mb-5">
              <div className="font-semibold mb-3">Limits</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField label="Max requests per table per hour" value={s.max_per_table_per_hour} min={1} max={20}
                  onChange={(v) => update({ max_per_table_per_hour: Number(v) })} />
                <NumberField label="Max pending in queue" value={s.max_queue} min={1} max={200}
                  onChange={(v) => update({ max_queue: Number(v) })} />
                <NumberField label="Min seconds between requests (same table)" value={s.min_seconds_between} min={0} max={3600}
                  onChange={(v) => update({ min_seconds_between: Number(v) })} />
                <NumberField label="Max song length (seconds, empty = no filter)" value={s.max_song_length_seconds ?? ''} min={0} max={1200}
                  onChange={(v) => update({ max_song_length_seconds: v === '' || v === null ? null : Number(v) })} />
              </div>
            </div>

            {/* Moderation */}
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 mb-5">
              <div className="font-semibold mb-3">Moderation</div>
              <div className="grid gap-2 sm:grid-cols-2 mb-4">
                <button onClick={() => update({ moderation: 'auto' })}
                  className={cn('rounded-xl border p-3 text-sm text-left', s.moderation === 'auto' ? 'border-saffron-500/50 bg-saffron-500/10' : 'border-ink-600 hover:bg-ink-700')}>
                  <div className="font-medium">Auto-accept</div>
                  <div className="text-xs text-ink-400">Requests go straight into the queue.</div>
                </button>
                <button onClick={() => update({ moderation: 'approval' })}
                  className={cn('rounded-xl border p-3 text-sm text-left', s.moderation === 'approval' ? 'border-saffron-500/50 bg-saffron-500/10' : 'border-ink-600 hover:bg-ink-700')}>
                  <div className="font-medium">Needs approval</div>
                  <div className="text-xs text-ink-400">DJ or manager approves each request first.</div>
                </button>
              </div>
              <div className="font-medium text-sm mb-2">Blocked words</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(s.blocked_words ?? []).map((w) => (
                  <span key={w} className="inline-flex items-center gap-1 rounded-full bg-rose2-500/10 text-rose2-300 border border-rose2-500/30 px-2.5 py-1 text-xs">
                    {w}
                    <button onClick={() => update({ blocked_words: s.blocked_words.filter((x) => x !== w) })}><X size={12} /></button>
                  </span>
                ))}
                {(s.blocked_words ?? []).length === 0 && <span className="text-xs text-ink-500">None</span>}
              </div>
              <div className="flex gap-2">
                <input value={newWord} onChange={(e) => setNewWord(e.target.value)}
                  placeholder="Add a word to block"
                  className="flex-1 h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" />
                <button onClick={() => { if (newWord.trim()) { update({ blocked_words: [...(s.blocked_words ?? []), newWord.trim().toLowerCase()] }); setNewWord(''); } }}
                  className="h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 hover:bg-ink-600 inline-flex items-center">
                  <Plus size={16} />
                </button>
                <Button size="sm" onClick={() => songApi.staff.blockedTerm(tenantId!, 'word', newWord.trim(), true)}>Add to list</Button>
                <Button size="sm" variant="secondary" onClick={() => songApi.staff.blockedTerm(tenantId!, 'word', newWord.trim(), false)}>Remove</Button>
              </div>
            </div>

            {/* Messages */}
            <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 mb-5">
              <div className="font-semibold mb-3">Messages</div>
              <label className="block text-sm text-ink-300 mb-1">Intro text on the guest request page</label>
              <input value={s.intro_text} onChange={(e) => update({ intro_text: e.target.value })} maxLength={200}
                placeholder="Request a song for our DJ tonight!"
                className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none mb-3" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.dedication_enabled} onChange={(e) => update({ dedication_enabled: e.target.checked })}
                  className="h-4 w-4 accent-saffron-600" />
                Allow guests to add a dedication message
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pb-10">
              <Button size="lg" disabled={saving} onClick={save}>
                {saving ? <Spinner /> : <><Save size={16} /> Save settings</>}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number | string; min: number; max: number; onChange: (v: number | string) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-ink-300 mb-1">{label}</label>
      <input type="number" value={value ?? ''} min={min} max={max}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none" />
    </div>
  );
}
