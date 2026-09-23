import type { JobOrchestrator, QueueProducer, ReviewRuntime } from '@codraoss/core';
import type { ReviewJobMessage } from '@codraoss/schema';
import { runReview } from '@codraoss/core';
import { runWithDb } from '@codraoss/db/client';
import type { DbEnv } from '@codraoss/db/env';

export class NodeOrchestrator implements JobOrchestrator {
  constructor(
    private readonly env: ReviewRuntime & DbEnv,
    private readonly queue: QueueProducer<ReviewJobMessage>
  ) {}

  async startReviewJob(id: string, params: ReviewJobMessage): Promise<void> {
    return runWithDb(this.env, async () => {
      const currentParams = { jobId: id, ...params };
      currentParams.phase = currentParams.phase ?? 'prepare';

      const result = await runReview(this.env, currentParams);

      if (result.action === 'next_phase') {
        const nextParams: ReviewJobMessage = {
          ...currentParams,
          phase: result.phase,
        };
        if (result.jobId) {
          nextParams.jobId = result.jobId;
        }
        await this.queue.send(nextParams, { delaySeconds: result.delaySeconds });
      } else if (result.action === 'retry') {
        await this.queue.send(currentParams, { delaySeconds: result.delaySeconds });
      } else if (result.action === 'ack') {
        // Job is done, nothing to enqueue
      }
    });
  }
}
