import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Users, Check,
  AlertTriangle, Phone,
} from 'lucide-react';
import { supabase, OUTLET_ID } from '@/lib/supabase';
import type { Area, Reservation, RestaurantTable } from '@/types';
import { cn, todayISO } from '@/lib/format';
import { Button, Modal, Badge, Spinner, EmptyState } from '@/components/ui';

export function ReservationsApp() {
  const [tab, setTab] = useState<'book' | 'new'>('book');
  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-14 z-30 border-b border-ink-600 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto max-w-[1100px] px-4 py-3 flex items-center gap-3">
          <CalendarDays size={20} className="text-amber2-400" />
          <h1 className="font-display font-bold text-lg">Reservations</h1>
          <div className="ml-auto flex gap-1 bg-ink-800 border border-ink-600 rounded-xl p-1">
            <button
              onClick={() => setTab('book')}
              className={cn('px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors', tab === 'book' ? 'bg-ink-600 text-ink-100' : 'text-ink-400')}
            >
              Reservation book
            </button>
            <button
              onClick={() => setTab('new')}
              className={cn('px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors', tab === 'new' ? 'bg-ink-600 text-ink-100' : 'text-ink-400')}
            >
              Book a table
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1100px] px-4 py-5">
        {tab === 'book' ? <ReservationBook /> : <BookingWidget />}
      </div>
    </div>
  );
}

const SLOTS = ['11:00', '12:00', '13:00', '14:00', '18:00', '19:00', '20:00', '21:00'];

