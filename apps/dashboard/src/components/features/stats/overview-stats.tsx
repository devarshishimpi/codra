import { useMemo } from "react";
import { Activity, ArrowUpRight, Cpu, MessageSquare } from "lucide-react";
import { StatsGrid, type StatDelta } from "./stats-grid";
import { fmtStat } from "@codraoss/ui/utils";
import { useIsDarkMode } from "@codraoss/ui/hooks";
import type { StatsPayload } from "@codraoss/schema";

interface OverviewStatsProps {
  stats: StatsPayload | null;
}

// Bar color is card identity, not status (blue / purple / orange / rose rhythm).
const ACCENTS = {
  reviews: { light: "#2563eb", dark: "#3b82f6" },
  input: { light: "#9333ea", dark: "#a855f7" },
  output: { light: "#ea580c", dark: "#f97316" },
  comments: { light: "#dc2626", dark: "#f87171" },
} as const;

/**
 * Percentage change of the most recent half of the series vs. the prior half.
 * Returns null when there isn't enough signal to compare honestly.
 */
function computeDelta(series: number[]): StatDelta | null {
  if (series.length < 2) return null;
  const mid = Math.floor(series.length / 2);
  const prev = series.slice(0, mid).reduce((sum, v) => sum + v, 0);
  const recent = series.slice(mid).reduce((sum, v) => sum + v, 0);

  if (prev === 0 && recent === 0) return null;
  if (prev === 0) return { pct: 100, direction: "up" };

  const pct = Math.round(((recent - prev) / prev) * 100);
  if (pct === 0) return { pct: 0, direction: "flat" };
  return { pct, direction: pct > 0 ? "up" : "down" };
}

/**
 * The 4 overview KPI cards used on the Dashboard. Renders real daily trend data
 * as sparklines with a period-over-period delta, and skeletons while loading.
 */
export function OverviewStats({ stats }: OverviewStatsProps) {
  const isDark = useIsDarkMode();
  const accent = (key: keyof typeof ACCENTS) =>
    isDark ? ACCENTS[key].dark : ACCENTS[key].light;

  const series = useMemo(() => {
    const trend = stats?.trend ?? [];
    return {
      jobs: trend.map((d) => d.jobs),
      inputTokens: trend.map((d) => d.inputTokens),
      outputTokens: trend.map((d) => d.outputTokens),
      comments: trend.map((d) => d.comments),
    };
  }, [stats]);

  const jobs = stats ? fmtStat(stats.totals.jobs) : null;
  const inputTokens = stats ? fmtStat(stats.totals.inputTokens) : null;
  const outputTokens = stats ? fmtStat(stats.totals.outputTokens) : null;
  const comments = stats ? fmtStat(stats.totals.comments) : null;

  const items = [
    {
      icon: Activity,
      label: "Total reviews",
      noun: "Reviews",
      value: jobs?.value ?? null,
      unit: jobs?.unit,
      color: accent("reviews"),
      trend: series.jobs,
      delta: computeDelta(series.jobs),
    },
    {
      icon: ArrowUpRight,
      label: "Input tokens",
      noun: "Input",
      value: inputTokens?.value ?? null,
      unit: inputTokens?.unit,
      color: accent("input"),
      trend: series.inputTokens,
      delta: computeDelta(series.inputTokens),
    },
    {
      icon: Cpu,
      label: "Output tokens",
      noun: "Output",
      value: outputTokens?.value ?? null,
      unit: outputTokens?.unit,
      color: accent("output"),
      trend: series.outputTokens,
      delta: computeDelta(series.outputTokens),
    },
    {
      icon: MessageSquare,
      label: "Comments posted",
      noun: "Comments",
      value: comments?.value ?? null,
      unit: comments?.unit,
      color: accent("comments"),
      trend: series.comments,
      delta: computeDelta(series.comments),
    },
  ];

  return <StatsGrid items={items} />;
}
