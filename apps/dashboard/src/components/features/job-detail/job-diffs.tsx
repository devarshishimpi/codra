import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff as FileDiffIcon,
  GitCommitHorizontal,
  Info,
} from "lucide-react";
import { api } from "@client/lib/api";
import { buildTree } from "@codraoss/ui/file-tree";
import { diffStats } from "@codraoss/ui/prompt-diff";
import { readDiffsCache, writeDiffsCache } from "@client/lib/diffs-cache";
import type { FileReviewRecord, JobDetail } from "@codraoss/schema";

import { FileDiff } from "./diff-file-panel";
import { panelCvStyle, fileAnchorId } from "./diff-file-panel-utils";
import { FileTree } from "./diff-file-tree";
/** A file present in the PR diff with no review row yet (job still running or file skipped) - shown as pending, GitHub-style. */
function syntheticFileReview(
  jobId: string,
  filePath: string,
  diffInput: string,
): FileReviewRecord {
  return {
    id: `diff-only:${filePath}`,
    jobId,
    filePath,
    fileStatus: "pending",
    modelUsed: "",
    diffLineCount: null,
    diffInput,
    rawAiOutput: null,
    parsedComments: [],
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    verdict: null,
    fileSummary: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
  };
}

// Above this many files, only files with review comments start expanded, so a huge PR opens short.
const AUTO_EXPAND_FILE_LIMIT = 8;

interface JobDiffsProps {
  job: JobDetail;
}

