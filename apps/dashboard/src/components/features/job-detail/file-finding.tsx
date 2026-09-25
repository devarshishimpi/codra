import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight } from "lucide-react";
import type { FileReviewRecord, ParsedReviewComment } from "@codraoss/schema";
import { CommentCard } from "./comment-card";
import { preventToggleOnTextSelection } from "@codraoss/ui/selection";
import { MonoPath, StatusDot, VerdictPill } from "./job-chips";
import { statusLabel } from "./job-chip-utils";

import { safeRehypePlugins } from "@codraoss/ui/markdown-plugins";
interface FileFindingProps {
  file: FileReviewRecord;
}

export function FileFinding({ file }: FileFindingProps) {
  const count = file.parsedComments.length;

  return (
    <details
      key={file.id}
      className="ui-panel ui-font-sans group min-w-0 overflow-hidden"
    >
      {/* Selection is allowed (not `select-none`) so the file path can be copied; this guard just
          stops a drag-select from also collapsing the panel on mouse-up. */}
      <summary
        onClick={preventToggleOnTextSelection}
        className="flex h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 transition-colors hover:bg-ui-fill/40 [&::-webkit-details-marker]:hidden sm:px-5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight
            size={14}
            className="shrink-0 text-ui-subtle transition-transform group-open:rotate-90"
          />
          <MonoPath path={file.filePath} />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-2">
            <StatusDot status={file.fileStatus} />
            <span className="text-[13px] leading-none text-ui-default">
              {statusLabel(file.fileStatus)}
            </span>
          </span>

          {file.fileStatus === "done" && (
            <VerdictPill verdict={file.verdict ?? "comment"} />
          )}

          {count > 0 && (
            <span
              className="ui-font-mono text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle"
              title={`${count} ${count === 1 ? "finding" : "findings"}`}
            >
              {count}
            </span>
          )}
        </div>
      </summary>

      <div className="border-t border-ui-line px-4 pb-5 pt-4 sm:px-5">
        {file.fileStatus === "failed" && file.errorMessage && (
          <div className="mb-4 rounded-md border border-danger-border bg-danger-bg px-3 py-2.5">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium leading-none text-danger">
              <StatusDot status="failed" />
              Review error
            </p>
            <p className="ui-font-mono break-all text-xs leading-relaxed text-danger">
              {file.errorMessage}
            </p>
          </div>
        )}

        {file.fileStatus === "done" && file.fileSummary && (
          <div className="ui-well mb-4 rounded-md px-4 py-3">
            <p className="mb-1 text-xs leading-none text-ui-default dark:text-ui-subtle">
              Model summary
            </p>
            <div className="prose prose-sm max-w-none leading-relaxed text-foreground/90">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={safeRehypePlugins}
              >
                {file.fileSummary}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {count > 0 && (
          <div>
            <p className="mb-3 text-xs leading-none text-ui-default dark:text-ui-subtle">
              Inline comments ({count})
            </p>
            <div className="flex flex-col gap-3">
              {file.parsedComments.map(
                (comment: ParsedReviewComment, index: number) => (
                  <CommentCard
                    key={`${file.id}-${index}`}
                    comment={comment}
                    filePath={file.filePath}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
