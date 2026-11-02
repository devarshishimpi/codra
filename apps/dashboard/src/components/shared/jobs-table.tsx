import { Skeleton } from "@codraoss/ui";
import { Link } from "react-router-dom";
import { FolderGit2, GitCommitHorizontal, GitPullRequest } from "lucide-react";

import {
  VerdictPill,
  MetaChip,
  AuthorAvatar,
} from "@client/components/features/job-detail/job-chips";
import { cn } from "@codraoss/ui/utils";
import { formatDateTime } from "@client/lib/timezone";
import {
  STATUS_DOT,
  formatRelativeDate,
  jobDuration,
  statusLabel,
} from "@client/lib/job-format";

import type { JobSummary } from "@codraoss/schema";

type Column =
  | "title"
  | "status"
  | "verdict"
  | "repo"
  | "commit"
  | "pr"
  | "updated"
  | "author";

interface JobsTableProps {
  jobs: JobSummary[];
  loading: boolean;
  /** Columns to show. Defaults to all. */
  columns?: Column[];
  /** Fill the parent's height and scroll the body internally, instead of growing to fit all rows. */
  fill?: boolean;
  /** Placeholder rows drawn while loading. Match the expected result count to avoid a layout jump. */
  skeletonRows?: number;
}

const DEFAULT_COLUMNS: Column[] = [
  "title",
  "status",
  "verdict",
  "repo",
  "commit",
  "pr",
  "updated",
  "author",
];

/* Title takes all the slack; secondary metadata drops off first on narrow viewports so a row
   never wraps and the title never collapses to nothing. */
const COLUMN_CLASSES: Record<Column, string> = {
  title: "min-w-0 pl-4",
  status: "w-[156px]",
  verdict: "hidden xl:table-cell w-[108px]",
  repo: "hidden md:table-cell w-[176px]",
  commit: "hidden 2xl:table-cell w-[96px]",
  pr: "hidden xl:table-cell w-[76px]",
  updated: "w-[84px]",
  author: "w-12 pr-4",
};

function formatDate(value: JobSummary["createdAt"]) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // Rendered in the account's display time zone (falls back to the browser's).
  return formatDateTime(date, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusCell({ job }: { job: JobSummary }) {
  const duration = jobDuration(job);
  const isRunning = job.status === "running";

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          "h-[7px] w-[7px] shrink-0 rounded-full",
          STATUS_DOT[job.status] ?? "bg-ui-subtle",
          isRunning && "animate-pulse",
        )}
        aria-hidden
      />
      <span className="truncate text-[13px] leading-none text-ui-default">
        {statusLabel(job.status)}
      </span>
      {duration && (
        <span className="ui-font-mono shrink-0 text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
          {duration}
        </span>
      )}
    </span>
  );
}

function JobMobileCard({ job }: { job: JobSummary }) {
  return (
    <Link
      to={`/jobs/${job.id}`}
      className="group block border-b border-ui-line px-4 py-3.5 transition-colors last:border-b-0 hover:bg-ui-fill/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-brand/40"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 min-w-0 text-[13px] font-medium leading-5 text-ui-strong">
          {job.prTitle ?? "Untitled PR"}
        </p>
        <span className="shrink-0 text-xs text-ui-default dark:text-ui-subtle">
          {formatRelativeDate(job.createdAt)}
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        <StatusCell job={job} />
        {job.verdict && <VerdictPill verdict={job.verdict} />}
      </div>

      <div className="mt-2.5 flex items-center gap-4">
        <MetaChip icon={FolderGit2} title={`${job.owner}/${job.repo}`}>
          {job.owner}/{job.repo}
        </MetaChip>
        <MetaChip icon={GitPullRequest}>#{job.prNumber}</MetaChip>
      </div>
    </Link>
  );
}

/* Fixed cell height, not vertical padding: padding-based rows grew ~6px on verdict-pill rows and
   broke the vertical rhythm. */
const CELL = "h-12 border-t border-ui-line px-2.5 align-middle";

/* Top border goes transparent, not 0-width, so it can't double up with whatever sits above the
   table without changing row height. */
const ROW_DIVIDERS = "first:[&>td]:border-transparent";

