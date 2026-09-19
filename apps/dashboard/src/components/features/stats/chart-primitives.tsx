import { Skeleton, GraphShell, SeriesMarker, type SeriesMarkerProps } from '@codraoss/ui';
import type { ReactNode } from 'react';
import { Activity, Boxes, Coins, FolderGit2, ShieldCheck } from 'lucide-react';
import { formatCompact, formatDayRange } from './chart-support';

/** Per-`dataKey` marker description, so the tooltip can draw exactly what the legend drew. */
export type SeriesMarkers = Record<string, SeriesMarkerProps>;

/**
 * Recharts reports a series' raw `fill`, so gradient- and pattern-backed bars arrive as `url(#id)`,
 * which is not a CSS colour - assigning it to `background-color` renders nothing at all. The
 * caller's `markers` map is the source of truth; this only covers series it doesn't describe.
 */
function fallbackMarker(color: string | undefined): SeriesMarkerProps {
  if (!color || color.startsWith('url(')) return { color: 'currentColor' };
  return { color };
}

export function ChartTooltip({ active, payload, label, markers }: any) {
  if (!active || !payload?.length) return null;

  const endDay: string | undefined = payload[0]?.payload?.endDay;
  const heading =
    typeof label === 'string' && label.includes('-') ? formatDayRange(label, endDay) : label;

  return (
    <div className="rounded-md bg-ui-base px-3 py-2.5 text-xs shadow-lg ring ring-ui-line">
      {label && <p className="mb-2 font-semibold text-ui-strong">{heading}</p>}
      <div className="space-y-1.5">
        {payload.map((item: any) => (
          <div key={item.dataKey ?? item.name} className="flex min-w-32 items-center gap-2">
            <SeriesMarker
              {...((markers as SeriesMarkers | undefined)?.[item.dataKey] ??
                fallbackMarker(item.color))}
            />
            <span className="flex-1 capitalize text-ui-subtle">{item.name}</span>
            <span className="font-semibold tabular-nums text-ui-default">
              {typeof item.value === 'number' ? formatCompact(item.value) : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GraphCardSkeleton({ title, icon, className = '' }: { title: string; icon?: ReactNode; className?: string }) {
  return (
    <GraphShell title={title} icon={icon} className={className}>
      <div className="h-64 px-1.5 pb-3 pt-3 sm:h-80 sm:px-2 sm:pb-4">
        <Skeleton height="100%" width="100%" borderRadius={6} />
      </div>
    </GraphShell>
  );
}

function JobHealthSkeleton({ title, icon, className = '' }: { title: string; icon?: ReactNode; className?: string }) {
  return (
    <GraphShell title={title} icon={icon} className={className}>
      <div className="flex flex-1 items-center gap-5 px-3.5 py-4 sm:px-4 sm:py-4.5">
        <div className="relative h-36 w-36 shrink-0">
          <Skeleton height="100%" width="100%" borderRadius="50%" />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton height={10} width={10} borderRadius={3} />
                <Skeleton height={12} width={70} />
              </div>
              <Skeleton height={12} width={40} />
            </div>
          ))}
        </div>
      </div>
    </GraphShell>
  );
}

function GraphBarCardSkeleton({ title, icon, rows = 5, className = '' }: { title: string; icon?: ReactNode; rows?: number; className?: string }) {
  return (
    <GraphShell title={title} icon={icon} className={className}>
      <div className="px-3.5 py-4 sm:px-4 sm:py-4.5">
        <div className="space-y-3.5">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex h-5 items-center gap-3">
              <Skeleton height={12} width={112} />
              <Skeleton height={16} width="100%" />
              <Skeleton height={12} width={56} />
            </div>
          ))}
        </div>
      </div>
    </GraphShell>
  );
}

/** Rows only - `MetricsGrid` owns the outer wrapper so the skeleton/chart handoff isn't animated. */
export function MetricsGridSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <GraphCardSkeleton title="Review Flow" icon={<Activity size={14} strokeWidth={2} />} />
        <GraphCardSkeleton title="Token Volume" icon={<Coins size={14} strokeWidth={2} />} />
      </div>
      <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <JobHealthSkeleton title="Job Health" icon={<ShieldCheck size={14} strokeWidth={2} />} />
        <GraphBarCardSkeleton title="Top Repositories" icon={<FolderGit2 size={14} strokeWidth={2} />} rows={4} />
        <GraphBarCardSkeleton title="Model Calls" icon={<Boxes size={14} strokeWidth={2} />} rows={5} />
      </div>
    </>
  );
}
