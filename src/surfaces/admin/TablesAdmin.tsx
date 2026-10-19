import { useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { APP_DOMAIN } from '@/config/brand';
import type { Area, RestaurantTable } from '@/types';
import { cn } from '@/lib/format';
import { Button, Modal, Badge, Spinner } from '@/components/ui';
import { QRCode } from '@/components/QRCode';

interface Props {
  areas: Area[];
  tables: RestaurantTable[];
  reload: () => void;
}

export function TablesAdmin({ areas, tables, reload }: Props) {
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [minSeats, setMinSeats] = useState(2);
  const [maxSeats, setMaxSeats] = useState(4);
  const [shape, setShape] = useState<RestaurantTable['shape']>('round');
  const [pin, setPin] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RestaurantTable | null>(null);

  const outletId = areas[0]?.outlet_id;
  const currentArea = areas.find((a) => a.id === areaId) ?? areas[0];
  const areaTables = tables.filter((t) => t.area_id === areaId);

  const addTable = async () => {
    if (!label.trim() || !outletId || !currentArea) return;
    setAdding(true);
    setError(null);
    const { error: err } = await supabase.from('tables').insert({
      area_id: currentArea.id,
      outlet_id: outletId,
      label: label.trim(),
      min_seats: minSeats,
      max_seats: maxSeats,
      shape,
      pin: pin.trim() || null,
      pos_x: 40 + (areaTables.length % 4) * 120,
      pos_y: 40 + Math.floor(areaTables.length / 4) * 120,
    });
    setAdding(false);
    if (err) setError(err.message);
    else {
      setLabel('');
      setPin('');
      reload();
    }
  };

  const regenerateToken = async (t: RestaurantTable) => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(9)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await supabase.from('tables').update({ qr_token: token }).eq('id', t.id);
    reload();
  };

  const deleteTable = async (t: RestaurantTable) => {
    await supabase.from('tables').delete().eq('id', t.id);
    setDetail(null);
    reload();
  };

  if (areas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-600 p-8 text-center text-sm text-ink-400">
        Create an area first on the Floor plan tab.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add form */}
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold">Add tables</h2>
          <Badge className="bg-ink-600 text-ink-200 border-ink-500">{tables.length} total</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="text-xs text-ink-400 block mb-1">Area</label>
            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:outline-none"
            >
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-400 block mb-1">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="T6"
              className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-ink-400 block mb-1">Seats (min–max)</label>
            <div className="flex gap-1.5">
              <input
                type="number"
                min={1}
                value={minSeats}
                onChange={(e) => setMinSeats(Number(e.target.value) || 1)}
                className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:outline-none"
              />
              <input
                type="number"
                min={1}
                value={maxSeats}
                onChange={(e) => setMaxSeats(Number(e.target.value) || 1)}
                className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-ink-400 block mb-1">Shape</label>
            <div className="flex gap-1.5">
              {(['round', 'square', 'rect'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setShape(s)}
                  className={cn('flex-1 h-10 rounded-xl text-xs font-semibold border capitalize', shape === s ? 'bg-saffron-500/15 border-saffron-500/40 text-saffron-400' : 'border-ink-600 text-ink-300')}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="text-xs text-ink-400 block mb-1">Table PIN (optional anti-abuse)</label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="e.g. 4821"
              maxLength={6}
              className="w-40 h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
            />
          </div>
          <Button onClick={addTable} disabled={adding} className="self-end">
            {adding ? <Spinner /> : <Plus size={15} />} Add table
          </Button>
        </div>
        {error && <div className="text-xs text-rose2-400">{error}</div>}
      </div>

      {/* Table list */}
      {currentArea && (
        <div>
          <h2 className="font-display font-semibold mb-3">Tables in {currentArea.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {areaTables.map((t) => (
              <button
                key={t.id}
                onClick={() => setDetail(t)}
                className="rounded-2xl border border-ink-600 bg-ink-800 p-4 text-left hover:border-saffron-500/40 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="font-display font-bold text-lg">{t.label}</div>
                  <Badge className="bg-ink-600 text-ink-200 border-ink-500">{t.min_seats}–{t.max_seats} seats</Badge>
                </div>
                <div className="mt-1 text-xs text-ink-400 capitalize">{t.shape} · token …{t.qr_token.slice(-6)}{t.pin ? ` · PIN set` : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Table ${detail.label}` : ''}>
        {detail && (
          <div className="space-y-5">
            <div className="flex justify-center bg-white rounded-xl p-3">
              <QRCode value={`https://${APP_DOMAIN}/t/${detail.qr_token}`} size={180} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Detail label="Area" value={areas.find((a) => a.id === detail.area_id)?.name ?? '—'} />
              <Detail label="Seats" value={`${detail.min_seats}–${detail.max_seats}`} />
              <Detail label="Status" value={detail.status.replace('_', ' ')} />
              <Detail label="Table PIN" value={detail.pin ?? 'Not set'} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => regenerateToken(detail)}>
                <RefreshCw size={14} /> Regenerate token
              </Button>
              <Button variant="danger" onClick={() => deleteTable(detail)}>
                <Trash2 size={14} /> Delete table
              </Button>
            </div>
            <p className="text-xs text-ink-400">
              Regenerating the token immediately invalidates the old QR code — use this if a code is lost or abused.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-700/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-0.5 capitalize">{value}</div>
    </div>
  );
}
