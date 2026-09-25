import type { AppBindings } from "../env";
import { logger } from "./logger";

const TELEMETRY_SECRET = "codra-telemetry-v1-secret-8f9a2b5c";
const INSTANCE_ID_KEY = "codra:instance_id";

import { queryRows } from "@codraoss/db/client";
// Static import: version string is inlined at build time by Vite - no runtime cost.
import pkg from "../../../../package.json";

const CODRA_VERSION: string = pkg.version;

async function getInstanceId(env: AppBindings): Promise<string> {
  try {
    const rows = await queryRows<{ value: string }>(
      env,
      "SELECT value FROM global_settings WHERE key = $1",
      [INSTANCE_ID_KEY],
    );
    let instanceId = rows[0]?.value;

    if (!instanceId) {
      instanceId = crypto.randomUUID();
      await queryRows(
        env,
        "INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
        [INSTANCE_ID_KEY, instanceId],
      );
      // Fetch again in case another instance inserted it concurrently
      const rowsAfter = await queryRows<{ value: string }>(
        env,
        "SELECT value FROM global_settings WHERE key = $1",
        [INSTANCE_ID_KEY],
      );
      instanceId = rowsAfter[0]?.value ?? instanceId;
    }
    return instanceId;
  } catch (error) {
    logger.warn("Failed to retrieve or generate instance ID for telemetry", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback so telemetry can still send, though it will count as a new "install" if the DB is failing.
    return crypto.randomUUID();
  }
}

// Swallows all errors so the caller is never interrupted.
export async function sendTelemetryEvent(
  env: AppBindings,
  data: {
    linesReviewed: number;
    findingsReported: number;
    inputTokens: number;
    outputTokens: number;
    modelsUsed: string[];
    fileExtensions: string[];
    triggerType: string;
    reviewDurationMs: number;
    filesReviewed: number;
    verdict?: string;
    severityDistribution: Record<string, number>;
    concurrencyLevel: string;
    prTotalLinesChanged: number;
    retryCount: number;
  },
): Promise<void> {
  try {
    // Opt-out for self-hosters/forks: set TELEMETRY_DISABLED=true (or 1) to send nothing.
    const disabled = String(
      (env as any).TELEMETRY_DISABLED ?? process.env.TELEMETRY_DISABLED ?? "",
    ).toLowerCase();
    if (disabled === "true" || disabled === "1") {
      return;
    }

    const isTestEnv =
      process.env.NODE_ENV === "test" ||
      Boolean(process.env.VITEST) ||
      ["test", "local"].includes(
        String((env as any).ENVIRONMENT ?? "").toLowerCase(),
      );

    if (isTestEnv) {
      logger.debug("Skipping telemetry in test/local environment");
      return;
    }

    // Filter out stub/test models (e.g. 'test-model') used in vitest mocks.
    const cleanModelsUsed: string[] = [];
    for (const model of data.modelsUsed) {
      const cleaned = model
        .replace(/^(google|cloudflare|openai|anthropic):/i, "")
        .trim();
      if (cleaned && !cleaned.toLowerCase().includes("test"))
        cleanModelsUsed.push(cleaned);
    }

    if (data.modelsUsed.length > 0 && cleanModelsUsed.length === 0) {
      logger.debug("Skipping telemetry: only test/stub models detected", {
        modelsUsed: data.modelsUsed,
      });
      return;
    }

    const instanceId = await getInstanceId(env);
    const telemetryUrl =
      (env as any).TELEMETRY_API_URL ?? "https://codra.run/api/telemetry";
    // Overridable via env so the ingestion secret isn't pinned to the value committed in this (public) source tree.
    const telemetrySecret = (env as any).TELEMETRY_SECRET ?? TELEMETRY_SECRET;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    await fetch(telemetryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${telemetrySecret}`,
      },
      body: JSON.stringify({
        instanceId,
        prsReviewed: 1,
        linesReviewed: data.linesReviewed,
        findingsReported: data.findingsReported,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        modelsUsed: cleanModelsUsed,
        fileExtensions: data.fileExtensions,
        triggerType: data.triggerType,
        reviewDurationMs: data.reviewDurationMs,
        filesReviewed: data.filesReviewed,
        verdict: data.verdict,
        severityDistribution: data.severityDistribution,
        codraVersion: CODRA_VERSION,
        concurrencyLevel: data.concurrencyLevel,
        prTotalLinesChanged: data.prTotalLinesChanged,
        retryCount: data.retryCount,
      }),
      signal: controller.signal,
    })
      .catch((error) => {
        // Intentionally swallowed: Network errors are expected occasionally
        logger.debug("Failed to send anonymous telemetry event (network)", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });
  } catch (error) {
    // Intentionally swallowed: We never want telemetry to fail a PR review
    logger.debug("Failed to send anonymous telemetry event (setup)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
