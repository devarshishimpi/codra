import { dedupeFindings } from "../model-output";
import { verifyFindings } from "../finding-gates";
import type {
  FindingDisposition,
  ParsedReviewComment,
  RepoConfig,
} from "@codraoss/schema";
import type { FileDiff } from "../diff";
import type { PersistedReviewJob } from "./phase-control";
import type { ReviewModel, ReviewRuntime } from "../ports";
import { loadSuppressedFingerprints } from "./telemetry";
import { reviewBreadth } from "../prompts/file-review";
import { getLanguageForFile } from "../prompts/languages";

export async function applyFindingGates(params: {
  env: Pick<ReviewRuntime, "fileReviews">;
  job: PersistedReviewJob;
  config: RepoConfig;
  files: FileDiff[];
  model: Pick<ReviewModel, "verifyFindings">;
  effectiveMaxComments: number;
  reviewedComments: ParsedReviewComment[];
  reviews: Array<{
    withheld_counts?: {
      evidence?: number;
      claimDenied?: number;
      contextOnly?: number;
      absenceRefuted?: number;
    } | null;
  }>;
}) {
  const {
    env,
    job,
    config,
    files,
    model,
    effectiveMaxComments,
    reviewedComments,
    reviews,
  } = params;

  const severityRanks: Record<string, number> = {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3,
    nit: 4,
  };
  const minRank = severityRanks[config.review.min_severity] ?? 4;
  const minConfidence = config.review.min_confidence ?? 0;

  // Precision varies 5.8x by language in the measured corpus, and until now every gate was global.
  // Resolved per finding from its own path, so a mixed-language pull request is judged per file rather
  // than by whatever the repo is mostly written in.
  const languageGates = config.review.language_gates ?? {};
  const gatesByLanguage = new Map(
    Object.entries(languageGates).map(([language, gate]) => [
      language.toLowerCase(),
      gate,
    ]),
  );
  const thresholdsFor = (path: string) => {
    if (gatesByLanguage.size === 0) return { minRank, minConfidence };
    const language = getLanguageForFile(path)?.language;
    const override = language
      ? gatesByLanguage.get(language.toLowerCase())
      : undefined;
    if (!override) return { minRank, minConfidence };
    return {
      minRank: override.min_severity
        ? (severityRanks[override.min_severity] ?? 4)
        : minRank,
      minConfidence: override.min_confidence ?? minConfidence,
    };
  };

  const dispositions = new Map<string, FindingDisposition>();
  const verifyReasons = new Map<string, string>();
  const recordDisposition = (
    comments: ParsedReviewComment[],
    stage: FindingDisposition,
  ) => {
    for (const comment of comments) {
      if (comment.fingerprint && !dispositions.has(comment.fingerprint)) {
        dispositions.set(comment.fingerprint, stage);
      }
    }
  };

  let finalComments = reviewedComments.filter((c) => {
    const thresholds = thresholdsFor(c.path);
    if ((severityRanks[c.severity] ?? 4) > thresholds.minRank) {
      recordDisposition([c], "severity");
      return false;
    }
    if (
      typeof c.confidenceScore === "number" &&
      c.confidenceScore < thresholds.minConfidence
    ) {
      recordDisposition([c], "confidence");
      return false;
    }
    return true;
  });

  const suppressed = await loadSuppressedFingerprints(env, job.id);
  const suppressedComments: ParsedReviewComment[] = [];
  const hasSuppressionData =
    suppressed.rejected.size > 0 ||
    suppressed.posted.size > 0 ||
    suppressed.rejectedV2.size > 0 ||
    suppressed.postedV2.size > 0;
  if (hasSuppressionData) {
    finalComments = finalComments.filter((c) => {
      const rejected =
        (c.fingerprint && suppressed.rejected.has(c.fingerprint)) ||
        (c.fingerprintV2 && suppressed.rejectedV2.has(c.fingerprintV2));

      const anchors = c.fingerprint
        ? suppressed.posted.get(c.fingerprint)
        : undefined;
      const alreadyPosted =
        (anchors && c.anchorHash && anchors.has(c.anchorHash)) ||
        (c.fingerprintV2 && suppressed.postedV2.has(c.fingerprintV2));

      if (rejected || alreadyPosted) {
        suppressedComments.push(c);
        return false;
      }
      return true;
    });
  }
  const droppedBySuppression = suppressedComments.length;
  recordDisposition(suppressedComments, "suppression");

  const beforeDedupe = finalComments;
  finalComments = dedupeFindings(finalComments);
  const survivedDedupe = new Set(finalComments);
  recordDisposition(
    beforeDedupe.filter((c) => !survivedDedupe.has(c)),
    "dedupe",
  );

  finalComments.sort((a, b) => {
    const rankDiff =
      (severityRanks[a.severity] ?? 4) - (severityRanks[b.severity] ?? 4);
    if (rankDiff !== 0) return rankDiff;
    return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  });

  const beforeVerifyList = finalComments;
  const verify = await verifyFindings({
    job,
    config,
    files,
    comments: finalComments,
    model,
    maxCandidates: reviewBreadth(config.review),
  });
  finalComments = verify.comments;
  const droppedByVerification = verify.dropped.length;
  for (const drop of verify.dropped)
    recordDisposition([drop.comment], drop.disposition);
  for (const [comment, reason] of verify.reasons) {
    if (comment.fingerprint) verifyReasons.set(comment.fingerprint, reason);
  }

  const beforeCapList = finalComments;
  const beforeCap = finalComments.length;
  if (finalComments.length > effectiveMaxComments) {
    finalComments = finalComments.slice(0, effectiveMaxComments);
  }
  const droppedByCap = beforeCap - finalComments.length;
  recordDisposition(beforeCapList.slice(effectiveMaxComments), "cap");
  const omittedCount = reviewedComments.length - finalComments.length;
  const droppedByFilters =
    omittedCount - droppedBySuppression - droppedByVerification - droppedByCap;

  const withheldByParser = reviews.reduce(
    (sum, review) =>
      sum +
      (review.withheld_counts?.evidence ?? 0) +
      (review.withheld_counts?.claimDenied ?? 0) +
      // Counted here too, or a file whose findings were ALL about untouched code looks like a file
      // with nothing to say, and `everythingWithheld` lets the PR be approved silently.
      (review.withheld_counts?.contextOnly ?? 0) +
      (review.withheld_counts?.absenceRefuted ?? 0),
    0,
  );

  const byClaimType: Record<string, { generated: number; posted: number }> = {};
  for (const comment of reviewedComments) {
    const key = comment.claimType ?? "unlabelled";
    byClaimType[key] ??= { generated: 0, posted: 0 };
    byClaimType[key].generated += 1;
  }
  for (const comment of finalComments) {
    const key = comment.claimType ?? "unlabelled";
    byClaimType[key] ??= { generated: 0, posted: 0 };
    byClaimType[key].posted += 1;
  }
  return {
    finalComments,
    dispositions,
    verifyReasons,
    // Non-null means these findings were never checked. The caller records it on the job, so a review
    // that skipped verification stops looking identical to one that passed it.
    verificationSkipped: verify.skipped,
    suppressedComments,
    droppedBySuppression,
    beforeVerifyList,
    droppedByVerification,
    droppedByCap,
    omittedCount,
    droppedByFilters,
    withheldByParser,
    byClaimType,
  };
}
