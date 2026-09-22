import type { DbEnv } from '@codraoss/db/env';
import type { ReviewTelemetryEvent, TelemetrySink } from '@codraoss/core/ports';
import { makeInstanceIdStore } from '@codraoss/db/repositories';
import { logger } from '@codraoss/api/logger';
import type { NodeAppBindings } from '../env';
import pkg from '../../../../package.json' with { type: 'json' };

const DEFAULT_TELEMETRY_URL = 'https://codra.run/api/telemetry';
const DEFAULT_TELEMETRY_SECRET = 'codra-telemetry-v1-secret-8f9a2b5c';
const TELEMETRY_TIMEOUT_MS = 5000;

function isDisabled(env: NodeAppBindings): boolean {
  const flag = String(process.env.TELEMETRY_DISABLED ?? '').toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  // ENVIRONMENT defaults to 'development', so without the NODE_ENV/VITEST check a test that
  // exercises this sink would post a real event.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return true;
  return ['test', 'local'].includes(String(env.ENVIRONMENT ?? '').toLowerCase());
}

// Mirrors apps/worker/src/core/telemetry.ts. Kept per app rather than shared because the version
// string comes from the repo-root package.json, which no package-relative path can reach.
export function makeTelemetrySink(env: NodeAppBindings, dbEnv: DbEnv): TelemetrySink {
  const instanceIds = makeInstanceIdStore(dbEnv);

  return {
    // Swallows every error: telemetry must never fail a review.
    async send(event: ReviewTelemetryEvent) {
      try {
        if (isDisabled(env)) return;

        // Drops the stub models used in tests so they cannot skew the aggregate.
        const modelsUsed = event.modelsUsed
          .map((model) => model.replace(/^(google|cloudflare|openai|anthropic|openrouter|nvidia):/i, '').trim())
          .filter((model) => model && !model.toLowerCase().includes('test'));

        if (event.modelsUsed.length > 0 && modelsUsed.length === 0) return;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);

        try {
          await fetch(process.env.TELEMETRY_API_URL ?? DEFAULT_TELEMETRY_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.TELEMETRY_SECRET ?? DEFAULT_TELEMETRY_SECRET}`,
            },
            body: JSON.stringify({
              ...event,
              modelsUsed,
              instanceId: await instanceIds.getOrCreateInstanceId(),
              prsReviewed: 1,
              codraVersion: pkg.version,
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        logger.debug('Failed to send anonymous telemetry event', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
