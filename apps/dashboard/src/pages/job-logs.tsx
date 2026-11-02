import { LoadError } from "@codraoss/ui";
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";

import { readDiffsCache, writeDiffsCache } from "@client/lib/diffs-cache";
import { groupBatches } from "@client/lib/batch-groups";
import {
  ChevronLeft,
  FileCode2,
  Layers,
  MessageSquare,
} from "lucide-react";
import { useJobDetail } from "@client/hooks/use-job-detail";
import { JobDetailSkeleton } from "@client/components/features/job-detail/job-skeleton";

import { api } from "@client/lib/api";
import { FileRow, withheldTotal } from "@client/components/features/job-logs/file-row";

export function JobLogsPage() {
  const { id = "" } = useParams();
  const { job, error } = useJobDetail(id);

  const [diffsByPath, setDiffsByPath] = useState<Record<string, string> | null>(
    () => readDiffsCache(id),
  );
  const [diffsLoading, setDiffsLoading] = useState(diffsByPath === null);

  useEffect(() => {
    let cancelled = false;
    setDiffsLoading(true);
    api
      .getJobDiffs(id)
      .then((res) => {
        if (cancelled) return;
        setDiffsByPath(res.diffs);
        writeDiffsCache(id, res.diffs);
      })
      .catch(() => {
        if (!cancelled) setDiffsByPath((current) => current ?? {});
      })
      .finally(() => {
        if (!cancelled) setDiffsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const files = useMemo(
    () =>
      job
        ? job.files.map((f) =>
            diffsByPath?.[f.filePath]
              ? { ...f, diffInput: diffsByPath[f.filePath] }
              : f,
          )
        : [],
    [job, diffsByPath],
  );

  // Above the early return: hooks must run in the same order on every render.
  const batches = useMemo(() => groupBatches(files), [files]);

  if (!job) return <JobDetailSkeleton error={error} />;

  const counts = {
    done: files.filter((f) => f.fileStatus === "done").length,
    skipped: files.filter((f) => f.fileStatus === "skipped").length,
    failed: files.filter((f) => f.fileStatus === "failed").length,
    total: files.length,
  };

  // Derived from the reconstructed bins, so it matches what the rows show rather than being a
  // second, independently-computed number that can disagree with them.
  const binCount = new Set([...batches.values()].map((group) => group.index))
    .size;
  const batchedFiles = batches.size;
  const callsSaved = batchedFiles - binCount;
  const withheld = files.reduce((sum, file) => sum + withheldTotal(file), 0);
  const kept = files.reduce((sum, file) => sum + file.parsedComments.length, 0);

  return (
    <section className="ui-font-sans flex flex-col gap-5">
      <Link
        to={`/jobs/${job.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-ui-subtle transition-colors hover:text-ui-default"
      >
        <ChevronLeft size={14} />
        Back to Job Details
      </Link>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h1
            className="text-xl font-bold tracking-tight text-foreground"
            style={{ letterSpacing: "-0.02em" }}
          >
            Review logs
          </h1>
          <p className="ui-font-mono mt-1.5 truncate text-xs text-ui-subtle">
            {job.owner}/{job.repo} · #{job.prNumber} ·{" "}
            {job.commitSha.slice(0, 7)}
          </p>
        </div>

        {counts.total > 0 && (
          <div className="ui-panel flex shrink-0 items-center divide-x divide-ui-line/60 overflow-hidden">
            {[
              { label: "Files", val: counts.total, cls: "text-ui-strong" },
              { label: "Reviewed", val: counts.done, cls: "text-success" },
              { label: "Skipped", val: counts.skipped, cls: "text-ui-subtle" },
              {
                label: "Failed",
                val: counts.failed,
                cls: counts.failed > 0 ? "text-danger" : "text-ui-subtle",
              },
            ].map(({ label, val, cls }) => (
              <div
                key={label}
                className="flex flex-col items-center px-4 py-2.5"
              >
                <span
                  className={`ui-font-mono text-base leading-none tabular-nums ${cls}`}
                >
                  {val}
                </span>
                <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                  {label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <LoadError title="Something went wrong" detail={error} />}

      {/* Second strip rather than more columns in the first: the one above counts files, these
          describe the review itself, and mixing the two units read as one confusing row. */}
      {counts.total > 0 && (
        <div className="ui-panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-5">
          <span className="flex items-center gap-1.5 text-[11px] text-ui-subtle">
            <MessageSquare size={12} className="text-ui-subtle" />
            <span className="ui-font-mono tabular-nums text-ui-strong">
              {kept}
            </span>{" "}
            findings kept
            {withheld > 0 && (
              <>
                <span className="text-ui-subtle/50">·</span>
                <span className="ui-font-mono tabular-nums text-warning">
                  {withheld}
                </span>{" "}
                withheld by the gates
              </>
            )}
          </span>

          {binCount > 0 && (
            <span
              title="Files packed into shared model calls. Their token counts are each file's share of the shared call."
              className="flex items-center gap-1.5 text-[11px] text-ui-subtle"
            >
              <Layers size={12} />
              <span className="ui-font-mono tabular-nums text-ui-strong">
                {batchedFiles}
              </span>{" "}
              files in
              <span className="ui-font-mono tabular-nums text-ui-strong">
                {binCount}
              </span>
              {binCount === 1 ? "batch" : "batches"}
              <span className="text-ui-subtle/50">·</span>
              <span className="ui-font-mono tabular-nums text-success">
                {callsSaved}
              </span>{" "}
              model calls saved
            </span>
          )}
        </div>
      )}

      {files.length === 0 ? (
        <div className="ui-panel flex flex-col items-center justify-center gap-4 py-20 text-center">
          <FileCode2
            size={36}
            className="text-ui-subtle/30"
            strokeWidth={1.5}
          />
          <div>
            <p className="text-sm font-medium text-ui-default">
              No files processed yet
            </p>
            {(job.status === "running" || job.status === "queued") && (
              <p className="mt-1 text-xs text-ui-subtle">
                Logs appear here once files are reviewed
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="ui-panel min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ui-line px-4 py-3 sm:px-5">
            <FileCode2
              size={15}
              strokeWidth={2}
              className="shrink-0 text-ui-default"
            />
            <h2 className="text-[13px] font-medium text-ui-default">
              File reviews
            </h2>
            <span className="ui-font-mono ml-auto text-[11px] tabular-nums text-ui-subtle">
              {counts.total} {counts.total === 1 ? "file" : "files"}
            </span>
          </div>
          <div className="divide-y divide-ui-line/60">
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                diffsLoading={diffsLoading}
                batch={batches.get(file.filePath)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
