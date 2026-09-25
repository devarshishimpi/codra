import type { ReviewJobMessage } from "@codraoss/schema";
import { runReview, type ReviewJobRunResult } from "@codraoss/core";
import { createReviewRuntime } from "../../adapters";
import type { AppBindings } from "../../env";

// The seam between the Worker and the engine. The engine moved to @codraoss/core; this converts
// AppBindings into the ports it takes, and is the ONLY place in production that does.
//
// Kept as a module rather than repointing callers at @codraoss/core because
// test/review/workflow-finalize-fresh-instance.spec.ts partially mocks this specifier -- substituting
// runReviewJob while keeping FRESH_INVOCATION_YIELD_SECONDS real -- and test/mocks/review-harness.ts
// types itself as Parameters<typeof runReviewJob>[1]. Sixteen DB-backed review suites reach the
// engine through here, which is what makes them cover the adapters too.

export type { ReviewJobRunResult };

export function runReviewJob(
  env: AppBindings,
  message: ReviewJobMessage,
): Promise<ReviewJobRunResult> {
  return runReview(createReviewRuntime(env), message);
}

// The rest of the engine's surface, re-exported so existing '@server/core/review' importers and the
// specs that name that specifier keep working unchanged.
export {
  FRESH_INVOCATION_YIELD_SECONDS,
  NextPhaseError,
  failJobAndCheckRun,
  extractReviewRequest,
  getDiffFiles,
  getOrFetchRawDiffForCompletedJob,
  budgetAwareFileLimit,
  estimatedSubrequestsPerFile,
  BIN_DIFF_CHAR_BUDGET,
  BIN_MAX_FILES,
  BIN_TARGET_DIFF_LINES,
  PACKABLE_MAX_DIFF_LINES,
  narrowUnit,
  planReviewUnits,
  unitFiles,
  proportionalSplit,
  verifyFindings,
  type LedgerEntry,
  type ReviewRequest,
  type ReviewUnit,
  type VerifyDrop,
  type VerifyOutcome,
} from "@codraoss/core";
