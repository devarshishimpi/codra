import type { QueueProducer } from '@codraoss/core/ports';
import type { Queue } from 'bullmq';

export class RedisQueueAdapter<T> implements QueueProducer<T> {
  constructor(private readonly queue: Queue) {}

  async send(message: T, options?: { delaySeconds?: number }): Promise<void> {
    const jobOptions = options?.delaySeconds
      ? { delay: options.delaySeconds * 1000 }
      : undefined;

    await this.queue.add('review-job', message, jobOptions);
  }
}
