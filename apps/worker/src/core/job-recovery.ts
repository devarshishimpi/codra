import type { AppBindings } from "../env";
import {
  getTerminalJobsNeedingCheckRunCompletion,
  markJobCheckRunCompleted,
  recoverExpiredJobLeases,
} from "@codraoss/db/jobs";
import { logger } from "./logger";
import { GitHubService } from "@codraoss/provider-github";

const MAX_RECOVERY_COUNT = 3;

export async function recoverJobs(env: AppBindings) {
  try {
    const recovered = await recoverExpiredJobLeases(env, MAX_RECOVERY_COUNT);
    // Sent one at a time on purpose: the recovery query returns up to 25 ids and each send is a
    // subrequest, so fanning out would spend the invocation's budget the maintenance tick shares
    // with completeTerminalCheckRuns below.
    for (const jobId of recovered.requeuedJobIds) {
      await env.REVIEW_QUEUE.send({
        jobId,
        deliveryId: crypto.randomUUID(),
        phase: "review",
        // Old Workflow instance (keyed on jobId) is dead but still exists, so force a fresh instance keyed on deliveryId instead of climbing recovery_count.
        forceFreshInstance: true,
      });
    }

    if (
      recovered.requeuedJobIds.length > 0 ||
      recovered.failedJobs.length > 0
    ) {
      logger.warn("Expired job leases recovered", {
        requeued: recovered.requeuedJobIds.length,
        failed: recovered.failedJobs.length,
      });
    }
  } catch (err) {
    logger.error(
      "Failed to recover expired job leases",
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

export async function completeTerminalCheckRuns(env: AppBindings) {
  // Limit to 1: each job needs multiple subrequests (KV, GitHub API, Hyperdrive), close to Cloudflare's 50/invocation cap.
  const jobs = await getTerminalJobsNeedingCheckRunCompletion(env, 1);
  for (const job of jobs) {
    if (!job.check_run_id) continue;

    try {
      const github = new GitHubService(env, job.installation_id);

      let conclusion: "success" | "neutral" | "failure" | "cancelled";
      let title: string;
      let summary: string;
      if (job.status === "done") {
        // Inline check-run update may not have landed (e.g. finalize ran out of subrequest budget); reconstruct the conclusion finalize would have posted.
        const partial = (job.error_msg ?? "").startsWith("Partial review");
        conclusion = partial
          ? "failure"
          : job.verdict === "approve"
            ? "success"
            : "neutral";
        title = partial
          ? "Review partially failed"
          : job.verdict === "approve"
            ? "LGTM"
            : "Comments posted";
        summary =
          job.error_msg ??
          `${job.comment_count ?? 0} inline comments across ${job.file_count ?? 0} files.`;
      } else {
        const checkRunPresentation = {
          superseded: {
            conclusion: "neutral" as const,
            title: "Review superseded",
            summary: "Superseded by a newer commit or job.",
          },
          cancelled: {
            conclusion: "cancelled" as const,
            title: "Review stopped",
            summary: "Stopped by user.",
          },
          failed: {
            conclusion: "failure" as const,
            title: "Review failed",
            summary: "Review failed.",
          },
        };
        const presentation =
          checkRunPresentation[
            job.status as keyof typeof checkRunPresentation
          ] ?? checkRunPresentation.failed;
        conclusion = presentation.conclusion;
        title = presentation.title;
        summary = job.error_msg ?? presentation.summary;
      }

      await github.updateCheckRun(job.owner, job.repo, job.check_run_id, {
        status: "completed",
        conclusion,
        title,
        summary,
      });
      await markJobCheckRunCompleted(env, job.id);
    } catch (error) {
      logger.error(
        `Failed to complete terminal check run for job ${job.id}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

export async function runOpportunisticJobMaintenance(env: AppBindings) {
  await recoverJobs(env);
  await completeTerminalCheckRuns(env);
}

export async function runBestEffortJobMaintenance(env: AppBindings) {
  try {
    await runOpportunisticJobMaintenance(env);
  } catch (error) {
    logger.error(
      "Opportunistic job maintenance failed",
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

export function scheduleBestEffortJobMaintenance(
  env: AppBindings,
  executionCtx?: Pick<ExecutionContext, "waitUntil">,
) {
  const task = runBestEffortJobMaintenance(env);
  if (executionCtx) {
    executionCtx.waitUntil(task);
  }
}
