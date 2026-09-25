import { logger } from "../logger";
import type { ReviewRuntime } from "../ports";
import { type PersistedReviewJob } from "./phase-control";
import { bareModelId } from "./retry-policy";

export async function sendReviewTelemetry(
  env: ReviewRuntime,
  job: PersistedReviewJob,
  files: Array<{ path: string; lineCount: number }>,
  reviews: Array<{
    file_status: string;
    input_tokens: number | null;
    output_tokens: number | null;
    model_used: string;
  }>,
  overrides: {
    findingsReported: number;
    verdict: string;
    severityDistribution: Record<string, number>;
  },
  meta: { concurrencyLevel: string; retryCount: number },
) {
  try {
    const doneReviews = reviews.filter((r) => r.file_status === "done");

    const cleanModels = Array.from(
      new Set(
        doneReviews.flatMap((r) => {
          const model = bareModelId(r.model_used);
          return model && !model.toLowerCase().includes("test") ? [model] : [];
        }),
      ),
    );

    const extractExtension = (filePath: string): string => {
      const name = filePath.split("/").pop() || filePath;
      const dotIndex = name.lastIndexOf(".");
      if (dotIndex <= 0) return "";
      return name.slice(dotIndex + 1).toLowerCase();
    };

    await env.telemetry.send({
      linesReviewed: files.reduce((sum, file) => sum + file.lineCount, 0),
      inputTokens: doneReviews.reduce(
        (sum, r) => sum + (r.input_tokens ?? 0),
        0,
      ),
      outputTokens: doneReviews.reduce(
        (sum, r) => sum + (r.output_tokens ?? 0),
        0,
      ),
      modelsUsed: cleanModels,
      fileExtensions: Array.from(
        new Set(
          files.flatMap((f) => {
            const extension = extractExtension(f.path);
            return extension ? [extension] : [];
          }),
        ),
      ),
      triggerType: job.trigger,
      reviewDurationMs: Math.max(
        0,
        env.clock.now() - new Date(job.createdAt).getTime(),
      ),
      filesReviewed: files.length,
      concurrencyLevel: meta.concurrencyLevel,
      prTotalLinesChanged: files.reduce((sum, file) => sum + file.lineCount, 0),
      retryCount: meta.retryCount,
      ...overrides,
    });
  } catch (e) {
    logger.error(
      "Failed to send telemetry",
      e instanceof Error ? e : new Error(String(e)),
    );
  }
}

export async function loadSuppressedFingerprints(
  env: Pick<ReviewRuntime, "fileReviews">,
  jobId: string,
) {
  const posted = new Map<string, Set<string>>();
  const rejected = new Set<string>();
  const postedV2 = new Set<string>();
  const rejectedV2 = new Set<string>();

  try {
    for (const row of await env.fileReviews.getSuppressedFindings(jobId)) {
      if (!row.anchored) {
        if (row.fingerprint) rejected.add(row.fingerprint);
        if (row.fingerprint_v2) rejectedV2.add(row.fingerprint_v2);
        continue;
      }
      if (row.fingerprint_v2) postedV2.add(row.fingerprint_v2);
      if (!row.fingerprint || !row.anchor_hash) continue;
      const anchors = posted.get(row.fingerprint) ?? new Set<string>();
      anchors.add(row.anchor_hash);
      posted.set(row.fingerprint, anchors);
    }
  } catch (error) {
    logger.warn(
      "Could not load suppressed findings; posting without cross-run dedupe",
      {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return { posted, rejected, postedV2, rejectedV2 };
}
