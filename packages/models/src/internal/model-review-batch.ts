import {
  submitCloudflareBatch,
  pollCloudflareBatch,
} from "../providers/cloudflare";
import {
  buildFileReviewPrompts,
  buildReviewResponseSchema,
  reviewBreadth,
} from "@codraoss/core/prompts/file-review";
import { parseFileReviewResponse } from "@codraoss/core/model-output";
import { truncateFileDiff } from "@codraoss/core/diff";
import { logger } from "@codraoss/core/logger";
import type { RepoConfig, ResolvedModelConfig } from "@codraoss/schema";
import type { ModelResponse } from "../types";
import {
  COMPACT_REVIEW_PROMPT_LINE_CAP,
  type ModelReviewContext,
} from "./model-review-file";

// Import from services/model.ts, not here -- four specs vi.mock that specifier.
// Separate from the synchronous flow in model-review-file.ts because submit and poll happen in different Worker invocations, with the request id carried in the DB.

// Returns null when unusable for the primary model, in which case the caller falls back to synchronous reviewFile.
export async function submitReviewBatch(
  ctx: ModelReviewContext,
  params: {
    file: any;
    fileContext?: string | null;
    prTitle: string | null;
    prDescription: string | null;
    changelogExcerpt?: string | null;
    config: RepoConfig;
    totalLineCount: number;
    compactPrompt?: boolean;
  },
): Promise<{ requestId: string; model: string } | null> {
  const { primary } = ctx.selectModel({
    totalLineCount: params.totalLineCount,
    config: params.config,
  });

  let resolved: ResolvedModelConfig;
  try {
    resolved = await ctx.resolveModel(primary);
  } catch {
    return null;
  }
  // Only Cloudflare Workers AI exposes the async batch queue; other providers use the sync path.
  if (resolved.apiFormat !== "cloudflare-workers-ai") return null;
  // Skip the probe for a model already shown not to support async queueing this invocation.
  if (ctx.asyncUnsupportedModels.has(resolved.modelName)) return null;

  const configuredLineCap = params.config.review.max_diff_lines_per_file;
  const modelLineCap = params.compactPrompt
    ? Math.min(configuredLineCap, COMPACT_REVIEW_PROMPT_LINE_CAP)
    : configuredLineCap;
  const file = truncateFileDiff(params.file, modelLineCap);
  const { systemPrompt, userPrompt } = buildFileReviewPrompts({
    ...params,
    file,
    config: params.config.review,
  });

  if (!ctx.aiBinding) return null;

  try {
    const requestId = await ctx.rateLimits.runShared(() =>
      submitCloudflareBatch(
        ctx.aiBinding!,
        resolved.modelName,
        {
          systemPrompt,
          userPrompt,
          responseSchema: buildReviewResponseSchema(
            reviewBreadth(params.config.review),
          ),
        },
        ctx.tracker,
      ),
    );
    return { requestId, model: resolved.modelName };
  } catch (error) {
    // Non-fatal: remember the model so sibling files this invocation don't each pay the failed probe.
    ctx.asyncUnsupportedModels.add(resolved.modelName);
    logger.warn(
      `Async batch submit unavailable for ${resolved.modelName}; using synchronous review`,
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}

// Returns 'pending' while still queued/running, 'done' with the parsed review, or 'failed' if the poll or parse errored.
export async function pollReviewBatch(
  ctx: ModelReviewContext,
  params: { model: string; requestId: string; file: any; config: RepoConfig },
): Promise<
  | { status: "pending" }
  | {
      status: "done";
      response: ModelResponse & {
        parsed: ReturnType<typeof parseFileReviewResponse>;
        reviewedLineCount: number;
        wasPromptTruncated: boolean;
        userPrompt: string;
      };
    }
  | { status: "failed"; error: unknown }
> {
  let resolved: ResolvedModelConfig;
  try {
    resolved = await ctx.resolveModel(params.model);
  } catch (error) {
    return { status: "failed", error };
  }

  if (!ctx.aiBinding)
    return {
      status: "failed",
      error: new Error("Cloudflare AI binding not provided"),
    };

  try {
    const poll = await ctx.rateLimits.runShared(() =>
      pollCloudflareBatch(
        ctx.aiBinding!,
        resolved.modelName,
        params.requestId,
        ctx.tracker,
        resolved.providerName,
      ),
    );
    if (poll.status === "pending") return { status: "pending" };

    const response = poll.response;
    if (ctx.tracker) {
      ctx.tracker.record(
        response.modelUsed,
        response.inputTokens,
        response.outputTokens,
      );
    }
    const parsed = parseFileReviewResponse(response.rawText, params.file, {
      deniedClaimTypes: params.config.review.deny_claim_types,
    });
    return {
      status: "done",
      response: {
        ...response,
        parsed,
        userPrompt: "",
        reviewedLineCount: params.file.lineCount,
        wasPromptTruncated: params.file.isTruncated === true,
      },
    };
  } catch (error) {
    return { status: "failed", error };
  }
}
