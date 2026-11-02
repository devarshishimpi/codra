import {
  CircleSlash,
  History,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@codraoss/ui/utils";
import type { JobDetail } from "@codraoss/schema";

interface JobStatusNoticeProps {
  job: JobDetail;
}

type Tone = "danger" | "warning" | "neutral";

interface Notice {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  /** Plain-language explanation of what happened. */
  hint: string;
  /** Raw server message, shown as a mono block only when it adds something the hint doesn't. */
  detail?: string | null;
}

// Icon tile + border tone per notice kind. Neutral outcomes (superseded/stopped) deliberately
// avoid red: nothing went wrong, the run just stopped mattering.
const TONE: Record<Tone, { tile: string; icon: string; detail: string }> = {
  danger: {
    tile: "border-danger-border bg-danger-bg",
    icon: "text-danger",
    detail: "border-danger-border/60 bg-danger-bg text-danger",
  },
  warning: {
    tile: "border-warning-border bg-warning-bg",
    icon: "text-warning",
    detail: "border-warning-border/60 bg-warning-bg text-warning",
  },
  neutral: {
    tile: "border-ui-line bg-ui-fill/40",
    icon: "text-ui-default",
    detail: "border-ui-line ui-well text-ui-subtle",
  },
};

function describe(job: JobDetail): Notice | null {
  const message = job.errorMessage?.trim() || null;

  if (job.status === "done" && message?.startsWith("Partial review:")) {
    return {
      tone: "warning",
      icon: TriangleAlert,
      title: "Partial review",
      hint: "Codra posted a review, but not every file made it in.",
      detail: message.replace(/^Partial review:\s*/, ""),
    };
  }

  if (job.status === "superseded") {
    return {
      tone: "neutral",
      icon: History,
      title: "Superseded",
      hint: "A newer commit or review took over this pull request before this run finished, so it was retired. The latest review for this PR has the current results.",
    };
  }

  if (job.status === "cancelled" || job.status === "stopped") {
    return {
      tone: "neutral",
      icon: CircleSlash,
      title: job.status === "stopped" ? "Review stopped" : "Review cancelled",
      hint: "This run ended before it finished, so any files below are only the ones reviewed up to that point. Re-run it from the header to start over.",
      detail: message,
    };
  }

  if (job.status === "failed") {
    return {
      tone: "danger",
      icon: OctagonAlert,
      title: "Review failed",
      hint: "Codra could not finish this review. Retry it from the header once the cause below is addressed.",
      detail: message,
    };
  }

  // Any other status that still carries a message (e.g. a recovered run) shouldn't swallow it.
  if (message) {
    return {
      tone: "danger",
      icon: OctagonAlert,
      title: "Something went wrong",
      hint: "The run reported a problem:",
      detail: message,
    };
  }

  return null;
}

/**
 * Page-level banner for a run's terminal outcome, rather than a cramped box inside the Job
 * details rows: failures read as failures, and superseded/stopped read as neutral facts.
 */
export function JobStatusNotice({ job }: JobStatusNoticeProps) {
  const notice = describe(job);
  if (!notice) return null;

  const { tone, icon: Icon, title, hint, detail } = notice;
  const styles = TONE[tone];

  return (
    <section
      role={tone === "danger" ? "alert" : "status"}
      className="ui-panel ui-font-sans min-w-0 p-3.5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
            styles.tile,
          )}
        >
          <Icon size={15} strokeWidth={2} className={styles.icon} />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-medium text-ui-default">{title}</h2>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-ui-subtle">
            {hint}
          </p>

          {detail && (
            <p
              className={cn(
                "ui-font-mono mt-2.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-[11px] leading-relaxed",
                styles.detail,
              )}
            >
              {detail}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
