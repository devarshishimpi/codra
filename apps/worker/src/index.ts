import { createApiRouter } from "@codraoss/api";
import { createApiRouterDeps } from "./api-deps";
import { ReviewWorkflow } from "./workflows/review";
import type { AppBindings } from "./env";
import { reviewJobMessageSchema } from "@codraoss/schema";
import { logger } from "./core/logger";
import { disposeRpc } from "./core/rpc";
import { runWithDb } from "@codraoss/db/client";
import {
  failJob,
  hasPendingMaintenanceWork,
  clearSystemActive,
} from "@codraoss/db/jobs";
import { runBestEffortJobMaintenance } from "./core/job-recovery";

const app = createApiRouter();

export { ReviewWorkflow };

export default {
  fetch(request: Request, env: AppBindings, ctx: ExecutionContext) {
    const apiEnv = {
      ...env,
      deps: createApiRouterDeps(env, ctx),
    };
    return runWithDb(env, () => app.fetch(request, apiEnv as any, ctx));
  },

  async scheduled(
    _controller: ScheduledController,
    env: AppBindings,
    _ctx: ExecutionContext,
  ) {
    // Gate on KV flag: avoids waking the serverless DB every 2min tick when nothing's pending.
    try {
      const active = await env.APP_KV.get("system:active_jobs");
      if (!active) {
        return;
      }
    } catch (error) {
      logger.warn(
        "Failed to read active jobs flag from KV, proceeding with maintenance",
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    return runWithDb(env, async () => {
      await runBestEffortJobMaintenance(env);
      // Clear flag early so next tick skips DB instead of waiting for TTL.
      try {
        if (!(await hasPendingMaintenanceWork(env))) {
          await clearSystemActive(env);
        }
      } catch (error) {
        logger.warn(
          "Failed to evaluate pending maintenance work; leaving active-jobs flag to expire via TTL",
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  },

  async queue(
    batch: MessageBatch<unknown>,
    env: AppBindings,
    _ctx: ExecutionContext,
  ) {
    return runWithDb(env, async () => {
      try {
        await runBestEffortJobMaintenance(env);
      } catch (error) {
        logger.error(
          "Pre-batch maintenance task failed",
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      // Sequential: parallel fan-out could breach the Free plan subrequest cap.
      for (const message of batch.messages) {
        const parseResult = reviewJobMessageSchema.safeParse(message.body);

        if (!parseResult.success) {
          logger.error("Invalid queue message schema; dropping message", {
            body: message.body,
            error: parseResult.error.flatten(),
          });
          // Ack (retry won't help); fail the job too, since lease recovery only revives 'running' rows.
          const strandedId = (message.body as { jobId?: unknown })?.jobId;
          if (
            typeof strandedId === "string" &&
            /^[0-9a-f-]{36}$/i.test(strandedId)
          ) {
            try {
              await failJob(
                env,
                strandedId,
                "Review dropped: the queue message failed schema validation.",
              );
            } catch (failError) {
              logger.error(
                "Failed to fail job stranded by an invalid queue message",
                failError instanceof Error
                  ? failError
                  : new Error(String(failError)),
              );
            }
          }
          message.ack();
          continue;
        }

        const { jobId, deliveryId, forceFreshInstance } = parseResult.data;

        try {
          // forceFreshInstance keys on deliveryId (UUID) to avoid instance.already_exists on the dead jobId-keyed instance.
          const id = forceFreshInstance ? deliveryId : (jobId ?? deliveryId);
          if (!id) {
            logger.error("Message missing identifiers; dropping", {
              body: message.body,
            });
            message.ack();
            continue;
          }
          // The returned handle is an RPC stub and this path never uses it; see core/rpc.ts.
          disposeRpc(
            await env.REVIEW_WORKFLOW.create({
              id,
              params: parseResult.data,
            }),
          );
          message.ack();
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("instance.already_exists")
          ) {
            logger.info(
              "Workflow instance already exists; dropping duplicate queue message.",
              {
                jobId,
                deliveryId,
              },
            );
            message.ack();
            continue;
          }

          logger.error(
            "Failed to create workflow",
            error instanceof Error ? error : new Error(String(error)),
          );
          if (message.attempts >= 3) {
            const id = jobId ?? deliveryId;
            if (id) {
              try {
                await failJob(
                  env,
                  id,
                  "Failed to start Cloudflare Workflow after multiple attempts. The Cloudflare infrastructure might be experiencing an outage.",
                );
              } catch (failError) {
                logger.error(
                  "Critical: Failed to mark job as failed in DB",
                  failError instanceof Error
                    ? failError
                    : new Error(String(failError)),
                );
              }
            }
            message.ack();
          } else {
            message.retry();
          }
        }
      }

      try {
        await runBestEffortJobMaintenance(env);
      } catch (error) {
        logger.error(
          "Post-batch maintenance task failed",
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  },
} satisfies ExportedHandler<AppBindings>;
