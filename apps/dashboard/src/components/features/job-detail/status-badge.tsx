import { Badge } from "@codraoss/ui";
import type { JobSummary } from "@codraoss/schema";
import { LiveReviewStepper } from "@client/components/features/reviews/live-review-stepper";

type BadgeVariant = "success" | "info" | "warning" | "danger" | "neutral";

function getTone(value: string): BadgeVariant {
  switch (value) {
    case "done":
    case "approve":
      return "success";
    case "running":
      return "info";
    case "comment":
      return "warning";
    case "failed":
    case "request_changes":
      return "danger";
    case "queued":
    case "superseded":
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

export function StatusBadge({
  label,
  job,
}: {
  label: string;
  job?: JobSummary;
}) {
  if (job && (label === "running" || label === "queued")) {
    return <LiveReviewStepper job={job} />;
  }

  if (job && label === "done" && job.errorMessage) {
    return (
      <Badge variant="warning" className="capitalize">
        partial
      </Badge>
    );
  }

  return (
    <Badge variant={getTone(label)} className="capitalize">
      {label.replace(/_/g, " ")}
    </Badge>
  );
}
