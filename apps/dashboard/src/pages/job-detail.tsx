import { LoadError } from '@codraoss/ui';
import { useState, lazy, Suspense  } from 'react';
import { useParams } from 'react-router-dom';
import { LazyMotion, domAnimation } from 'motion/react';
import { ClipboardList, FileDiff } from 'lucide-react';
import { useJobDetail } from '@client/hooks/use-job-detail';
import { JobHeader } from '@client/components/features/job-detail/job-header';
import { JobProgress } from '@client/components/features/job-detail/job-progress';
import { JobStatusNotice } from '@client/components/features/job-detail/job-status-notice';
import { JobMetaCards } from '@client/components/features/job-detail/job-meta-cards';
import { JobReviewOverview } from '@client/components/features/job-detail/job-review-overview';
import { JobFindingsList } from '@client/components/features/job-detail/job-findings-list';

const JobDiffs = lazy(() => import('@client/components/features/job-detail/job-diffs').then((m) => ({ default: m.JobDiffs })));
import { JobDetailSkeleton } from '@client/components/features/job-detail/job-skeleton';
import { cn } from '@codraoss/ui/utils';

type DetailTab = 'overview' | 'files';

const TABS: Array<{ id: DetailTab; label: string; icon: typeof ClipboardList }> = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'files', label: 'Files changed', icon: FileDiff },
];

export function JobDetailPage() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<DetailTab>('overview');
  const {
    job,
    error,
    isRerunning,
    isStopping,
    isDeleting,
    handleRerun,
    handleStop,
    handleDelete,
  } = useJobDetail(id);

  if (!job) {
    return <JobDetailSkeleton error={error} />;
  }

  return (
    <section
      className={cn(
        'ui-font-sans flex flex-col gap-5',
        // Files-changed fills the viewport so the tree is full height and the diff pane scrolls itself; Overview keeps normal flow.
        tab === 'files' && 'min-h-0 flex-1',
      )}
    >
      <JobHeader
        job={job}
        isRerunning={isRerunning}
        isStopping={isStopping}
        isDeleting={isDeleting}
        onRerun={handleRerun}
        onStop={handleStop}
        onDelete={handleDelete}
      />

      {error && <LoadError title="Something went wrong" detail={error} />}

      <JobProgress job={job} />

      {/* Terminal outcome (failed / superseded / stopped / partial) gets its own banner above the tabs. */}
      <JobStatusNotice job={job} />

      {/* Using domAnimation instead of domMax to save bundle size */}
      <LazyMotion features={domAnimation}>
        <nav className="flex items-center gap-1 border-b border-ui-line" role="tablist" aria-label="Job detail sections">
          {TABS.map(({ id: tabId, label, icon: Icon }) => {
            const active = tab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tabId)}
                className={cn(
                  'relative -mb-px flex items-center gap-2 px-3 py-2.5 text-[13px] transition-colors',
                  active ? 'font-medium text-ui-strong' : 'text-ui-subtle hover:text-ui-default',
                )}
              >
                <Icon size={14} strokeWidth={2} />
                {label}
                {active && (
                  <span
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--btn-primary-bg)]"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </LazyMotion>

      {tab === 'overview' ? (
        <div className="flex flex-col gap-5">
          <JobMetaCards job={job} />
          <JobReviewOverview job={job} />
          <JobFindingsList job={job} />
        </div>
      ) : (
        <Suspense fallback={<div className="p-4 text-center text-sm text-ui-subtle">Loading diffs...</div>}>
          <JobDiffs job={job} />
        </Suspense>
      )}
    </section>
  );
}
