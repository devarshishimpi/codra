import { Button, EmptyState, LoadError } from "@codraoss/ui";
import { useState } from "react";
import { api } from "@client/lib/api";
import type { StatsPayload, JobSummary } from "@codraoss/schema";
import { ArrowRight, GitPullRequest, Activity } from "lucide-react";
import { JobsTable } from "@client/components/shared/jobs-table";
import { PageHeaderActions } from "@client/components/shared/page-header-actions";
import { Link } from "react-router-dom";

import { PageHeader } from "@client/components/layout/page-header";
import { OverviewStats } from "@client/components/features/stats/overview-stats";
import { useFitRows } from "@client/hooks/use-fit-rows";
import { usePolling } from "@client/hooks/use-polling";
import { useStatsRange } from "@client/hooks/use-stats-range";

export function DashboardPage() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useStatsRange();

  // Ask for exactly as many recent jobs as fit under the stats cards, so the panel fills the
  // viewport without spilling into a page scroll. `null` until the first measurement lands.
  const { ref: tableRef, rows } = useFitRows({ min: 4, max: 30 });

  // Clears stats to show skeletons while the new range loads; recent-jobs is range-independent and keeps its data.
  const changeDays = (next: number) => {
    setStats(null);
    setDays(next);
  };

  const loadStats = async () => {
    try {
      const statsRes = await api.getStats(days);
      setStats(statsRes.stats);
    } catch (e: any) {
      setError(e.message || "Failed to load stats");
    }
  };

  const loadJobs = async () => {
    if (rows === null) return;
    try {
      const jobsRes = await api.getJobs({ limit: rows });
      setRecentJobs(jobsRes.jobs);
    } catch (e: any) {
      setError(e.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  };

  const load = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      await Promise.all([loadStats(), loadJobs()]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh dashboard.");
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  };

  usePolling(loadStats, 15_000, [days]);
  usePolling(loadJobs, 15_000, [rows]);

  return (
    <section className="page-enter flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Totals and recent review jobs for the selected time range."
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
          title="Couldn't load dashboard data"
          detail={error}
          onRetry={() => load(true)}
          retrying={refreshing}
        />
      )}

      <OverviewStats stats={stats} />

      <div className="ui-panel min-w-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-ui-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Activity
              size={15}
              strokeWidth={2}
              className="shrink-0 text-ui-default"
            />
            <h2 className="truncate text-[13px] font-medium text-ui-default">
              Recent reviews
            </h2>
          </div>
          <Link to="/jobs">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-ui-subtle hover:text-ui-default"
            >
              View all <ArrowRight size={13} />
            </Button>
          </Link>
        </div>

        <div ref={tableRef} className="min-w-0">
          {/* Nothing renders until the measurement lands. JobsTable falls back to 8 skeleton rows
              when `skeletonRows` is undefined, so rendering it early painted a too-long table that
              then shrank to the fitted count. `useFitRows` measures in a layout effect, so `rows`
              is set before the first paint - this costs no visible delay. */}
          {rows !== null && (loading || recentJobs.length > 0) && (
            <JobsTable
              jobs={recentJobs}
              loading={loading}
              skeletonRows={rows}
            />
          )}

          {!loading && recentJobs.length === 0 && (
            <EmptyState
              icon={<GitPullRequest />}
              title="No jobs yet"
              description="Your pull request analysis logs will appear here"
              hints={[
                "Once you open a PR in any of the connected repos, analysis triggers automatically",
                "To trigger manually, comment @codra on any PR",
              ]}
              linkAction={{
                label: "See how to interact with Codra",
                href: "https://github.com/devarshishimpi/codra#readme",
              }}
              className="rounded-none border-0"
            />
          )}
        </div>
      </div>
    </section>
  );
}
