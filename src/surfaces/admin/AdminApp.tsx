import { useEffect, useState } from 'react';
import { Plus, Archive, ArchiveRestore, RefreshCw, Printer } from 'lucide-react';
import { supabase, OUTLET_ID } from '@/lib/supabase';
import { APP_DOMAIN } from '@/config/brand';
import type { Area, RestaurantTable } from '@/types';
import { cn, tableStatusColor } from '@/lib/format';
import { Button, Modal, Spinner } from '@/components/ui';
import { QRCode } from '@/components/QRCode';
import { TablesAdmin } from './TablesAdmin';
import { MenuAdmin } from './MenuAdmin';
import { ReportsAdmin } from './ReportsAdmin';

type Tab = 'floor' | 'tables' | 'menu' | 'reports';

export function AdminApp() {
  const [tab, setTab] = useState<Tab>('floor');
  const [areas, setAreas] = useState<Area[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAreaName, setNewAreaName] = useState('');
  const [adding, setAdding] = useState(false);
  const [qrAreaId, setQrAreaId] = useState<string | null>(null);

  const load = async () => {
    const [a, t] = await Promise.all([
      supabase.from('areas').select('*').eq('outlet_id', OUTLET_ID).order('sort_order'),
      supabase.from('tables').select('*').eq('outlet_id', OUTLET_ID).order('label'),
    ]);
    setAreas((a.data as Area[]) ?? []);
    setTables((t.data as RestaurantTable[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const addArea = async () => {
    if (!newAreaName.trim()) return;
    setAdding(true);
    await supabase.from('areas').insert({
      outlet_id: OUTLET_ID,
      name: newAreaName.trim(),
      sort_order: areas.length + 1,
    });
    setAdding(false);
    setNewAreaName('');
    load();
  };

  const archiveArea = async (a: Area) => {
    await supabase.from('areas').update({ archived_at: new Date().toISOString() }).eq('id', a.id);
    load();
  };

  const restoreArea = async (a: Area) => {
    await supabase.from('areas').update({ archived_at: null }).eq('id', a.id);
    load();
  };

  const activeAreas = areas.filter((a) => !a.archived_at);
  const archivedAreas = areas.filter((a) => a.archived_at);

  if (loading) {
    return <div className="py-32 text-center"><Spinner className="h-8 w-8" /></div>;
  }

  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-14 z-30 border-b border-ink-600 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto max-w-[1300px] px-4 py-3 flex flex-wrap items-center gap-3">
          <h1 className="font-display font-bold text-lg">Admin dashboard</h1>
          <div className="ml-auto flex gap-1 bg-ink-800 border border-ink-600 rounded-xl p-1 flex-wrap">
            {([['floor', 'Floor plan'], ['tables', 'Tables & QR'], ['menu', 'Menu'], ['reports', 'Reports']] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn('px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors', tab === t ? 'bg-ink-600 text-ink-100' : 'text-ink-400')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1300px] px-4 py-5">
        {tab === 'floor' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <input
                value={newAreaName}
                onChange={(e) => setNewAreaName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addArea()}
                placeholder="New area name (e.g. Rooftop, Bar Counter)"
                className="flex-1 min-w-[220px] h-11 px-3 rounded-xl bg-ink-800 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
              />
              <Button onClick={addArea} disabled={adding}>
                <Plus size={15} /> Add area
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeAreas.map((a) => {
                const count = tables.filter((t) => t.area_id === a.id).length;
                return (
                  <div key={a.id} className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-display font-semibold text-lg">{a.name}</div>
                        <div className="text-xs text-ink-400 mt-0.5">
                          {count} table{count === 1 ? '' : 's'}
                          {a.allows_reservations ? ' · reservations allowed' : ' · no reservations'}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setQrAreaId(a.id)}
                          title="Print QR codes"
                          className="rounded-lg p-2 text-ink-300 hover:bg-ink-700 hover:text-saffron-400"
                        >
                          <Printer size={16} />
                        </button>
                        <button
                          onClick={() => archiveArea(a)}
                          title="Archive area"
                          className="rounded-lg p-2 text-ink-300 hover:bg-ink-700 hover:text-rose2-400"
                        >
                          <Archive size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {tables.filter((t) => t.area_id === a.id).map((t) => (
                        <span key={t.id} className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium', tableStatusColor[t.status])}>
                          {t.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {archivedAreas.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-ink-300 mb-2 inline-flex items-center gap-1.5">
                  <ArchiveRestore size={14} /> Archived areas
                </h2>
                <div className="flex flex-wrap gap-2">
                  {archivedAreas.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => restoreArea(a)}
                      className="rounded-full border border-ink-600 bg-ink-800 px-3.5 py-1.5 text-sm text-ink-300 hover:text-ink-100 inline-flex items-center gap-1.5"
                    >
                      <RefreshCw size={13} /> {a.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* QR print modal */}
            <Modal open={!!qrAreaId} onClose={() => setQrAreaId(null)} title="QR print kit" maxWidth="max-w-2xl">
              {qrAreaId && (() => {
                const area = areas.find((x) => x.id === qrAreaId)!;
                const areaTables = tables.filter((t) => t.area_id === qrAreaId);
                return (
                  <div className="space-y-4">
                    <p className="text-sm text-ink-400">
                      Each table has a permanent QR code with a secret token that maps to that exact table.
                      Print these as table tents or stickers. In the full product you can download as SVG,
                      PNG or PDF with sheet layouts (A4 6-up, table-tent, sticker) and bulk-print all tables.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {areaTables.map((t) => (
                        <div key={t.id} className="rounded-xl border border-ink-600 bg-ink-900 p-3 text-center">
                          <div className="font-display font-bold">{t.label}</div>
                          <div className="text-[10px] text-ink-400 mb-2">{area.name}</div>
                          <div className="flex justify-center bg-white rounded-lg p-1.5">
                            <QRCode value={`https://${APP_DOMAIN}/t/${t.qr_token}`} size={110} />
                          </div>
                          <div className="mt-2 text-[10px] text-ink-400">Scan to order</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </Modal>
          </div>
        )}

        {tab === 'tables' && <TablesAdmin areas={activeAreas} tables={tables} reload={load} />}
        {tab === 'menu' && <MenuAdmin />}
        {tab === 'reports' && <ReportsAdmin />}
      </div>
    </div>
  );
}
