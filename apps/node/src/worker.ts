import { Worker, type Job } from 'bullmq';
import { reviewJobMessageSchema } from '@codraoss/schema';
import { NodeOrchestrator } from './adapters/node-orchestrator';
import { logger } from '@codraoss/api/logger';
import type { NodeAppBindings } from './env';
import Redis from 'ioredis';
import { createReviewRuntime } from './runtime';

export function startWorker(env: NodeAppBindings, redisUrl: string): Worker {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  
  const worker = new Worker(
    'codra-reviews',
    async (job: Job) => {
      const parseResult = reviewJobMessageSchema.safeParse(job.data);
      if (!parseResult.success) {
        logger.error(`[Worker] Invalid job payload for job ${job.id}`, parseResult.error);
        throw new Error('Invalid job payload');
      }

      const reviewRuntime = createReviewRuntime(env);
      const orchestrator = new NodeOrchestrator(reviewRuntime);
      await orchestrator.startReviewJob(job.id ?? 'unknown', parseResult.data);
    },
    { connection }
  );

  worker.on('completed', (job) => {
    logger.info(`[Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Worker] Job ${job?.id} failed`, err);
  });

  return worker;
}