function BookingWidget() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState<string>('');
  const [partySize, setPartySize] = useState(2);
  const [areaPref, setAreaPref] = useState<string>('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('tables').select('*').eq('outlet_id', OUTLET_ID).then(({ data }) => setTables((data as RestaurantTable[]) ?? []));
    supabase.from('areas').select('*').eq('outlet_id', OUTLET_ID).is('archived_at', null).order('sort_order').then(({ data }) => setAreas((data as Area[]) ?? []));
  }, []);

  useEffect(() => {
    supabase
      .from('reservations')
      .select('*')
      .eq('outlet_id', OUTLET_ID)
      .eq('booking_date', date)
      .then(({ data }) => setReservations((data as Reservation[]) ?? []));
  }, [date]);

  const slotAvailable = (slot: string): boolean => {
    const taken = reservations.filter(
      (r) => r.booking_time === slot && !['cancelled', 'no_show'].includes(r.status)
    );
    return tables.length > 0 && taken.length < tables.filter((t) => t.max_seats >= partySize).length;
  };

  const submit = async () => {
    setError(null);
    if (!time || !name.trim()) {
      setError('Pick a time and enter your name.');
      return;
    }
    setSubmitting(true);
    // Find best-fit free table
    const takenTableIds = new Set(
      reservations
        .filter((r) => r.booking_time === time && !['cancelled', 'no_show'].includes(r.status))
        .map((r) => r.table_id)
    );
    const candidates = tables.filter(
      (t) =>
        !takenTableIds.has(t.id) &&
        t.max_seats >= partySize &&
        (!areaPref || areas.find((a) => a.id === t.area_id)?.name === areaPref)
    );
    const best = candidates.sort((a, b) => a.max_seats - b.max_seats)[0];
    if (!best) {
      setSubmitting(false);
      setError('No table available for that time and area — try another slot.');
      return;
    }
    const { data, error: err } = await supabase
      .from('reservations')
      .insert({
        outlet_id: OUTLET_ID,
        table_id: best.id,
        guest_name: name.trim(),
        guest_phone: phone.trim() || null,
        party_size: partySize,
        area_preference: areaPref || null,
        booking_date: date,
        booking_time: time,
        status: 'confirmed',
        notes: notes.trim() || null,
      })
      .select('*')
      .single();
    setSubmitting(false);
    if (err) setError(err.message);
    else setDone(data as Reservation);
  };

  if (done) {
    return (
      <div className="max-w-md mx-auto py-16 text-center df-slide-up">
        <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-emerald2-500/15 text-emerald2-400 flex items-center justify-center">
          <Check size={28} />
        </div>
        <h2 className="font-display text-2xl font-bold">Table confirmed</h2>
        <p className="mt-2 text-ink-300">
          {done.guest_name} · party of {done.party_size}
        </p>
        <p className="text-ink-400 text-sm mt-1">
          {done.booking_date} at {done.booking_time.slice(0, 5)}
        </p>
        <p className="text-sm text-ink-400 mt-3">
          A confirmation with a manage link would be sent by email or WhatsApp. Reminders go out 24 hours and 2 hours before.
        </p>
        <Button
          className="mt-6"
          variant="secondary"
          onClick={() => {
            setDone(null);
            setTime('');
            setName('');
            setPhone('');
            setNotes('');
          }}
        >
          Make another booking
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-6 space-y-5">
        <div>
          <div className="text-sm font-medium mb-2">Party size</div>
          <div className="flex gap-1.5 flex-wrap">
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <button key={n} onClick={() => setPartySize(n)} className={cn('h-10 w-10 rounded-lg text-sm font-semibold border transition-colors', partySize === n ? 'bg-amber2-500/15 border-amber2-500/40 text-amber2-400' : 'border-ink-600 text-ink-300 hover:bg-ink-700')}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Date</div>
          <input
            type="date"
            value={date}
            min={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-amber2-500 focus:outline-none"
          />
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Time</div>
          <div className="grid grid-cols-4 gap-1.5">
            {SLOTS.map((slot) => {
              const ok = slotAvailable(slot);
              return (
                <button
                  key={slot}
                  disabled={!ok}
                  onClick={() => setTime(slot)}
                  className={cn(
                    'h-11 rounded-xl text-sm font-semibold border transition-colors',
                    time === slot ? 'bg-amber2-500/15 border-amber2-500/40 text-amber2-400' : ok ? 'border-ink-600 text-ink-200 hover:bg-ink-700' : 'border-ink-700 text-ink-500 line-through opacity-50'
                  )}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Area preference (optional)</div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setAreaPref('')} className={cn('px-3.5 py-2 rounded-lg text-xs font-semibold border', areaPref === '' ? 'bg-amber2-500/15 border-amber2-500/40 text-amber2-400' : 'border-ink-600 text-ink-300')}>No preference</button>
            {areas.map((a) => (
              <button key={a.id} onClick={() => setAreaPref(a.name)} className={cn('px-3.5 py-2 rounded-lg text-xs font-semibold border', areaPref === a.name ? 'bg-amber2-500/15 border-amber2-500/40 text-amber2-400' : 'border-ink-600 text-ink-300')}>{a.name}</button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <div className="text-sm font-medium mb-2">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-amber2-500 focus:outline-none"
            />
          </div>
          <div>
            <div className="text-sm font-medium mb-2">Phone (optional)</div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+62 ..."
              className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-amber2-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Birthday, high chair, allergies…"
            rows={2}
            className="w-full rounded-xl bg-ink-700 border border-ink-600 p-3 text-sm resize-none focus:border-amber2-500 focus:outline-none"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-rose2-500/10 border border-rose2-500/30 px-3 py-2 text-xs text-rose2-400 inline-flex items-center gap-1.5">
            <AlertTriangle size={12} /> {error}
          </div>
        )}

        <Button full size="lg" onClick={submit} disabled={submitting}>
          {submitting ? <Spinner /> : 'Reserve table'}
        </Button>
      </div>
    </div>
  );
}

function ReservationBook() {
  const [date, setDate] = useState(todayISO());
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Reservation | null>(null);

  const load = useCallback(async () => {
    const [r, t] = await Promise.all([
      supabase.from('reservations').select('*').eq('outlet_id', OUTLET_ID).eq('booking_date', date).order('booking_time'),
      supabase.from('tables').select('*').eq('outlet_id', OUTLET_ID).order('label'),
    ]);
    setReservations((r.data as Reservation[]) ?? []);
    setTables((t.data as RestaurantTable[]) ?? []);
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel('resv_book')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const setStatus = async (r: Reservation, status: Reservation['status']) => {
    await supabase.from('reservations').update({ status, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (status === 'seated' && r.table_id) {
      await supabase.from('tables').update({ status: 'occupied', updated_at: new Date().toISOString() }).eq('id', r.table_id);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of reservations) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [reservations]);

  if (loading) {
    return <div className="py-24 text-center"><Spinner className="h-8 w-8" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-10 px-3 rounded-xl bg-ink-800 border border-ink-600 text-sm focus:border-amber2-500 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(['confirmed', 'arrived', 'seated', 'completed', 'cancelled', 'no_show'] as const).map((s) =>
            counts[s] ? (
              <span key={s} className="rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-ink-200">
                {counts[s]} {s.replace('_', ' ')}
              </span>
            ) : null
          )}
          <span className="rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-ink-200">
            {reservations.reduce((s, r) => s + r.party_size, 0)} covers
          </span>
        </div>
      </div>

      {reservations.length === 0 ? (
        <EmptyState icon={<CalendarDays size={44} />} title="No bookings for this day" hint="Guests can book from the website, or staff can create walk-in bookings." />
      ) : (
        <div className="space-y-2">
          {reservations.map((r) => (
            <div key={r.id} className="rounded-2xl border border-ink-600 bg-ink-800 p-4 flex flex-wrap items-center gap-3">
              <div className="text-center w-14 shrink-0">
                <div className="font-mono font-bold text-sm">{r.booking_time.slice(0, 5)}</div>
                <div className="text-[10px] text-ink-400">{r.duration_minutes}m</div>
              </div>
              <div className="flex-1 min-w-[160px]">
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  {r.guest_name}
                  <span className="inline-flex items-center gap-0.5 text-xs text-ink-400 font-normal">
                    <Users size={10} /> {r.party_size}
                  </span>
                  {r.tags.includes('VIP') && <Badge className="bg-saffron-500/15 text-saffron-400 border-saffron-500/30">VIP</Badge>}
                </div>
                <div className="text-xs text-ink-400">
                  {r.table_id ? tables.find((t) => t.id === r.table_id)?.label ?? '—' : 'Unassigned'}
                  {r.area_preference ? ` · prefers ${r.area_preference}` : ''}
                  {r.notes ? ` · "${r.notes}"` : ''}
                </div>
              </div>
              <Badge className={statusChip(r.status)}>{r.status.replace('_', '-')}</Badge>
              <div className="flex flex-wrap gap-1.5">
                {r.status === 'confirmed' && (
                  <Button size="sm" onClick={() => setStatus(r, 'arrived')}>Arrived</Button>
                )}
                {r.status === 'arrived' && (
                  <Button size="sm" onClick={() => setStatus(r, 'seated')}>Seat</Button>
                )}
                {r.status === 'seated' && (
                  <Button size="sm" variant="secondary" onClick={() => setStatus(r, 'completed')}>Complete</Button>
                )}
                {['confirmed', 'arrived'].includes(r.status) && (
                  <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'no_show')}>No-show</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  <Phone size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Guest details">
        {editing && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-ink-700/60 p-4 space-y-1.5">
              <div className="flex justify-between"><span className="text-ink-400">Guest</span><span>{editing.guest_name}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">Party</span><span>{editing.party_size}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">Slot</span><span>{editing.booking_time.slice(0, 5)}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">Phone</span><span>{editing.guest_phone ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-ink-400">Notes</span><span>{editing.notes ?? '—'}</span></div>
            </div>
            <p className="text-xs text-ink-400">
              In the full product you can drag this booking to another table or time, add tags
              (VIP, regular), link it to a CRM profile and message the guest.
            </p>
            <Button variant="secondary" full onClick={() => setEditing(null)}>Close</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function statusChip(status: string): string {
  switch (status) {
    case 'pending': return 'bg-amber2-500/15 text-amber2-400 border-amber2-500/30';
    case 'confirmed': return 'bg-sky2-500/15 text-sky2-400 border-sky2-500/30';
    case 'arrived': return 'bg-saffron-500/15 text-saffron-400 border-saffron-500/30';
    case 'seated': return 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30';
    case 'completed': return 'bg-ink-500/30 text-ink-200 border-ink-500/40';
    default: return 'bg-rose2-500/15 text-rose2-400 border-rose2-500/30';
  }
}
