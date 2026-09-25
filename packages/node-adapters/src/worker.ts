import { Worker, type Job } from "bullmq";
import {
  reviewJobMessageSchema,
  type ReviewJobMessage,
} from "@codraoss/schema";
import { NodeOrchestrator } from "./node-orchestrator";
import type { ReviewRuntime, QueueProducer } from "@codraoss/core/ports";
import type { DbEnv } from "@codraoss/db/env";
import type Redis from "ioredis";

export function startWorker(
  redisConnection: Redis,
  queue: QueueProducer<ReviewJobMessage>,
  createRuntime: () => ReviewRuntime & DbEnv,
  logger: {
    info: (msg: string) => void;
    error: (msg: string, err?: any) => void;
  },
): Worker {
  const worker = new Worker(
    "codra-reviews",
    async (job: Job) => {
      const parseResult = reviewJobMessageSchema.safeParse(job.data);
      if (!parseResult.success) {
        logger.error(
          `[Worker] Invalid job payload for job ${job.id}`,
          parseResult.error,
        );
        throw new Error("Invalid job payload");
      }

      const reviewRuntime = createRuntime();
      const orchestrator = new NodeOrchestrator(reviewRuntime, queue);
      await orchestrator.startReviewJob(job.id ?? "unknown", parseResult.data);
    },
    { connection: redisConnection },
  );

  worker.on("completed", (job) => {
    logger.info(`[Worker] Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`[Worker] Job ${job?.id} failed`, err);
  });

  return worker;
}
