import { LoadError } from '@codraoss/ui';
import { useEffect, useState } from 'react';
import { PageHeaderActions } from '@client/components/shared/page-header-actions';
import { PageHeader } from '@client/components/layout/page-header';
import { useIsDarkMode } from '@codraoss/ui/hooks';
import { usePolling } from '@client/hooks/use-polling';
import { useStatsRange } from '@client/hooks/use-stats-range';
import { api } from '@client/lib/api';
import type { StatsPayload } from '@codraoss/schema';


import { MetricsGrid } from '@client/components/features/stats/metrics-grid';
import { prefetchMetricsCharts } from '@client/components/features/stats/metrics-grid-prefetch';


export function StatsPage() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useStatsRange();
  const isDark = useIsDarkMode();

  // Downloads the lazy chart chunk in parallel with the first stats fetch rather than after it.
  useEffect(prefetchMetricsCharts, []);

  // Switching the range reloads every metric; keep current data while it loads.
  const changeDays = (next: number) => {
    setDays(next);
  };

  const load = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await api.getStats(days);
      setStats(res.stats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stats.');
    } finally {
      setRefreshing(false);
    }
  };

  usePolling(load, 30_000, [days]);

  return (
    <section className="page-enter flex flex-col gap-6">
      <PageHeader
        title="Review metrics"
        description="Daily review and comment activity for the selected range."
        actions={
          <PageHeaderActions
            days={days}
            onDaysChange={changeDays}
            onRefresh={() => load(true)}
            refreshing={refreshing}
          />
        }
      />

      {error && (
        <LoadError
          title="Couldn't load stats"
          detail={error}
          onRetry={() => load(true)}
          retrying={refreshing}
        />
      )}

      {/* MetricsGrid owns the skeleton too: branching here as well would mount a second one. */}
      <MetricsGrid stats={stats} isDark={isDark} />
    </section>
  );
}
