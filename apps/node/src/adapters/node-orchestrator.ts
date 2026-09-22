import type { JobOrchestrator } from '@codraoss/core/ports';
import type { ReviewJobMessage } from '@codraoss/schema';
import { runReview } from '@codraoss/core';
import { runWithDb } from '@codraoss/db/client';
import { logger } from '@codraoss/api/logger';
import type { NodeAppBindings } from '../env';
import { createReviewRuntime } from './review-runtime';

const DEFAULT_RETRY_DELAY_SECONDS = 60;

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Drives the engine's phase machine in a plain loop.
//
// The Cloudflare orchestrator has to hibernate between phases: a Workers invocation gets a fixed
// subrequest budget, so `next_phase` exists to hand the next phase a fresh one. Node has no such
// budget, so the same contract collapses into awaiting the delay and calling again in-process, and
// `freshInstance` needs no special handling -- the next iteration is already a clean slate for
// everything the flag was protecting.
export class NodeOrchestrator implements JobOrchestrator {
  constructor(private readonly env: NodeAppBindings) {}

  async startReviewJob(id: string, params: ReviewJobMessage): Promise<void> {
    // The whole run shares one AsyncLocalStorage-scoped connection, so every query inside every
    // phase resolves against the same client.
    await runWithDb(this.env, async () => {
      const runtime = createReviewRuntime(this.env);
      let phase: ReviewJobMessage['phase'] = params.phase ?? 'prepare';

      for (;;) {
        const result = await runReview(runtime, { ...params, phase });

        if (result.action === 'next_phase') {
          phase = result.phase;
          if (result.delaySeconds > 0) await sleep(result.delaySeconds);
          continue;
        }

        if (result.action === 'retry') {
          // No work happened: admission was throttled or the lease is held elsewhere. Same phase,
          // after the delay the engine asked for.
          await sleep(result.delaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS);
          continue;
        }

        // 'ack': finished, or not ours to run.
        logger.info('Review job finished', { jobId: id, phase });
        return;
      }
    });
  }
}
