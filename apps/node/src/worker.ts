import { UnrecoverableError, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { reviewJobMessageSchema } from '@codraoss/schema';
import { logger } from '@codraoss/api/logger';
import { NodeOrchestrator } from './adapters/node-orchestrator';
import type { NodeAppBindings } from './env';
import { REVIEW_QUEUE_NAME } from './queue';

// BullMQ defaults to 1, which lets a single review monopolise the container: the engine sleeps
// in-process between phases and while polling async model batches, and none of that is work the slot
// could not spend on another job. 4 matches the engine's highest admission level; the engine still
// decides how many actually run at once.
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

export interface ReviewWorker {
  worker: Worker;
  close(): Promise<void>;
}

// A review holds its connection for the length of the job, so the worker gets its own rather than
// sharing the producer's: BullMQ issues blocking commands here that would stall the API's enqueues.
export function startWorker(env: NodeAppBindings, redisUrl: string): ReviewWorker {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (err) => logger.error('Worker Redis connection error', err));

  const worker = new Worker(
    REVIEW_QUEUE_NAME,
    async (job: Job) => {
      const parsed = reviewJobMessageSchema.safeParse(job.data);
      if (!parsed.success) {
        // An unparseable payload never becomes valid on a retry, so the job is failed outright
        // rather than spending the backoff schedule on it.
        logger.error('Discarding review job with an invalid payload', {
          jobId: job.id,
          issues: parsed.error.issues,
        });
        throw new UnrecoverableError('Invalid review job payload');
      }

      await new NodeOrchestrator(env).startReviewJob(job.id ?? parsed.data.deliveryId, parsed.data);
    },
    { connection, concurrency: WORKER_CONCURRENCY },
  );

  worker.on('completed', (job) => {
    logger.info('Review job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Review job failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return {
    worker,
    // BullMQ closes the connections it opened itself, never one handed to it, so this disconnects
    // the socket above by hand. Without it the process keeps an open handle after SIGTERM and never
    // exits on its own.
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
