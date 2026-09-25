// The chart chunk is only *rendered* once stats have loaded, so importing it lazily at render time
// would delay its download until after the fetch resolved -- a waterfall the eager import it
// replaced never had. Calling the prefetch on mount puts the ~68 kB gzip request alongside the
// stats fetch instead of behind it.
// Separate from metrics-grid.tsx so that file keeps exporting components only (Fast Refresh).
import type { MetricsGridCharts } from "./metrics-grid-charts";

type ChartsComponent = typeof MetricsGridCharts;

let pending: Promise<ChartsComponent> | null = null;
let resolved: ChartsComponent | null = null;

/** Memoized so the prefetch and the render path share one request and one module instance. */
export function loadMetricsCharts(): Promise<ChartsComponent> {
  pending ??= import("./metrics-grid-charts").then((m) => {
    resolved = m.MetricsGridCharts;
    return resolved;
  });
  return pending;
}

/**
 * The already-loaded component, or null. Lets the grid render charts on the very first commit of a
 * later visit, with no fallback frame in between.
 */
export function metricsChartsIfLoaded(): ChartsComponent | null {
  return resolved;
}

export function prefetchMetricsCharts() {
  void loadMetricsCharts();
}
