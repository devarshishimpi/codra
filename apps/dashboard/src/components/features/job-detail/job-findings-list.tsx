import { useMemo, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import type { JobDetail, ParsedReviewComment } from "@codraoss/schema";
import { reviewSeverities } from "@codraoss/schema/review-limits";
import { Tabs, TabsList, TabsTrigger } from "@codraoss/ui/motion";
import { FileFinding } from "./file-finding";
import { CommentCard } from "./comment-card";
import { severityConfig } from "./constants";
import { commentKey } from "./diff-file-panel-utils";

interface JobFindingsListProps {
  job: JobDetail;
}

function GroupHeader({
  children,
  count,
  icon,
}: {
  children: ReactNode;
  count: number;
  icon: ReactNode;
}) {
  return (
    <div className="flex h-12 items-center justify-between gap-3 border-b border-ui-line px-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate text-[13px] font-medium text-ui-default">
          {children}
        </span>
      </div>
      <span className="ui-font-mono shrink-0 text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
        {count}
      </span>
    </div>
  );
}

export function JobFindingsList({ job }: JobFindingsListProps) {
  const [viewBy, setViewBy] = useState<"files" | "severity">("files");

  // Only surface files with something to report - findings or a failed review.
  const { filesWithIssues, failedFiles, findingCount, postedCount, filteredCount } =
    useMemo(() => {
      const issues = [];
      const failed = [];
      let totalFindings = 0;
      let postedFindings = 0;

      for (const file of job.files) {
        const commentCount = file.parsedComments.length;
        if (commentCount > 0 || file.fileStatus === "failed") {
          issues.push(file);
        }
        if (file.fileStatus === "failed") {
          failed.push(file);
        }
        totalFindings += commentCount;
        for (const c of file.parsedComments) {
          if (c.posted) postedFindings++;
        }
      }

      return {
        filesWithIssues: issues,
        failedFiles: failed,
        findingCount: totalFindings,
        postedCount: postedFindings,
        filteredCount: totalFindings - postedFindings,
      };
    }, [job.files]);

  // Single-pass grouping by severity for the severity view
  const commentsBySeverity = useMemo(() => {
    const map = new Map<string, Array<ParsedReviewComment & { filePath: string }>>();
    for (const s of reviewSeverities) {
      map.set(s, []);
    }
    for (const file of job.files) {
      for (const comment of file.parsedComments) {
        const list = map.get(comment.severity);
        if (list) {
          list.push({ ...comment, filePath: file.filePath });
        }
      }
    }
    return map;
  }, [job.files]);

  return (
    <div className="ui-font-sans">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText
            size={15}
            strokeWidth={2}
            className="shrink-0 text-ui-default"
          />
          <h2 className="text-[13px] font-medium text-ui-default">Findings</h2>
          {findingCount > 0 && (
            <span className="ui-font-mono text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
              {findingCount}
            </span>
          )}
          {filteredCount > 0 && (
            <span
              className="ui-font-mono text-[11px] leading-none tabular-nums text-ui-subtle"
              title={`${postedCount} posted to the pull request; ${filteredCount} filtered out before posting (low confidence, below the severity threshold, already reported, or dropped by the verification pass).`}
            >
              · {postedCount} posted
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs leading-none text-ui-default dark:text-ui-subtle">
            View by
          </span>
          <Tabs
            value={viewBy}
            onValueChange={(v) => setViewBy(v as "files" | "severity")}
            variant="segment"
          >
            <TabsList className="bg-secondary">
              <TabsTrigger value="files" className="text-xs">
                Files
              </TabsTrigger>
              <TabsTrigger value="severity" className="text-xs">
                Severity
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {viewBy === "files" ? (
        <div className="flex flex-col gap-3">
          {filesWithIssues.length === 0 ? (
            <div className="ui-panel flex flex-col items-center justify-center py-16 text-center">
              <FileText size={32} className="mb-3 text-ui-subtle/30" />
              <p className="text-sm font-medium text-ui-default">No findings</p>
              <p className="mt-1 text-xs text-ui-default dark:text-ui-subtle">
                Codra didn't flag any issues in the reviewed files.
              </p>
            </div>
          ) : (
            filesWithIssues.map((file) => (
              <FileFinding key={file.id} file={file} />
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {failedFiles.length > 0 && (
            <div className="ui-panel min-w-0 overflow-hidden">
              <GroupHeader
                count={failedFiles.length}
                icon={
                  <FileText
                    size={14}
                    strokeWidth={2}
                    className="shrink-0 text-danger"
                  />
                }
              >
                Failed files
              </GroupHeader>
              <div className="flex flex-col gap-3 p-4 sm:p-5">
                {failedFiles.map((file) => (
                  <FileFinding key={file.id} file={file} />
                ))}
              </div>
            </div>
          )}

          {reviewSeverities.map((groupName) => {
            const comments = commentsBySeverity.get(groupName) ?? [];
            if (comments.length === 0) return null;

            const sev = severityConfig[groupName];
            const GroupIcon = sev?.icon ?? FileText;

            return (
              <div key={groupName} className="ui-panel min-w-0 overflow-hidden">
                <GroupHeader
                  count={comments.length}
                  icon={
                    sev?.svg ? (
                      <img
                        src={sev.svg}
                        alt=""
                        className="h-[15px] w-[15px] shrink-0"
                      />
                    ) : (
                      <GroupIcon
                        size={14}
                        strokeWidth={2}
                        className={sev?.iconColor ?? "text-ui-subtle"}
                      />
                    )
                  }
                >
                  {groupName}
                </GroupHeader>
                <div className="flex flex-col gap-3 p-4 sm:p-5">
                  {comments.map((comment, i) => (
                    <CommentCard
                      key={commentKey(comment, i)}
                      comment={comment}
                      filePath={comment.filePath}
                      jobId={job.id}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
