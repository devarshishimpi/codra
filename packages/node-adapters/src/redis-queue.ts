import type { QueueProducer } from '@codraoss/core/ports';
import type { Queue } from 'bullmq';

export class RedisQueueAdapter<T> implements QueueProducer<T> {
  constructor(private readonly queue: Queue) {}

  async send(message: T, options?: { delaySeconds?: number; jobId?: string }): Promise<void> {
    const jobOptions: any = options?.jobId ? { jobId: options.jobId } : {};
    if (options?.delaySeconds) {
      jobOptions.delay = options.delaySeconds * 1000;
    }

    await this.queue.add('review-job', message, jobOptions);
  }

  async deleteJob(jobId: string): Promise<void> {
    const bullMqJob = await this.queue.getJob(jobId);
    if (bullMqJob) {
      await bullMqJob.remove();
    }
  }
}