export function JobDiffs({ job }: JobDiffsProps) {
  const [diffsByPath, setDiffsByPath] = useState<Record<string, string> | null>(
    () => readDiffsCache(job.id),
  );
  const [diffsLoading, setDiffsLoading] = useState(diffsByPath === null);

  useEffect(() => {
    let cancelled = false;
    setDiffsLoading(true);
    api
      .getJobDiffs(job.id)
      .then((res) => {
        if (cancelled) return;
        setDiffsByPath(res.diffs);
        writeDiffsCache(job.id, res.diffs);
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
  }, [job.id]);

  // Every file in the PR diff merged with review rows where they exist, sorted by path like GitHub.
  const files = useMemo(() => {
    const merged = job.files.map((f) =>
      diffsByPath?.[f.filePath]
        ? { ...f, diffInput: diffsByPath[f.filePath] }
        : f,
    );
    if (diffsByPath) {
      const known = new Set(job.files.map((f) => f.filePath));
      for (const [path, diff] of Object.entries(diffsByPath)) {
        if (!known.has(path))
          merged.push(syntheticFileReview(job.id, path, diff));
      }
    }
    return merged.sort((a, b) => a.filePath.localeCompare(b.filePath));
  }, [job.id, job.files, diffsByPath]);

  // Computed once per diff change and reused everywhere (header counts, tree, totals, panel size estimates).
  const statsByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof diffStats>>();
    for (const file of files) map.set(file.filePath, diffStats(file.diffInput));
    return map;
  }, [files]);

  const [viewedFiles, setViewedFiles] = useState<Set<string>>(() => new Set());
  // Open state is an override on top of a default rule, so late-arriving files still get sensible defaults.
  const [openOverrides, setOpenOverrides] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const isLargePr = files.length > AUTO_EXPAND_FILE_LIMIT;
  const isOpen = (file: FileReviewRecord) =>
    openOverrides.get(file.id) ??
    (!isLargePr || file.parsedComments.length > 0);

  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  // Single-file mode: render one diff at a time - the fast path for huge PRs.
  const [singleFileMode, setSingleFileMode] = useState(false);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const tree = useMemo(() => buildTree(files), [files]);

  const totals = useMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const s of statsByPath.values()) {
      adds += s.adds;
      dels += s.dels;
    }
    return { adds, dels };
  }, [statsByPath]);

  const setOpen = (id: string, open: boolean) =>
    setOpenOverrides((current) => new Map(current).set(id, open));

  const setViewed = (id: string, viewed: boolean) =>
    setViewedFiles((current) => {
      const next = new Set(current);
      if (viewed) next.add(id);
      else next.delete(id);
      return next;
    });

  const jumpToFile = (file: FileReviewRecord) => {
    setSelectedFileId(file.id);
    setOpen(file.id, true);
    if (singleFileMode) return; // the single panel swaps in place, nothing to scroll to
    requestAnimationFrame(() => {
      fileRefs.current
        .get(file.id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const currentIndex = Math.max(
    0,
    files.findIndex((f) => f.id === selectedFileId),
  );
  const currentFile = files[currentIndex];
  const stepFile = (delta: number) => {
    const next = files[currentIndex + delta];
    if (next) jumpToFile(next);
  };

  const allOpen = files.every((f) => isOpen(f));
  const toggleAll = () =>
    setOpenOverrides(new Map(files.map((f) => [f.id, !allOpen])));

  const toggleDir = (path: string) =>
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (files.length === 0) {
    return (
      <div className="ui-panel flex flex-col items-center justify-center py-16 text-center">
        <FileDiffIcon size={32} className="mb-3 text-ui-subtle/30" />
        <p className="text-sm font-medium text-ui-default">No file diffs yet</p>
        <p className="mt-1 text-xs text-ui-subtle">
          Diffs appear here as files are reviewed.
        </p>
      </div>
    );
  }

  return (
    // Fixed viewport math doesn't work here: the row starts below the header and tabs, so
    // `100svh - <constant>` overshot and forced the whole page to scroll even for three files.
    <div className="flex min-h-0 min-w-0 flex-1 gap-4">
      <aside className="ui-panel hidden h-full w-72 shrink-0 flex-col overflow-hidden lg:flex xl:w-80">
        <div className="flex items-center gap-2 border-b border-ui-line px-4 py-3">
          <FileDiffIcon
            size={15}
            strokeWidth={2}
            className="shrink-0 text-ui-default"
          />
          <h2 className="text-[13px] font-medium text-ui-default">Files</h2>
          <span className="ui-font-mono ml-auto text-[11px] tabular-nums text-ui-subtle">
            {files.length}
          </span>
        </div>
        <div
          className="h-[3px] w-full shrink-0 bg-ui-fill"
          role="progressbar"
          aria-valuenow={viewedFiles.size}
          aria-valuemin={0}
          aria-valuemax={files.length}
          aria-label="Files marked viewed"
        >
          <div
            className="h-full bg-[var(--btn-primary-bg)] transition-[width] duration-500 ease-out"
            style={{ width: `${(viewedFiles.size / files.length) * 100}%` }}
          />
        </div>
        <div className="diff-tree diff-tree-scroll min-h-0 flex-1 overflow-y-auto py-2 pl-2 pr-1">
          <FileTree
            nodes={tree}
            collapsedDirs={collapsedDirs}
            viewedFiles={viewedFiles}
            selectedFileId={
              singleFileMode ? (currentFile?.id ?? null) : selectedFileId
            }
            onToggleDir={toggleDir}
            onSelectFile={jumpToFile}
          />
        </div>
        <div className="ui-well border-t border-ui-line px-4 py-2">
          <p className="ui-font-mono text-[10px] tabular-nums text-ui-subtle">
            {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
            <span className="diff-add-fg">+{totals.adds}</span>{" "}
            <span className="diff-del-fg">-{totals.dels}</span>
          </p>
        </div>
      </aside>

      {/* Scrolls itself rather than growing the page, which is what keeps the tree beside it full height. */}
      <div className="auto-hide-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
        {isLargePr && (
          <div className="ui-panel flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
            <Info size={14} className="shrink-0 text-ui-subtle" />
            <p className="min-w-0 flex-1 text-xs text-ui-subtle">
              This view has been optimized for large pull requests, files start
              collapsed and offscreen diffs render lazily.
            </p>
            <button
              type="button"
              onClick={() => setSingleFileMode((v) => !v)}
              className="shrink-0 text-xs font-medium text-primary transition-opacity hover:opacity-80"
            >
              {singleFileMode ? "Show all files" : "Switch to single file mode"}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
          <span className="flex items-center gap-1.5 text-xs text-ui-subtle">
            <GitCommitHorizontal size={13} />
            {singleFileMode
              ? `File ${currentIndex + 1} of ${files.length}`
              : `${files.length} ${files.length === 1 ? "file" : "files"}`}
          </span>
          <span className="ui-font-mono text-xs tabular-nums">
            <span className="diff-add-fg">+{totals.adds}</span>{" "}
            <span className="diff-del-fg">-{totals.dels}</span>
          </span>
          <span className="ml-auto text-xs tabular-nums text-ui-subtle">
            {viewedFiles.size} / {files.length} viewed
          </span>
          {singleFileMode ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => stepFile(-1)}
                disabled={currentIndex === 0}
                aria-label="Previous file"
                className="flex h-6 w-6 items-center justify-center rounded-md border border-ui-line text-ui-subtle transition-colors hover:bg-ui-fill/60 hover:text-ui-default disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronLeft size={13} />
              </button>
              <button
                type="button"
                onClick={() => stepFile(1)}
                disabled={currentIndex >= files.length - 1}
                aria-label="Next file"
                className="flex h-6 w-6 items-center justify-center rounded-md border border-ui-line text-ui-subtle transition-colors hover:bg-ui-fill/60 hover:text-ui-default disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-1.5 rounded-md border border-ui-line px-2 py-1 text-[11px] font-medium text-ui-subtle transition-colors hover:bg-ui-fill/60 hover:text-ui-default"
            >
              {allOpen ? (
                <ChevronsDownUp size={12} />
              ) : (
                <ChevronsUpDown size={12} />
              )}
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>

        {singleFileMode && currentFile ? (
          // One diff at a time - only the current file exists in the DOM.
          <FileDiff
            key={currentFile.id}
            file={currentFile}
            open
            viewed={viewedFiles.has(currentFile.id)}
            diffsLoading={diffsLoading}
            onOpenChange={() => {}}
            onToggleViewed={(viewed) => {
              setViewed(currentFile.id, viewed);
              // Marking viewed advances to the next file, GitHub-style.
              if (viewed) stepFile(1);
            }}
          />
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              id={fileAnchorId(file.id)}
              style={panelCvStyle(
                isOpen(file),
                statsByPath.get(file.filePath)?.total ?? 0,
              )}
              ref={(el) => {
                if (el) fileRefs.current.set(file.id, el);
                else fileRefs.current.delete(file.id);
              }}
            >
              <FileDiff
                file={file}
                open={isOpen(file)}
                viewed={viewedFiles.has(file.id)}
                diffsLoading={diffsLoading}
                onOpenChange={(open) => setOpen(file.id, open)}
                onToggleViewed={(viewed) => setViewed(file.id, viewed)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
