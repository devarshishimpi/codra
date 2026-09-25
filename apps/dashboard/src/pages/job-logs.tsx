import { Badge, CopyButton, LoadError } from "@codraoss/ui";
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";

import { preventToggleOnTextSelection } from "@codraoss/ui/selection";
import { readDiffsCache, writeDiffsCache } from "@client/lib/diffs-cache";
import { groupBatches } from "@client/lib/batch-groups";
import type { BatchGroup } from "@client/lib/batch-groups";
import {
  ChevronLeft,
  FileCode2,
  Clock,
  Cpu,
  Hash,
  Layers,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  SkipForward,
  Hourglass,
  ChevronDown,
} from "lucide-react";
import { useJobDetail } from "@client/hooks/use-job-detail";
import { JobDetailSkeleton } from "@client/components/features/job-detail/job-skeleton";

import { api } from "@client/lib/api";
import type { FileReviewRecord } from "@codraoss/schema";

import { formatPreciseDuration } from "@codraoss/ui/utils";

function fmtK(n: number | null) {
  if (n === null) return null;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

type FileStatus = FileReviewRecord["fileStatus"];

const STATUS_META: Record<
  FileStatus,
  {
    Icon: typeof CheckCircle2;
    iconCls: string;
    badge: "success" | "neutral" | "danger";
    label: string;
  }
> = {
  done: {
    Icon: CheckCircle2,
    iconCls: "text-success",
    badge: "success",
    label: "Done",
  },
  skipped: {
    Icon: SkipForward,
    iconCls: "text-ui-subtle",
    badge: "neutral",
    label: "Skipped",
  },
  failed: {
    Icon: AlertCircle,
    iconCls: "text-danger",
    badge: "danger",
    label: "Failed",
  },
  pending: {
    Icon: Hourglass,
    iconCls: "text-ui-subtle",
    badge: "neutral",
    label: "Pending",
  },
};

function withheldTotal(file: FileReviewRecord): number {
  const counts = file.withheldCounts;
  if (!counts) return 0;
  return (
    (counts.evidence ?? 0) +
    (counts.claimDenied ?? 0) +
    (counts.contextOnly ?? 0) +
    (counts.absenceRefuted ?? 0)
  );
}

// A review that answered but not cleanly. Worth a badge rather than a log line: an unconstrained or
// truncated response can look exactly like a clean one from the outside.
const DEGRADED_LABEL: Record<string, string> = {
  "schema-dropped":
    "The model refused the response format and answered without it.",
  "schema-dropped-catchall":
    "The response format may have been dropped (the provider error was ambiguous).",
  truncated: "The model ran out of output room; some findings may be missing.",
};

function FileRow({
  file,
  diffsLoading,
  batch,
}: {
  file: FileReviewRecord;
  diffsLoading: boolean;
  batch?: BatchGroup;
}) {
  const meta = STATUS_META[file.fileStatus] ?? STATUS_META.pending;
  const { Icon } = meta;
  const duration = formatPreciseDuration(file.durationMs);
  const inTok = fmtK(file.inputTokens);
  const outTok = fmtK(file.outputTokens);
  const modelShort = file.modelUsed?.split("/").pop() ?? null;
  // Only >1 is worth surfacing: 1 means reviewed alone and null means the row predates batching,
  // and neither tells the reader anything they can act on.
  const batchSize = (file.batchSize ?? 1) > 1 ? file.batchSize! : null;
  const batchTitle = batchSize
    ? `Reviewed in one model call shared with ${batchSize - 1} other ${batchSize === 2 ? "file" : "files"}. ` +
      "Token counts are this file's share of that call; the duration is the whole call, and the raw output below is the shared response."
    : undefined;
  const siblings = batch?.paths.filter((path) => path !== file.filePath) ?? [];
  const withheld = withheldTotal(file);
  const kept = file.parsedComments.length;

  return (
    <details className="group min-w-0">
      {/* Selection allowed here (was `select-none`) so log content can be copied; the click guard stops drag-select from collapsing the row. */}
      <summary
        onClick={preventToggleOnTextSelection}
        className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-ui-fill/40 [&::-webkit-details-marker]:hidden sm:px-5"
      >
        <Icon size={14} className={`shrink-0 ${meta.iconCls}`} />

        {/* Fixed-width whether or not it is filled, so paths stay aligned down the whole list. */}
        <span
          title={
            batch
              ? `Batch ${batch.index}: one model call covering ${batch.paths.length} files`
              : undefined
          }
          className={`ui-font-mono w-7 shrink-0 text-center text-[10px] tabular-nums ${
            batch
              ? "rounded border border-ui-line bg-ui-fill/60 py-0.5 text-ui-default"
              : "text-transparent"
          }`}
        >
          {batch ? `B${batch.index}` : "·"}
        </span>

        <span className="ui-font-mono min-w-0 flex-1 truncate text-xs text-ui-default">
          {file.filePath}
        </span>

        <div className="hidden shrink-0 items-center gap-3 md:flex">
          {modelShort && (
            <span className="ui-font-mono flex items-center gap-1 text-[10px] text-ui-subtle">
              <Cpu size={10} />
              {modelShort}
            </span>
          )}
          {duration && (
            <span className="ui-font-mono flex items-center gap-1 text-[10px] tabular-nums text-ui-subtle">
              <Clock size={10} />
              {duration}
            </span>
          )}
          {(inTok || outTok) && (
            <span className="ui-font-mono flex items-center gap-1 text-[10px] tabular-nums text-ui-subtle">
              <Hash size={10} />
              {inTok ?? "-"}↑ {outTok ?? "-"}↓
            </span>
          )}
          {file.degraded && (
            <span
              title={
                DEGRADED_LABEL[file.degraded] ??
                `Review ran degraded: ${file.degraded}`
              }
              className="ui-font-mono flex items-center gap-1 text-[10px] text-warning"
            >
              <AlertCircle size={10} />
              degraded
            </span>
          )}
          {batchSize !== null && (
            <span
              title={batchTitle}
              className="ui-font-mono flex items-center gap-1 text-[10px] tabular-nums text-ui-subtle"
            >
              <Layers size={10} />×{batchSize}
            </span>
          )}
          {file.fileStatus === "done" && (
            <span
              title={
                withheld > 0
                  ? `${kept} finding${kept === 1 ? "" : "s"} kept, ${withheld} withheld by the evidence and claim gates`
                  : `${kept} finding${kept === 1 ? "" : "s"} kept`
              }
              className="ui-font-mono flex items-center gap-1 text-[10px] tabular-nums text-ui-subtle"
            >
              <MessageSquare size={10} />
              {kept}
              {/* The number that distinguishes "found nothing" from "found things and dropped them all". */}
              {withheld > 0 && (
                <span className="text-warning">-{withheld}</span>
              )}
            </span>
          )}
        </div>

        <Badge variant={meta.badge} className="shrink-0">
          {meta.label}
        </Badge>

        <ChevronDown
          size={14}
          className="shrink-0 text-ui-subtle transition-transform duration-200 group-open:rotate-180"
        />
      </summary>

      <div className="border-t border-ui-line/60">
        <div className="ui-well ui-font-mono flex flex-wrap gap-x-5 gap-y-1 border-b border-ui-line/60 px-4 py-2.5 text-[10px] text-ui-subtle md:hidden">
          {modelShort && (
            <span>
              <Cpu size={9} className="mr-1 inline" />
              {modelShort}
            </span>
          )}
          {duration && (
            <span>
              <Clock size={9} className="mr-1 inline" />
              {duration}
            </span>
          )}
          {inTok && (
            <span>
              <Hash size={9} className="mr-1 inline" />
              {inTok}↑ {outTok ?? "-"}↓
            </span>
          )}
          {batchSize !== null && (
            <span title={batchTitle}>
              <Layers size={9} className="mr-1 inline" />
              batch {batch?.index ?? "?"} · ×{batchSize}
            </span>
          )}
          {file.fileStatus === "done" && (
            <span>
              <MessageSquare size={9} className="mr-1 inline" />
              {kept} kept{withheld > 0 ? `, ${withheld} withheld` : ""}
            </span>
          )}
        </div>

        {/* Which files actually shared this call. batch_size alone says "6" without saying with whom,
            which is the first question anyone debugging a batched review asks. */}
        {siblings.length > 0 && (
          <div className="border-b border-ui-line/60 px-4 py-3 sm:px-5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ui-subtle">
              Shared one model call with
            </p>
            <ul className="flex flex-col gap-1">
              {siblings.map((path) => (
                <li
                  key={path}
                  className="ui-font-mono flex items-center gap-1.5 truncate text-[11px] text-ui-subtle"
                >
                  <Layers size={10} className="shrink-0 opacity-60" />
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}

        {file.fileStatus === "failed" && file.errorMessage && (
          <div
            className="mx-4 mt-4 rounded-md border p-3.5 sm:mx-5"
            style={{
              background: "var(--danger-bg)",
              borderColor: "var(--danger-border)",
            }}
          >
            <p
              className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--danger)" }}
            >
              Review error
            </p>
            <p
              className="ui-font-mono break-all text-xs leading-relaxed"
              style={{ color: "var(--danger)" }}
            >
              {file.errorMessage}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 divide-y divide-ui-line/60 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="flex min-w-0 flex-col gap-2.5 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                Prompt / diff
              </p>
              {file.diffInput && <CopyButton value={file.diffInput} />}
            </div>
            <pre className="code-block thin-scroll max-h-[480px] flex-1 overflow-auto text-[10px] leading-relaxed sm:text-[11px]">
              {/* No leading dash: this pre holds a unified diff, where `- ` is the deletion marker. */}
              {file.diffInput ??
                (diffsLoading ? "Loading…" : "Prompt unavailable")}
            </pre>
          </div>
          <div className="flex min-w-0 flex-col gap-2.5 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              {/* Flagged as shared, or the entries for the other N-1 files read as this file's output. */}
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                Raw model output
                {batchSize ? ` · shared by ${batchSize} files` : ""}
              </p>
              {file.rawAiOutput && <CopyButton value={file.rawAiOutput} />}
            </div>
            <pre className="code-block thin-scroll max-h-[480px] flex-1 overflow-auto text-[10px] leading-relaxed sm:text-[11px]">
              {file.rawAiOutput ?? "No output saved"}
            </pre>
          </div>
        </div>
      </div>
    </details>
  );
}

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
