import type { JobSummary } from "@codraoss/schema";

/** Shared job status/duration formatting - keep it here, not duplicated per-component (previous copies diverged). */

/** Dot tone per status. `pending` means "not reached yet", so it stays neutral rather than borrowing queued's amber. */
export const STATUS_DOT: Record<string, string> = {
  done: "bg-success",
  running: "bg-info",
  queued: "bg-warning",
  failed: "bg-danger",
  superseded: "bg-ui-subtle",
  cancelled: "bg-ui-subtle",
  stopped: "bg-ui-subtle",
  pending: "bg-ui-subtle",
  skipped: "bg-ui-subtle",
};

export function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

/** Whole seconds/minutes/hours, no decimals; `formatPreciseDuration` in lib/utils.ts shows sub-second precision instead. */
export function formatRunDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Wall-clock run time: start → finish, or start → now while still running. */
export function jobDuration(job: Pick<JobSummary, "startedAt" | "finishedAt">) {
  if (!job.startedAt) return null;
  const start = new Date(job.startedAt).getTime();
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  return formatRunDuration(end - start);
}

/** Compact "16m ago" / "15h ago" / "3d ago" - terser than Intl.RelativeTimeFormat so a table column stays narrow. */
export function formatRelativeDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "-";
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
