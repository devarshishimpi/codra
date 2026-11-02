import { BarSparkline, Skeleton } from "@codraoss/ui";
import * as React from "react";
import { cn } from "@codraoss/ui/utils";
import type { LucideIcon } from "lucide-react";

export interface StatDelta {
  /** Signed percentage change vs. the previous period. */
  pct: number;
  direction: "up" | "down" | "flat";
}

export interface StatsItem {
  label: string;
  /** Numeric part of the value (already formatted); null while loading. */
  value: string | null;
  /** Unit suffix rendered smaller next to the value (e.g. "k", "M"). */
  unit?: string;
  icon: LucideIcon;
  /** Accent color (hex) for the sparkline bars. */
  color: string;
  /** Short noun for the footer, e.g. "Reviews Increased by …". */
  noun?: string;
  trend?: number[];
  delta?: StatDelta | null;
}

interface StatsGridProps extends React.HTMLAttributes<HTMLDivElement> {
  items: StatsItem[];
}

/**
 * KPI cards: ui-* surface/text tokens, system font stack, mono numerals, and a
 * nested value panel with a bar sparkline.
 */
export function StatsGrid({ items, className, ...props }: StatsGridProps) {
  return (
    <div
      className={cn(
        "ui-font-sans grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
      {...props}
    >
      {items.map((item) => (
        <StatCard key={item.label} {...item} />
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  color,
  noun,
  trend,
  delta,
}: StatsItem) {
  const loading = value === null;

  return (
    <div className="flex flex-col rounded-lg border border-ui-line bg-white p-3.5 dark:border-[oklch(0.27_0_0)] dark:bg-black">
      <div className="flex items-center gap-2 px-0.5">
        <Icon size={15} strokeWidth={2} className="shrink-0 text-ui-default" />
        <span className="truncate text-[13px] font-medium text-ui-default">
          {label}
        </span>
      </div>

      <div className="ui-well mt-3 flex items-center justify-between gap-4 rounded-md px-4 py-3.5">
        {loading ? (
          <Skeleton height={40} width={100} />
        ) : (
          <p className="ui-font-mono flex min-w-0 items-baseline gap-1.5 leading-none">
            <span className="truncate text-[2.1rem] font-medium tracking-[-0.045em] text-ui-strong">
              {value}
            </span>
            {unit && <span className="text-lg text-ui-subtle">{unit}</span>}
          </p>
        )}

        {loading ? (
          <Skeleton height={44} width={80} borderRadius={4} />
        ) : (
          trend && (
            <BarSparkline
              data={trend}
              color={color}
              bars={8}
              className="h-11 shrink-0"
            />
          )
        )}
      </div>

      {/* Footer: "Reviews Increased by" ..... ▲ +15%  vs prev. period */}
      <StatFooter delta={delta} loading={loading} noun={noun} />
    </div>
  );
}

function StatFooter({
  delta,
  loading,
  noun,
}: {
  delta?: StatDelta | null;
  loading: boolean;
  noun?: string;
}) {
  if (loading) {
    return (
      // h-7 == pt-3 + the loaded row's 16px text-xs line box. Without it the card is 4px shorter
      // while loading, shifting everything below it (and the dashboard's row-fitting measurement).
      <div className="flex h-7 items-center justify-between px-0.5 pt-3">
        <Skeleton height={12} width={110} />
        <Skeleton height={12} width={80} />
      </div>
    );
  }

  const flat = !delta || delta.direction === "flat";
  const up = delta?.direction === "up";
  const toneClass = flat
    ? "text-ui-subtle"
    : up
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  const prefix = noun ?? "Value";
  const label = flat
    ? `${prefix} unchanged`
    : `${prefix} ${up ? "Increased" : "Decreased"} by`;

  return (
    <div className="flex h-7 items-center justify-between gap-2 px-0.5 pt-3 text-xs">
      <span className="truncate text-ui-subtle">{label}</span>
      <span className="flex shrink-0 items-baseline gap-1.5">
        {!flat && (
          <>
            <span className={cn("text-[0.55rem] leading-none", toneClass)}>
              {up ? "▲" : "▼"}
            </span>
            <span
              className={cn(
                "ui-font-mono text-[11px] font-semibold tabular-nums",
                toneClass,
              )}
            >
              {up ? "+" : "-"}
              {Math.abs(delta!.pct)}%
            </span>
          </>
        )}
        <span className="text-ui-subtle/80">vs prev. period</span>
      </span>
    </div>
  );
}
