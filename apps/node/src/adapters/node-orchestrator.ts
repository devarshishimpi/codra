import type { JobOrchestrator } from '@codraoss/core/ports';
import type { ReviewJobMessage } from '@codraoss/schema';
import { runReview } from '@codraoss/core';
import { logger } from '@codraoss/api/logger';
import type { NodeAppBindings } from '../env';
import { createReviewRuntime } from './review-runtime';

const DEFAULT_RETRY_DELAY_SECONDS = 60;

// A 'retry' means no work happened: admission was throttled, or another runner holds the lease.
// Waiting it out in-process is cheaper than a Redis round trip, but only for a few rounds -- a
// worker slot spinning here is a slot not running reviews, and at concurrency 1 that is the whole
// queue. Past this the message goes back to the queue so something else can make progress.
const MAX_CONSECUTIVE_RETRIES = 5;

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Drives the engine's phase machine in a plain loop.
//
// The Cloudflare orchestrator has to hibernate between phases: a Workers invocation gets a fixed
// subrequest budget, so `next_phase` exists to hand the next phase a fresh one. Node has no such
// budget, so the same contract collapses into awaiting the delay and calling again in-process, and
// `freshInstance` needs no special handling -- the next iteration is already a clean slate for
// everything the flag was protecting.
//
// Deliberately not wrapped in runWithDb. That helper builds a fresh postgres pool per call and never
// ends it, which is right on Workers, where an invocation may not reuse another's I/O, and wrong
// here: it left one connection per review job open for the pool's max_lifetime, and the open handles
// kept the process alive through SIGTERM. Outside a runWithDb scope, getDb serves the process-wide
// pool instead, which is what a long-lived server wants.
export class NodeOrchestrator implements JobOrchestrator {
  constructor(private readonly env: NodeAppBindings) {}

  async startReviewJob(id: string, params: ReviewJobMessage): Promise<void> {
    const runtime = createReviewRuntime(this.env);
    let message = params;
    let phase: ReviewJobMessage['phase'] = params.phase ?? 'prepare';
    let consecutiveRetries = 0;

    for (;;) {
      const result = await runReview(runtime, { ...message, phase });

      if (result.action === 'next_phase') {
        consecutiveRetries = 0;
        phase = result.phase;
        // Carrying the id forward puts later phases on the cheap getJobForProcessing path, instead
        // of re-resolving the webhook delivery -- which for a comment event means another call to
        // GitHub at every phase boundary.
        if (result.jobId) message = { ...message, jobId: result.jobId };
        if (result.delaySeconds > 0) await sleep(result.delaySeconds);
        continue;
      }

      if (result.action === 'retry') {
        const delaySeconds = result.delaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS;

        if (++consecutiveRetries > MAX_CONSECUTIVE_RETRIES) {
          logger.warn('Review job still not admitted, returning it to the queue', { jobId: id, phase });
          await this.env.REVIEW_QUEUE.send({ ...message, phase }, { delaySeconds });
          return;
        }

        await sleep(delaySeconds);
        continue;
      }

      // 'ack': finished, or not ours to run.
      logger.info('Review job finished', { jobId: id, phase });
      return;
    }
  }
}
