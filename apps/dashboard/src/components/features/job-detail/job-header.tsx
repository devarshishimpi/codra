import { Button, ConfirmDialog } from '@codraoss/ui';
import { useState } from 'react';
import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink, Loader2, RotateCcw, Terminal, Trash2 } from 'lucide-react';
import type { ButtonProps } from '@codraoss/ui';
import { UpdatesEmailPrompt } from '@client/components/shared/updates-email-prompt';
import { AuthorChip, VerdictPill } from './job-chips';
import { formatAbsoluteDate, formatRelativeDate } from './job-chip-utils';
import type { JobDetail } from '@codraoss/schema';

// Lucide's CircleStop strokes the inner square too, which reads as a blob at 14px; filling it
// instead keeps the stop symbol legible.
function StopIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface JobActionButtonProps {
  icon: ComponentType<{ size?: number }>;
  label: string;
  /** In-flight: swaps the icon for a spinner. Also disables unless `disabled` says otherwise. */
  busy: boolean;
  disabled?: boolean;
  variant?: ButtonProps['variant'];
  className?: string;
  onClick: () => void;
}

// Every header action is the same icon-only button whose only state is "in flight", so the busy flag
// lives here rather than branching the header itself.
function JobActionButton({
  icon: Icon,
  label,
  busy,
  disabled,
  variant = 'secondary',
  className = 'rounded-[7px]',
  onClick,
}: JobActionButtonProps) {
  return (
    <Button
      variant={variant}
      size="sm"
      shape="square"
      className={className}
      disabled={disabled ?? busy}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
    </Button>
  );
}

/** `Â·` inside a group of related facts, `|` between groups. */
function Dot() {
  return <span className="shrink-0 text-ui-subtle/60">Â·</span>;
}

function Pipe() {
  return <span className="shrink-0 text-ui-line">|</span>;
}

interface JobHeaderProps {
  job: JobDetail;
  isRerunning: boolean;
  isStopping: boolean;
  isDeleting: boolean;
  onRerun: () => void;
  onStop: () => void;
  onDelete: () => void;
}

export function JobHeader({
  job,
  isRerunning,
  isStopping,
  isDeleting,
  onRerun,
  onStop,
  onDelete,
}: JobHeaderProps) {
  const [stopOpen, setStopOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canStop = job.status === 'running' || job.status === 'queued';

  return (
    <>
      {/* Full-bleed header: a hairline rule under the breadcrumb bar, then the title and the PR's
          coordinates. No card - the panels below are the cards, and framing this too would nest a
          surface inside a surface. Status, token counts and the step list live in those panels. */}
      <header className="ui-font-sans min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-4 border-b border-ui-line pb-3">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <Link to="/jobs" className="shrink-0 text-ui-subtle transition-colors hover:text-ui-strong">
              Jobs
            </Link>
            <ChevronRight size={13} className="shrink-0 text-ui-subtle opacity-60" />
            <span
              className="ui-font-mono cursor-default truncate font-medium text-ui-strong"
              title={job.id}
            >
              {job.id.slice(0, 8)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" asChild className="gap-1.5 rounded-[7px]">
              <Link to={`/jobs/${job.id}/logs`}>
                <Terminal size={13} />
                <span className="hidden sm:inline">Raw Logs</span>
              </Link>
            </Button>

            <JobActionButton
              icon={StopIcon}
              label="Stop review"
              busy={isStopping}
              disabled={!canStop || isStopping}
              onClick={() => setStopOpen(true)}
            />

            {/* Always restarts the review from the beginning (every file), regardless of the job's current status. */}
            <JobActionButton
              icon={RotateCcw}
              label={job.status === 'failed' ? 'Retry job' : 'Re-run job'}
              busy={isRerunning}
              onClick={onRerun}
            />

            <JobActionButton
              icon={Trash2}
              label="Delete job"
              busy={isDeleting}
              variant="destructive-outline"
              className="rounded-[7px] shadow-none"
              onClick={() => setDeleteOpen(true)}
            />
          </div>
        </div>

        <div className="mt-4 min-w-0">
          <h1
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[1.35rem] font-bold leading-tight text-foreground"
            style={{ letterSpacing: '-0.02em' }}
          >
            <a
              href={`https://github.com/${job.owner}/${job.repo}/pull/${job.prNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 max-w-full items-center gap-2 transition-colors hover:text-primary"
            >
              <span className="min-w-0 break-words">{job.prTitle ?? 'Untitled pull request'}</span>
              <ExternalLink size={14} className="mt-0.5 shrink-0 text-ui-subtle" />
            </a>
            {job.verdict && <VerdictPill verdict={job.verdict} />}
          </h1>

          {/* Coordinates, in one readable line rather than a row of chips. */}
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-xs leading-none text-ui-default dark:text-ui-subtle">
            <span className="truncate">
              {job.owner}/{job.repo}
            </span>
            <Dot />
            <span className="ui-font-mono shrink-0 tabular-nums">#{job.prNumber}</span>
            {job.commitSha && (
              <>
                <Dot />
                <span className="ui-font-mono shrink-0" title={job.commitSha}>
                  {job.commitSha.slice(0, 7)}
                </span>
              </>
            )}

            {job.baseRef && job.headRef && (
              <>
                <Pipe />
                <span
                  className="ui-font-mono hidden max-w-[22rem] truncate md:inline"
                  title={`${job.headRef} â†’ ${job.baseRef}`}
                >
                  {job.baseRef} â† {job.headRef}
                </span>
              </>
            )}

            <Pipe />
            <AuthorChip login={job.prAuthor} />
            <Dot />
            <span className="shrink-0" title={formatAbsoluteDate(job.createdAt)}>
              {formatRelativeDate(job.createdAt)}
            </span>
          </div>
        </div>
      </header>

      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title="Stop this review?"
        description="This cancels the ongoing review for this pull request. Any files not yet reviewed will be left unreviewed."
        confirmLabel="Stop review"
        confirmVariant="destructive"
        onConfirm={onStop}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this job?"
        description="This permanently removes the job and its review history. This action cannot be undone."
        confirmLabel="Delete job"
        confirmVariant="destructive"
        onConfirm={onDelete}
      />

      <UpdatesEmailPrompt />
    </>
  );
}

