import type { JobOrchestrator, ReviewRuntime } from '@codraoss/core';
import type { ReviewJobMessage } from '@codraoss/schema';
import { runReview } from '@codraoss/core';
import { runWithDb } from '@codraoss/db/client';
import type { DbEnv } from '@codraoss/db/env';
import { setTimeout } from 'node:timers/promises';

export class NodeOrchestrator implements JobOrchestrator {
  constructor(private readonly env: ReviewRuntime & DbEnv) {}

  async startReviewJob(id: string, params: ReviewJobMessage): Promise<void> {
    return runWithDb(this.env, async () => {
      let currentParams = { ...params };
      let phase = currentParams.phase ?? 'prepare';

      while (phase) {
        currentParams.phase = phase;
        const result = await runReview(this.env, currentParams);

        if (result.action === 'next_phase') {
          phase = result.phase;
          if (result.jobId) {
            currentParams.jobId = result.jobId;
          }
          if (result.delaySeconds > 0) {
            await setTimeout(result.delaySeconds * 1000);
          }
        } else if (result.action === 'retry') {
          if (result.delaySeconds > 0) {
            await setTimeout(result.delaySeconds * 1000);
          }
        } else if (result.action === 'ack') {
          break;
        }
      }
    });
  }
}
