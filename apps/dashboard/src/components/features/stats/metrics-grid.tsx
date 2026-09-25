import { useEffect, useState } from "react";
import type { StatsPayload } from "@codraoss/schema";
import { MetricsGridSkeleton } from "./chart-primitives";
import {
  loadMetricsCharts,
  metricsChartsIfLoaded,
} from "./metrics-grid-prefetch";

/**
 * Owns the whole loading state - the chart chunk *and* the data - so the skeleton is one element in
 * one tree position for the entire wait.
 *
 * This deliberately avoids `lazy` + `Suspense`: with a fallback, the skeleton renders from a second
 * position, so the handoff between "no data yet" and "chunk still downloading" unmounts one
 * skeleton and mounts another. Identical markup, but React sees a new element - restarting the
 * shimmer and replaying the parent's `page-enter` fade-up, which reads as the cards refreshing
 * twice before any content arrives.
 */
export function MetricsGrid({
  stats,
  isDark,
}: {
  stats: StatsPayload | null;
  isDark: boolean;
}) {
  const [Charts, setCharts] = useState<
    ReturnType<typeof metricsChartsIfLoaded>
  >(metricsChartsIfLoaded);

  useEffect(() => {
    if (Charts) return;
    let active = true;
    // Component values are functions, so the updater has to return one rather than be one.
    void loadMetricsCharts().then((loaded) => {
      if (active) setCharts(() => loaded);
    });
    return () => {
      active = false;
    };
  }, [Charts]);

  // The wrapper is what `page-enter` animates (it's the section's direct child), so it stays
  // mounted across the handoff: the skeleton fades up once, then the real cards simply replace it
  // in place. Returning the skeleton and the charts as siblings-of-different-shape would mount a
  // new direct child and replay the fade-up, which read as the page animating twice.
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {!Charts || !stats ? (
        <MetricsGridSkeleton />
      ) : (
        <Charts stats={stats} isDark={isDark} />
      )}
    </div>
  );
}
