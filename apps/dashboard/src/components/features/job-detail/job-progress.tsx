import { FileCode2, Hourglass } from "lucide-react";
import type { JobDetail } from "@codraoss/schema";

interface JobProgressProps {
  job: JobDetail;
}

export function JobProgress({ job }: JobProgressProps) {
  if (job.status !== "running" && job.status !== "queued") return null;

  const finishedCount = job.files.filter(
    (f) => f.fileStatus === "done" || f.fileStatus === "skipped",
  ).length;
  const total = job.fileCount || 0;
  const pct = total > 0 ? Math.round((finishedCount / total) * 100) : 0;
  const isQueued = job.status === "queued";

  const activeFile = job.files.find((f) => f.fileStatus === "pending");
  const activeFilePath = activeFile?.filePath ?? null;

  const displayPath = activeFilePath
    ? activeFilePath.split("/").slice(-2).join("/")
    : null;
  const prefixPath =
    activeFilePath && activeFilePath.includes("/")
      ? activeFilePath.split("/").slice(0, -2).join("/") + "/"
      : null;

  return (
    <div className="ui-panel ui-font-sans overflow-hidden p-3.5">
      <div className="flex items-baseline justify-between gap-4 px-0.5">
        <div className="flex items-center gap-2">
          {isQueued ? (
            <Hourglass size={14} className="shrink-0 text-ui-default" />
          ) : (
            <FileCode2 size={14} className="shrink-0 text-ui-default" />
          )}
          <span className="text-[13px] font-medium text-ui-default">
            {isQueued ? "Waiting in queue" : "Reviewing files"}
          </span>
        </div>
        <span className="ui-font-mono shrink-0 text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
          {isQueued ? "-" : `${finishedCount} / ${total}`}
        </span>
      </div>

      {/* Recessed inner panel, same as the dashboard stat cards. */}
      <div className="ui-well mt-3 rounded-md px-4 py-4">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-ui-fill"
          role="progressbar"
          aria-valuenow={isQueued ? 0 : pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={
            isQueued ? "Review waiting in queue" : "File review progress"
          }
        >
          <div
            className="h-full rounded-full bg-[var(--btn-primary-bg)] transition-[width] duration-700 ease-out"
            style={{ width: isQueued ? "0%" : `${pct}%` }}
          />
        </div>

        {!isQueued && (
          <div className="mt-2.5 flex items-baseline justify-between gap-4">
            <div className="ui-font-mono flex min-w-0 items-baseline gap-0 truncate text-[11px] text-ui-subtle">
              {prefixPath && (
                <span className="hidden shrink-0 sm:inline">{prefixPath}</span>
              )}
              {displayPath ? (
                <span className="text-ui-default">{displayPath}</span>
              ) : (
                <span className="text-ui-default dark:text-ui-subtle">
                  {Math.max(total - finishedCount, 0)}{" "}
                  {total - finishedCount === 1 ? "file" : "files"} remaining
                </span>
              )}
            </div>
            <span className="ui-font-mono shrink-0 text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
              {pct}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
