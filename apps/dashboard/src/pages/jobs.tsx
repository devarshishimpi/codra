import { Button, EmptyState, Input, LoadError, Select } from '@codraoss/ui';
import { useState, useCallback, useEffect } from 'react';
import { api } from '@client/lib/api';
import { JobsTable } from '@client/components/shared/jobs-table';
import { PageHeader } from '@client/components/layout/page-header';
import { usePolling } from '@client/hooks/use-polling';
import { Activity, ChevronLeft, ChevronRight, ListFilter, RefreshCw, Search } from 'lucide-react';
import type { JobSummary } from '@codraoss/schema';

export function JobsPage() {
  const [jobs, setJobs]   = useState<JobSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [filters, setFilters] = useState({
    status: '', verdict: '', search: '', page: 1,
  });

  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);
    return () => clearTimeout(handler);
  }, [filters.search]);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const jobsRes = await api.getJobs({
        status:  filters.status  || undefined,
        verdict: filters.verdict || undefined,
        search:  debouncedSearch  || undefined,
        limit:   itemsPerPage,
        offset:  (filters.page - 1) * itemsPerPage,
      });

      setJobs(jobsRes.jobs);
      setTotal(jobsRes.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters.status, filters.verdict, filters.page, debouncedSearch, itemsPerPage]);

  usePolling(load, 15_000, [filters.status, filters.verdict, filters.page, debouncedSearch, itemsPerPage]);

  const totalPages = Math.ceil(total / itemsPerPage);
  const rangeStart = total === 0 ? 0 : (filters.page - 1) * itemsPerPage + 1;
  const rangeEnd = Math.min(filters.page * itemsPerPage, total);

  return (
    <section className="page-enter flex min-h-0 flex-1 flex-col gap-5">

      <PageHeader
        title="Jobs"
        description="Every review job across all pull requests."
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => load(true)}
              disabled={refreshing}
              icon={<RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <LoadError
          title="Couldn't load jobs"
          detail={error}
          onRetry={() => load(true)}
          retrying={refreshing}
        />
      )}

      {/* Fills available height so the table body scrolls internally and the page never needs its own scrollbar. */}
      <div className="ui-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ui-line px-4 py-2.5">
          <div className="relative basis-full sm:min-w-[10rem] sm:flex-1 sm:basis-auto">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ui-subtle"
            />
            <Input
              type="text"
              id="job-search"
              placeholder="Search jobs"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
              className="rounded-[7px] pl-[1.9rem] pr-2.5 text-[13px]"
              aria-label="Search jobs by title or number"
            />
          </div>

          <div className="min-w-[8rem] flex-1 sm:w-[9.5rem] sm:flex-none">
            <Select
              value={filters.status}
              onValueChange={(v) => setFilters((f) => ({ ...f, status: v, page: 1 }))}
              placeholder="All statuses"
              leadingIcon={<ListFilter size={13} className="text-ui-subtle" />}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'queued', label: 'Queued' },
                { value: 'running', label: 'Running' },
                { value: 'done', label: 'Done' },
                { value: 'failed', label: 'Failed' },
                { value: 'superseded', label: 'Superseded' },
                { value: 'cancelled', label: 'Cancelled' }
              ]}
              triggerClassName="gap-1.5 px-2.5 text-[13px]"
              aria-label="Filter by status"
            />
          </div>

          <div className="min-w-[8rem] flex-1 sm:w-[9.5rem] sm:flex-none">
            <Select
              value={filters.verdict}
              onValueChange={(v) => setFilters((f) => ({ ...f, verdict: v, page: 1 }))}
              placeholder="All verdicts"
              leadingIcon={<ListFilter size={13} className="text-ui-subtle" />}
              options={[
                { value: '', label: 'All verdicts' },
                { value: 'approve', label: 'Approve' },
                { value: 'comment', label: 'Comment' }
              ]}
              triggerClassName="gap-1.5 px-2.5 text-[13px]"
              aria-label="Filter by verdict"
            />
          </div>
        </div>

        {(loading || jobs.length > 0) && (
          <JobsTable jobs={jobs} loading={loading} fill skeletonRows={itemsPerPage} />
        )}

        {!loading && jobs.length === 0 && (
         <EmptyState
    className="flex-1 rounded-none border-0"
    icon={<Activity />}
    title="No jobs yet"
            description="Your pull request analysis logs will appear here"
            hints={[
              'Once you open a PR in any of the connected repos, analysis triggers automatically',
              'To trigger manually, comment @codra on any PR',
            ]}
            linkAction={{
              label: 'See how to interact with Codra',
              href: 'https://github.com/devarshishimpi/codra#readme',
            }}
          />
        )}

        {total > 0 && (
          <div className="flex shrink-0 flex-col gap-2.5 border-t border-ui-line px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ui-default dark:text-ui-subtle">
              Showing{' '}
              <span className="tabular-nums text-ui-strong">
                {rangeStart}-{rangeEnd}
              </span>{' '}
              of <span className="tabular-nums text-ui-strong">{total.toLocaleString()}</span> jobs
            </p>

            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-xs text-ui-default dark:text-ui-subtle">
                  Rows per page
                </span>
                <Select
                  value={String(itemsPerPage)}
                  onValueChange={(v) => {
                    setItemsPerPage(Number(v));
                    setFilters(f => ({ ...f, page: 1 }));
                  }}
                  options={[10, 20, 50, 100].map(n => ({ value: String(n), label: String(n) }))}
                  variant="card"
                  triggerClassName="h-8 w-[4.25rem] gap-1 px-2.5 text-xs tabular-nums"
                  aria-label="Rows per page"
                />
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  shape="square"
                  disabled={filters.page === 1}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                  className="rounded-[7px]"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} />
                </Button>
                <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-ui-default dark:text-ui-subtle">
                  {filters.page} / {Math.max(totalPages, 1)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  shape="square"
                  disabled={filters.page >= totalPages}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                  className="rounded-[7px]"
                  aria-label="Next page"
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
