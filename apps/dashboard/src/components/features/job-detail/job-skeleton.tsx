import { LoadError, Skeleton } from "@codraoss/ui";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  ClipboardList,
  FileDiff,
  Info,
  ListChecks,
} from "lucide-react";
import { DETAIL_LABEL, DETAIL_ROW } from "./job-chip-utils";

interface JobDetailSkeletonProps {
  error: string | null;
}

/* Same order the loaded page renders them, so nothing moves when the payload lands. */
const DETAIL_LABELS = ["Status", "Verdict", "Trigger", "Tokens", "Created"];

export function JobDetailSkeleton({ error }: JobDetailSkeletonProps) {
  return (
    <section className="ui-font-sans flex flex-col gap-5">
      {error && <LoadError title="Something went wrong" detail={error} />}

      {/* Breadcrumb, panel chrome and static labels are real; only the job's own values are skeletons. */}
      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0 w-full">
          <div className="flex items-center gap-1 text-[11px] text-ui-default dark:text-ui-subtle">
            <Link to="/jobs" className="transition-colors hover:text-ui-strong">
              Jobs
            </Link>
            <ChevronRight
              size={12}
              className="shrink-0 text-ui-subtle opacity-60"
            />
            <Skeleton width={62} height={11} />
          </div>

          {/* 34px is the loaded h1's measured line box, so the title never shifts when data lands. */}
          <div className="mt-1.5 flex h-[34px] items-center">
            <Skeleton width="min(28rem, 70%)" height={20} />
          </div>

          <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2">
              <Skeleton width={7} height={7} borderRadius={999} />
              <Skeleton width={48} height={13} />
              <Skeleton width={38} height={11} />
            </span>
            <Skeleton width={84} height={22} borderRadius={999} />
            <Skeleton width={128} height={13} />
            <Skeleton width={44} height={13} />
            <Skeleton width={64} height={13} />
            <Skeleton width={58} height={13} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Skeleton width={96} height={32} borderRadius={7} />
          <Skeleton width={32} height={32} borderRadius={7} />
          <Skeleton width={32} height={32} borderRadius={7} />
          <Skeleton width={32} height={32} borderRadius={7} />
        </div>
      </header>

      {/* Placeholders for JobProgress and JobStatusNotice to prevent massive CLS */}
      <div className="flex flex-col gap-5">
        <Skeleton height={8} borderRadius={999} />
        <Skeleton height={48} borderRadius={8} />
      </div>

      {/* Tab strip - static, so it doesn't appear from nowhere when data lands. */}
      <div
        className="flex items-center gap-1 border-b border-ui-line"
        aria-hidden
      >
        <span className="relative -mb-px flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-ui-strong">
          <ClipboardList size={14} strokeWidth={2} />
          Overview
          <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--btn-primary-bg)]" />
        </span>
        <span className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-ui-subtle">
          <FileDiff size={14} strokeWidth={2} />
          Files changed
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="ui-panel min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ui-line px-4 py-3 sm:px-5">
            <Info
              size={15}
              strokeWidth={2}
              className="shrink-0 text-ui-default"
            />
            <h2 className="text-[13px] font-medium text-ui-default">
              Job details
            </h2>
          </div>
          <div className="px-4 py-1.5 sm:px-5">
            {DETAIL_LABELS.map((label) => (
              <div key={label} className={DETAIL_ROW}>
                <span className={DETAIL_LABEL}>{label}</span>
                <Skeleton
                  width={label === "Verdict" ? 84 : 72}
                  height={label === "Verdict" ? 22 : 13}
                  borderRadius={label === "Verdict" ? 999 : undefined}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="ui-panel min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ui-line px-4 py-3 sm:px-5">
            <ListChecks
              size={15}
              strokeWidth={2}
              className="shrink-0 text-ui-default"
            />
            <h2 className="text-[13px] font-medium text-ui-default">
              Progress steps
            </h2>
          </div>
          <div className="px-4 py-1.5 sm:px-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={DETAIL_ROW}>
                <span className="flex min-w-0 items-center gap-2">
                  <Skeleton width={7} height={7} borderRadius={999} />
                  <Skeleton width={110} height={13} />
                </span>
                <Skeleton width={38} height={11} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
