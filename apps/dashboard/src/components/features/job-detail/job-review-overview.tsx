import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, ClipboardList, TriangleAlert } from "lucide-react";
import type { JobDetail } from "@codraoss/schema";
import { reviewSeverities } from "@codraoss/schema/review-limits";
import { OutlinePill } from "./job-chips";

import { safeRehypePlugins } from "@codraoss/ui/markdown-plugins";
interface JobReviewOverviewProps {
  job: JobDetail;
}

export function JobReviewOverview({ job }: JobReviewOverviewProps) {
  const hasOverview = !!(
    job.summaryMarkdown ||
    job.overallCorrectness ||
    (job.overallConfidenceScore !== undefined &&
      job.overallConfidenceScore !== null)
  );
  if (!hasOverview) return null;

  const allComments = job.files.flatMap((f) => f.parsedComments);
  const sevCounts = Object.fromEntries(
    reviewSeverities.map((s) => [
      s,
      allComments.filter((c) => c.severity === s).length,
    ]),
  );

  const renderSummary = () => {
    if (!job.summaryMarkdown) return "";
    const content = job.summaryMarkdown
      .replace(/^(✅ \*\*Approved\*\*|💬 \*\*Comments posted\*\*)\n\n/, "")
      .trim();

    // Strip only the "### ... Codra Review" heading, keep the intro sentence
    const stripHeader = (md: string) =>
      md
        .replace(
          /^###\s*(<picture>[\s\S]*?<\/picture>|💡)\s*Codra Review\s*\n+/,
          "",
        )
        .trim();

    if (
      content.startsWith("### 💡 Codra Review") ||
      content.includes("Codra Review")
    ) {
      return stripHeader(content);
    }

    const shortSha = job.commitSha.slice(0, 10);
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

    return `Here are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${shortSha}\`\n\n<details>\n<summary>ℹ️ About Codra</summary>\n\n<br/>\n\n[Your team has set up Codra to review pull requests in this repo](${baseUrl}/repos). Reviews are triggered when you:\n\n- **Open** a pull request for review\n- **Mark** a draft as ready\n- **Comment** "@codra-app review"\n\nIf Codra has suggestions, it will comment; otherwise it will react with 👍.\n\nCodra can also answer questions or update the PR. Try commenting "@codra-app address that feedback".\n\n</details>\n\n---\n\n${content}`;
  };

  return (
    <div className="ui-panel ui-font-sans min-w-0 overflow-hidden p-3.5">
      <div className="flex flex-col items-start justify-between gap-3 px-0.5 sm:flex-row sm:items-center sm:gap-0">
        <div className="flex items-center gap-2">
          <ClipboardList
            size={15}
            strokeWidth={2}
            className="shrink-0 text-ui-default"
          />
          <h2 className="text-[13px] font-medium text-ui-default">
            Review overview
          </h2>
        </div>
        {/* Correctness and confidence read as chips: neutral border, colour only in the leading icon. */}
        <div className="flex items-center gap-3">
          {job.overallCorrectness &&
            (() => {
              const incorrect = job.overallCorrectness
                .toLowerCase()
                .includes("incorrect");
              return (
                <OutlinePill
                  icon={incorrect ? TriangleAlert : CheckCircle2}
                  tone={incorrect ? "text-danger" : "text-success"}
                >
                  <span className="capitalize">{job.overallCorrectness}</span>
                </OutlinePill>
              );
            })()}
          {job.overallConfidenceScore !== undefined &&
            job.overallConfidenceScore !== null && (
              <span className="flex items-center gap-1.5">
                <span className="text-xs leading-none text-ui-default dark:text-ui-subtle">
                  Confidence
                </span>
                <span className="ui-font-mono text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
                  {(Number(job.overallConfidenceScore) * 100).toFixed(0)}%
                </span>
              </span>
            )}
        </div>
      </div>

      {/* Recessed inner panel (same as the dashboard stat cards); markdown's own leading/trailing
          block margins are zeroed so the well padding alone controls the gap. */}
      <div className="ui-well mt-3 rounded-md px-5 py-4.5">
        <div className="prose max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={safeRehypePlugins}
          >
            {renderSummary()}
          </ReactMarkdown>
        </div>
      </div>

      {/* Footer sits on the card face, mirroring the stat cards' delta row. */}
      <div className="px-0.5 pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-xs leading-none text-ui-default dark:text-ui-subtle">
            Priority triage
          </p>
          {reviewSeverities.map((sev) => {
            const count = sevCounts[sev] || 0;
            if (count === 0 && sev !== "nit") return null;

            return (
              <div key={sev} className="flex items-center gap-1.5">
                <span
                  className={`severity-tag ${sev} ${count === 0 ? "opacity-40" : ""}`}
                >
                  {sev}
                </span>
                <span className="ui-font-mono text-[11px] leading-none tabular-nums text-ui-default dark:text-ui-subtle">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
