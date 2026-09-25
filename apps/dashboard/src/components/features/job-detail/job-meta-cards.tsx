import type { ReactNode } from "react";
import { AtSign, Info, ListChecks, RotateCcw, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { cn, formatPreciseDuration } from "@codraoss/ui/utils";
import type { JobDetail, JobStep } from "@codraoss/schema";
import {
  EmptyValue,
  JobStatusLine,
  MetaChip,
  StatusDot,
  VerdictPill,
} from "./job-chips";
import {
  DETAIL_LABEL,
  DETAIL_ROW,
  formatAbsoluteDate,
  formatRelativeDate,
} from "./job-chip-utils";

interface JobMetaCardsProps {
  job: JobDetail;
}

const TRIGGER_ICON = {
  auto: Zap,
  mention: AtSign,
  retry: RotateCcw,
} as const;

function elapsedSec(step: JobStep): string | null {
  if (step.finishedAt && step.startedAt) {
    const start = new Date(step.startedAt).getTime();
    const end = new Date(step.finishedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return formatPreciseDuration(end - start);
  }
  return null;
}

function MetaPanel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Info;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="ui-panel flex min-w-0 flex-col overflow-hidden p-3.5">
      <div className="flex items-center gap-2 px-0.5">
        <Icon size={15} strokeWidth={2} className="shrink-0 text-ui-default" />
        <h2 className="truncate text-[13px] font-medium text-ui-default">
          {title}
        </h2>
      </div>
      {/* Recessed inner panel, same as the dashboard stat cards. */}
      <div className="ui-well mt-3 flex-1 rounded-md px-4 py-1.5">
        {children}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={DETAIL_ROW}>
      <dt className={DETAIL_LABEL}>{label}</dt>
      <dd className="flex min-w-0 items-center justify-end">{children}</dd>
    </div>
  );
}

function StepRow({ step }: { step: JobStep }) {
  const isRunning = step.status === "running";
  const isPending = step.status === "pending";
  const elapsed = elapsedSec(step);

  return (
    <div className={DETAIL_ROW}>
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot
          status={step.status}
          className={isPending ? "opacity-50" : undefined}
        />
        <span
          className={cn(
            "truncate text-[13px] leading-none",
            isPending ? "text-ui-subtle" : "text-ui-default",
            isRunning && "font-medium",
          )}
        >
          {step.name}
        </span>
      </div>

      <div className="shrink-0">
        {isRunning ? (
          <span className="text-[11px] leading-none text-info">Running</span>
        ) : elapsed ? (
          <span className="ui-font-mono text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
            {elapsed}
          </span>
        ) : (
          <EmptyValue />
        )}
      </div>
    </div>
  );
}

export function JobMetaCards({ job }: JobMetaCardsProps) {
  const steps = job.steps ?? [];
  const TriggerIcon = TRIGGER_ICON[job.trigger] ?? Zap;

  return (
    <div className="ui-font-sans grid grid-cols-1 gap-4 md:grid-cols-2">
      <MetaPanel icon={Info} title="Job details">
        <dl>
          <DetailRow label="Status">
            <JobStatusLine job={job} />
          </DetailRow>

          <DetailRow label="Verdict">
            {job.verdict ? (
              <VerdictPill verdict={job.verdict} />
            ) : (
              <EmptyValue />
            )}
          </DetailRow>

          <DetailRow label="Trigger">
            <MetaChip icon={TriggerIcon}>
              <span className="capitalize">{job.trigger}</span>
            </MetaChip>
          </DetailRow>

          <DetailRow label="Tokens">
            <span className="ui-font-mono text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
              {(job.totalInputTokens + job.totalOutputTokens).toLocaleString()}
            </span>
          </DetailRow>

          <DetailRow label="Created">
            <span
              className="text-xs leading-none text-ui-default dark:text-ui-subtle"
              title={formatAbsoluteDate(job.createdAt)}
            >
              {formatRelativeDate(job.createdAt)}
            </span>
          </DetailRow>

          {job.retryOfJobId && (
            <DetailRow label="Retry of">
              <Link
                to={`/jobs/${job.retryOfJobId}`}
                className="ui-font-mono text-[11px] leading-none text-ui-default transition-colors hover:text-primary dark:text-ui-subtle"
                title={job.retryOfJobId}
              >
                {job.retryOfJobId.slice(0, 8)}
              </Link>
            </DetailRow>
          )}
        </dl>
      </MetaPanel>

      <MetaPanel icon={ListChecks} title="Progress steps">
        {steps.length === 0 ? (
          <p className="py-2.5 text-xs text-ui-default dark:text-ui-subtle">
            No steps recorded yet.
          </p>
        ) : (
          steps.map((step) => <StepRow key={step.name} step={step} />)
        )}
      </MetaPanel>
    </div>
  );
}
