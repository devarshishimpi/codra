import { Children, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export function CardDots() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.35]"
      style={{
        backgroundImage: 'radial-gradient(circle, var(--ui-line) 1px, transparent 1px)',
        backgroundSize: '18px 18px',
      }}
    />
  );
}

export function GraphShell({
  title,
  icon,
  legend,
  children,
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // Same chrome as the dashboard stat cards: card face carries the title, the chart itself sits
    // in a recessed inner panel.
    <div
      className={cn(
        'flex flex-col rounded-lg border border-ui-line bg-white p-3.5 dark:border-[oklch(0.27_0_0)] dark:bg-black',
        className,
      )}
    >
      <div className="flex items-center gap-2 px-0.5">
        {icon && <span className="shrink-0 text-ui-subtle">{icon}</span>}
        <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-default">
          {title}
        </h3>
      </div>

      <div className="ui-well relative mt-3 flex flex-1 flex-col overflow-hidden rounded-md">
        {/* Dot texture lives on the recessed face, where the chart reads against it. */}
        <CardDots />
        {legend && (
          <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3.5 pt-3.5">
            {legend}
          </div>
        )}
        <div className="relative flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

export interface SeriesMarkerProps {
  /** Flat CSS colour. Ignored when `hatched` is set, which paints its own fill. */
  color?: string;
  /** The cross-hatched fill used for the input-token series. */
  hatched?: boolean;
  /** A dashed rule instead of a swatch, for series drawn as a dashed line. */
  dashed?: boolean;
}

/**
 * The swatch that identifies a series. Shared by the legend and the tooltip so a series looks the
 * same in both - a tooltip dot that doesn't match its legend chip reads as a different series.
 */
export function SeriesMarker({ color, hatched, dashed }: SeriesMarkerProps) {
  if (dashed) {
    return (
      <span
        aria-hidden
        className="h-0 w-3.5 shrink-0 border-t-2 border-dashed"
        style={{ borderColor: color }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
      style={
        hatched
          ? {
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--ui-subtle) 0 1.5px, transparent 1.5px 3.5px)',
              backgroundColor: 'color-mix(in oklch, var(--ui-fill) 60%, transparent)',
            }
          : { backgroundColor: color }
      }
    />
  );
}

export function LegendChip({
  color,
  hatched,
  dashed,
  label,
}: SeriesMarkerProps & { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-ui-subtle">
      <SeriesMarker color={color} hatched={hatched} dashed={dashed} />
      {label}
    </span>
  );
}



export function ChartDefs({ isDark }: { isDark: boolean }) {
  const hatch = isDark ? 'rgba(228,228,231,0.5)' : 'rgba(63,63,70,0.4)';
  const hatchBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  return (
    <defs>
      <pattern id="hatchGray" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
        <rect width="5" height="5" fill={hatchBg} />
        <line x1="0" y1="0" x2="0" y2="5" stroke={hatch} strokeWidth="1.4" />
      </pattern>
      <linearGradient id="blueBar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="100%" stopColor="#2563eb" />
      </linearGradient>
      <linearGradient id="amberFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={isDark ? '#f59e0b' : '#d97706'} stopOpacity={0.16} />
        <stop offset="100%" stopColor={isDark ? '#f59e0b' : '#d97706'} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}

const METER_ROW_PX = 20;
const METER_GAP_PX = 14;

export function MeterList({ visible, children }: { visible: number; children: ReactNode }) {
  const scrolls = Children.count(children) > visible;

  return (
    <div className="px-3.5 py-4 sm:px-4 sm:py-4.5">
      <div
        className={cn('space-y-3.5', scrolls && 'overflow-y-auto pr-3')}
        style={scrolls ? { maxHeight: visible * METER_ROW_PX + (visible - 1) * METER_GAP_PX } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export function TickMeter({
  label,
  value,
  max,
  color,
  valueLabel,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  valueLabel: string;
}) {
  const SEGMENTS = 26;
  const filled = value > 0 ? Math.max(1, Math.round((value / Math.max(max, 1)) * SEGMENTS)) : 0;

  return (
    <div className="flex h-5 items-center gap-3">
      <span className="w-28 shrink-0 truncate text-[13px] font-medium text-ui-default" title={label}>
        {label}
      </span>
      <div
        className="grid h-4 flex-1 gap-[2.5px]"
        style={{ gridTemplateColumns: `repeat(${SEGMENTS}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <span
            key={i}
            className="rounded-[1px]"
            style={{ backgroundColor: i < filled ? color : 'var(--ui-fill)' }}
          />
        ))}
      </div>
      <span className="ui-font-mono w-14 shrink-0 text-right text-xs tabular-nums text-ui-default">
        {valueLabel}
      </span>
    </div>
  );
}