export function JobsTable({
  jobs,
  loading,
  columns,
  fill = false,
  skeletonRows,
}: JobsTableProps) {
  const cols: Column[] = columns ?? DEFAULT_COLUMNS;
  const show = (column: Column) => cols.includes(column);

  return (
    <div
      className={cn(
        "min-w-0 max-w-full",
        fill ? "flex min-h-0 flex-1 flex-col" : "overflow-hidden",
      )}
    >
      <div
        className={cn(
          "sm:hidden",
          fill && "auto-hide-scroll min-h-0 flex-1 overflow-y-auto",
        )}
      >
        {loading && jobs.length === 0
          ? Array.from({ length: skeletonRows ?? 6 }).map((_, i) => (
              <div
                key={i}
                className="border-b border-ui-line px-4 py-3.5 last:border-b-0"
              >
                <Skeleton width="70%" height={14} />
                <div className="mt-3 flex gap-3">
                  <Skeleton width={110} height={13} />
                  <Skeleton width={84} height={22} borderRadius={999} />
                </div>
                <div className="mt-3 flex gap-4">
                  <Skeleton width="45%" height={12} />
                  <Skeleton width={44} height={12} />
                </div>
              </div>
            ))
          : jobs.map((job) => <JobMobileCard key={job.id} job={job} />)}
      </div>

      <div
        className={cn(
          "hidden max-w-full sm:block",
          fill
            ? "auto-hide-scroll min-h-0 flex-1 overflow-auto"
            : "overflow-x-auto",
        )}
      >
        <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-0 text-sm">
          <tbody>
            {loading && jobs.length === 0
              ? Array.from({ length: skeletonRows ?? 8 }).map((_, i) => (
                  <tr key={i} className={ROW_DIVIDERS}>
                    {show("title") && (
                      <td className={cn(CELL, COLUMN_CLASSES.title)}>
                        <Skeleton width="72%" height={13} />
                      </td>
                    )}
                    {show("status") && (
                      <td className={cn(CELL, COLUMN_CLASSES.status)}>
                        <span className="flex items-center gap-2">
                          <Skeleton width={7} height={7} borderRadius={999} />
                          <Skeleton width={54} height={13} />
                          <Skeleton width={40} height={11} />
                        </span>
                      </td>
                    )}
                    {show("verdict") && (
                      <td className={cn(CELL, COLUMN_CLASSES.verdict)}>
                        <Skeleton width={84} height={22} borderRadius={999} />
                      </td>
                    )}
                    {show("repo") && (
                      <td className={cn(CELL, COLUMN_CLASSES.repo)}>
                        <Skeleton width="82%" height={12} />
                      </td>
                    )}
                    {show("commit") && (
                      <td className={cn(CELL, COLUMN_CLASSES.commit)}>
                        <Skeleton width={76} height={12} />
                      </td>
                    )}
                    {show("pr") && (
                      <td className={cn(CELL, COLUMN_CLASSES.pr)}>
                        <Skeleton width={46} height={12} />
                      </td>
                    )}
                    {show("updated") && (
                      <td className={cn(CELL, COLUMN_CLASSES.updated)}>
                        <span className="flex justify-end">
                          <Skeleton width={58} height={12} />
                        </span>
                      </td>
                    )}
                    {show("author") && (
                      <td className={cn(CELL, COLUMN_CLASSES.author)}>
                        <span className="flex justify-end">
                          <Skeleton width={20} height={20} borderRadius={999} />
                        </span>
                      </td>
                    )}
                  </tr>
                ))
              : jobs.map((job) => (
                  <tr
                    key={job.id}
                    className={cn(
                      "group relative transition-colors hover:bg-ui-fill/40",
                      ROW_DIVIDERS,
                    )}
                  >
                    {show("title") && (
                      <td
                        className={cn(
                          CELL,
                          COLUMN_CLASSES.title,
                          "overflow-hidden",
                        )}
                      >
                        {/* `after:` stretches this link across the row, making the whole row one click target. */}
                        <Link
                          to={`/jobs/${job.id}`}
                          className="block truncate text-[13px] font-medium leading-none text-ui-strong outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
                          title={job.prTitle ?? undefined}
                        >
                          {job.prTitle ?? "Untitled PR"}
                        </Link>
                      </td>
                    )}

                    {show("status") && (
                      <td className={cn(CELL, COLUMN_CLASSES.status)}>
                        <StatusCell job={job} />
                      </td>
                    )}

                    {show("verdict") && (
                      <td className={cn(CELL, COLUMN_CLASSES.verdict)}>
                        {job.verdict && <VerdictPill verdict={job.verdict} />}
                      </td>
                    )}

                    {show("repo") && (
                      <td className={cn(CELL, COLUMN_CLASSES.repo)}>
                        <MetaChip
                          icon={FolderGit2}
                          title={`${job.owner}/${job.repo}`}
                        >
                          {job.owner}/{job.repo}
                        </MetaChip>
                      </td>
                    )}

                    {show("commit") && (
                      <td className={cn(CELL, COLUMN_CLASSES.commit)}>
                        {job.commitSha ? (
                          <MetaChip
                            icon={GitCommitHorizontal}
                            mono
                            title={job.commitSha}
                          >
                            {job.commitSha.slice(0, 7)}
                          </MetaChip>
                        ) : (
                          <span className="text-xs text-ui-subtle">-</span>
                        )}
                      </td>
                    )}

                    {show("pr") && (
                      <td className={cn(CELL, COLUMN_CLASSES.pr)}>
                        <MetaChip icon={GitPullRequest} mono>
                          #{job.prNumber}
                        </MetaChip>
                      </td>
                    )}

                    {show("updated") && (
                      <td
                        className={cn(
                          CELL,
                          COLUMN_CLASSES.updated,
                          "whitespace-nowrap text-right",
                        )}
                      >
                        <span
                          className="text-xs leading-none text-ui-default dark:text-ui-subtle"
                          title={formatDate(job.createdAt)}
                        >
                          {formatRelativeDate(job.createdAt)}
                        </span>
                      </td>
                    )}

                    {show("author") && (
                      <td className={cn(CELL, COLUMN_CLASSES.author)}>
                        <span className="flex justify-end">
                          <AuthorAvatar login={job.prAuthor} />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
