import { fmtNumber } from "@codraoss/ui/utils";
import { formatDayLabel } from "@client/lib/timezone";

// Pure and render-free, so the chart components and the grid can share it without Fast Refresh
// losing state on the components next door.

export const CHART = {
  primary: "#65a30d",
  primaryDark: "#e0fe56",
  blue: "#3b82f6",
  blueDark: "#3b82f6",
  amber: "#d97706",
  amberDark: "#f59e0b",
  danger: "#dc2626",
  dangerDark: "#f87171",
  info: "#0ea5e9",
  infoDark: "#38bdf8",
  quiet: "#94a3b8",
  quietDark: "#64748b",
};

// Per-row accents for the segmented tick meters (white / orange / cyan / blue / purple rhythm).
export const TICK_COLORS_DARK = [
  "#e4e4e7",
  "#fb923c",
  "#22d3ee",
  "#3b82f6",
  "#a78bfa",
];

export const TICK_COLORS_LIGHT = [
  "#3f3f46",
  "#ea580c",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
];

export const MONO_STACK =
  "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// Rendered verbatim, not re-parsed: parsing these server-bucketed `YYYY-MM-DD` strings in the
// viewer's local zone used to shift the date by a day for negative UTC offsets.
export function formatDay(value: string) {
  return formatDayLabel(value);
}

/** Bucketed trend points cover a span; label them `Jul 1 – Jul 7` rather than just the start day. */
export function formatDayRange(day: string, endDay?: string) {
  if (!endDay || endDay === day) return formatDay(day);
  return `${formatDay(day)} – ${formatDay(endDay)}`;
}

export function formatCompact(value: number) {
  return value >= 1000 ? fmtNumber(value) : value.toLocaleString();
}

export function modelName(model: string) {
  return model.split("/").pop()?.replace(/-/g, " ") ?? model;
}
