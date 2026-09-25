import type { JobOrchestrator } from "@codraoss/core";
import type { ReviewJobMessage } from "@codraoss/schema";
import { FRESH_INVOCATION_YIELD_SECONDS } from "@codraoss/core";
import { runReviewJob } from "../core/review";
import { setJobWorkflowInstance } from "@codraoss/db/jobs";
import { logger } from "@codraoss/core/logger";
import { runBestEffortJobMaintenance } from "../core/job-recovery";
import type { AppBindings } from "../env";
import type { WorkflowStep } from "cloudflare:workers";

export class CloudflareOrchestrator implements JobOrchestrator {
  constructor(
    private readonly workflow: Workflow,
    private readonly env?: AppBindings,
  ) {}

  async startReviewJob(id: string, params: ReviewJobMessage): Promise<void> {
    await this.workflow.create({
      id,
      params,
    });
  }

  async executeSteps(
    event: { payload: ReviewJobMessage; instanceId: string },
    step: WorkflowStep,
  ) {
    if (!this.env) throw new Error("env is required for execution");
    const params = event.payload;
    const env = this.env;
    const jobId = params.jobId ?? params.deliveryId;

    await step.do("bind-workflow-id", async () => {
      try {
        if (jobId) {
          await setJobWorkflowInstance(env, jobId, event.instanceId);
        }
      } catch (err) {
        logger.warn(
          "Failed to bind workflow ID to job",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    });

    try {
      await step.do("pre-maintenance", async () => {
        await runBestEffortJobMaintenance(env);
      });
    } catch (e) {
      // Ignore maintenance errors
    }

    let phase = params.phase ?? "prepare";
    let delaySeconds = 0;
    let attempt = 0;

    while (phase) {
      attempt++;

      if (delaySeconds > 0) {
        await step.sleep(
          `sleep-${phase}-${attempt}`,
          `${delaySeconds} seconds`,
        );
      }

      const currentPhase = phase;

      let result;
      try {
        result = await step.do(
          `run-${currentPhase}-${attempt}`,
          {
            retries: { limit: 5, delay: "60 seconds", backoff: "exponential" },
            timeout: "15 minutes",
          },
          async () => {
            return await runReviewJob(env, {
              ...params,
              phase: currentPhase,
              workflowInstanceId: event.instanceId,
            });
          },
        );
      } catch (error) {
        await step.do(
          `telemetry-failure-${currentPhase}-${attempt}`,
          async () => {
            const { sendTelemetryEvent } = await import("../core/telemetry");
            await sendTelemetryEvent(env, {
              linesReviewed: 0,
              findingsReported: 0,
              inputTokens: 0,
              outputTokens: 0,
              modelsUsed: [],
              fileExtensions: [],
              triggerType:
                params.eventName === "pull_request" ? "auto" : "mention",
              reviewDurationMs: 0,
              filesReviewed: 0,
              verdict: "failed",
              severityDistribution: {},
              concurrencyLevel: "unknown",
              prTotalLinesChanged: 0,
              retryCount: Math.max(0, attempt - 1),
            });
          },
        );
        throw error;
      }

      if (result.action === "next_phase") {
        if (result.freshInstance) {
          const nextJobId = result.jobId ?? jobId;
          if (nextJobId) {
            const nextPhase = result.phase;
            await step.do(`enqueue-fresh-${nextPhase}-${attempt}`, async () => {
              await env.REVIEW_QUEUE.send({
                jobId: nextJobId,
                deliveryId: crypto.randomUUID(),
                phase: nextPhase,
                forceFreshInstance: true,
              });
            });
            break;
          }
        }
        phase = result.phase;
        delaySeconds = Math.max(
          result.delaySeconds ?? 0,
          FRESH_INVOCATION_YIELD_SECONDS,
        );
      } else if (result.action === "retry") {
        delaySeconds = result.delaySeconds ?? 60;
      } else {
        break;
      }
    }

    await step.sleep(
      "pre-post-maintenance-yield",
      `${FRESH_INVOCATION_YIELD_SECONDS} seconds`,
    );

    try {
      await step.do("post-maintenance", async () => {
        await runBestEffortJobMaintenance(env);
      });
    } catch (e) {
      // Ignore maintenance errors
    }
  }
}
