import type { JobSummary } from "@codraoss/schema";

interface LiveReviewStepperProps {
  job: JobSummary;
}

const styles: Record<string, string> = {
  running: "bg-info/10 text-info border-info/20",
  queued: "bg-secondary text-muted-foreground border-border/60",
  done: "bg-success/10 text-success border-success/20",
  failed: "bg-danger/10 text-danger border-danger/20",
  superseded: "bg-secondary text-muted-foreground border-border/40",
};

export function LiveReviewStepper({ job }: LiveReviewStepperProps) {
  const { status, steps = [] } = job;

  let activeLabel = "";

  if (status === "queued") {
    activeLabel = "Queued";
  } else if (status === "done") {
    activeLabel = "Done";
  } else if (status === "failed") {
    const failedStep = steps.find((s) => s.status === "failed");
    if (
      failedStep &&
      ["Initializing", "Fetching Diff"].includes(failedStep.name)
    ) {
      activeLabel = "Scan failed";
    } else if (
      failedStep &&
      ["Reviewing Files", "Generating Summary"].includes(failedStep.name)
    ) {
      activeLabel = "Review failed";
    } else {
      activeLabel = "Failed";
    }
  } else if (status === "running") {
    const runningStep = steps.find((s) => s.status === "running");
    if (
      !runningStep ||
      ["Initializing", "Fetching Diff"].includes(runningStep.name)
    ) {
      activeLabel = "Scanning";
    } else if (runningStep.name === "Reviewing Files") {
      activeLabel = "Reviewing";
    } else if (runningStep.name === "Generating Summary") {
      activeLabel = "Summarising";
    } else if (runningStep.name === "Completing") {
      activeLabel = "Finishing";
    } else {
      activeLabel = "Running";
    }
  } else if (status === "superseded") {
    activeLabel = "Superseded";
  }

  const cls = styles[status] ?? styles.queued;

  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-semibold border tracking-wide ${cls}`}
    >
      {activeLabel}
    </span>
  );
}
