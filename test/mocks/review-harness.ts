import { runReviewJob } from "@server/core/review";
import { runWithDb, queryRows } from "@codraoss/db/client";
import type { AppBindings } from "@server/env";

// Drives a review job through every phase the way the workflow would, in-process.
//
// Shared by the review-flow suites, which are split across files so they run in parallel rather
// than one after another. `runReviewJob` is the entry point; each `next_phase` result is fed back
// in until the job reaches a terminal action.
export function makeRunAndDrain(env: AppBindings) {
  return async function runAndDrain(
    message: Parameters<typeof runReviewJob>[1],
  ) {
    await runWithDb(env, async () => {
      let currentMessage: typeof message | null = message;
      // A wedged job would otherwise spin here forever; every real run settles in a handful of
      // phases, so anything past this is a bug in the phase machine rather than a slow test.
      let phases = 0;
      const MAX_PHASES = 20;

      while (currentMessage) {
        if ((phases += 1) > MAX_PHASES)
          throw new Error("Phase loop did not terminate");
        const result = await runReviewJob(env, currentMessage);
        if (result.action === "next_phase") {
          currentMessage = { ...currentMessage, phase: result.phase };
          // Phase transitions schedule the next delivery into the future (last_queue_message_at).
          // We don't actually wait in-process, so backdate it or the next claim reports 'busy'.
          const jobId = (currentMessage as { jobId?: string }).jobId;
          const repo = (
            currentMessage as { payload?: { repository?: { name?: string } } }
          ).payload?.repository?.name;
          if (jobId) {
            await queryRows(
              env,
              `UPDATE jobs SET last_queue_message_at = now() - interval '5 seconds' WHERE id = $1`,
              [jobId],
            );
          } else if (repo) {
            await queryRows(
              env,
              `UPDATE jobs SET last_queue_message_at = now() - interval '5 seconds' WHERE repository_id IN (SELECT id FROM repositories WHERE repo = $1)`,
              [repo],
            );
          }
        } else if (result.action === "retry") {
          // A test that expects a retry asserts on the direct return value instead of draining,
          // so stopping here just prevents an infinite loop.
          break;
        } else {
          currentMessage = null;
        }
      }
    });
  };
}

// Every review-flow test drives a full multi-phase job against a real database.
export const REVIEW_FLOW_TIMEOUT_MS = 60_000;
