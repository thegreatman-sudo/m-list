import type { RestaurantTable, TableStatus } from '@/types';
import { cn, tableStatusColor, tableStatusLabel } from '@/lib/format';

interface FloorMapProps {
  tables: RestaurantTable[];
  areas: { id: string; name: string }[];
  selectedTableId?: string | null;
  onSelectTable?: (t: RestaurantTable) => void;
  pulseTableIds?: Set<string>;
  compact?: boolean;
}

const shapeSize: Record<string, { w: number; h: number }> = {
  round: { w: 56, h: 56 },
  square: { w: 52, h: 52 },
  rect: { w: 72, h: 52 },
};

export function FloorMap({
  tables,
  areas,
  selectedTableId,
  onSelectTable,
  pulseTableIds,
  compact,
}: FloorMapProps) {
  if (areas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-600 p-8 text-center text-sm text-ink-400">
        No areas yet. Create an area in Admin to build the floor.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {areas.map((area) => {
        const areaTables = tables.filter((t) => t.area_id === area.id);
        if (areaTables.length === 0) {
          return (
            <div key={area.id}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
                {area.name}
              </div>
              <div className="rounded-xl border border-dashed border-ink-600 p-6 text-center text-sm text-ink-400">
                No tables in this area.
              </div>
            </div>
          );
        }
        return (
          <div key={area.id}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
              {area.name}
            </div>
            <div className="rounded-2xl border border-ink-600 bg-ink-900/60 p-4 relative overflow-hidden">
              <div
                className="relative"
                style={{ minHeight: compact ? 160 : 220 }}
              >
                {areaTables.map((t) => {
                  const sz = shapeSize[t.shape] ?? shapeSize.round;
                  const selected = selectedTableId === t.id;
                  const pulsing = pulseTableIds?.has(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => onSelectTable?.(t)}
                      style={{
                        left: t.pos_x,
                        top: t.pos_y,
                        width: sz.w,
                        height: sz.h,
                        borderRadius: t.shape === 'round' ? '9999px' : '10px',
                      }}
                      className={cn(
                        'absolute flex flex-col items-center justify-center border text-center transition-all',
                        tableStatusColor[t.status],
                        selected && 'ring-2 ring-saffron-500 ring-offset-2 ring-offset-ink-900',
                        pulsing && 'df-pulse',
                        onSelectTable && 'hover:scale-105 hover:z-10'
                      )}
                    >
                      <span className="text-sm font-semibold leading-none">{t.label}</span>
                      {!compact && (
                        <span className="mt-0.5 text-[10px] opacity-80">
                          {t.min_seats}-{t.max_seats} seats
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TableStatusLegend() {
  const statuses: TableStatus[] = [
    'available',
    'reserved',
    'occupied',
    'awaiting_payment',
    'cleaning',
    'out_of_service',
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {statuses.map((s) => (
        <span
          key={s}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
            tableStatusColor[s]
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {tableStatusLabel[s]}
        </span>
      ))}
    </div>
  );
}
