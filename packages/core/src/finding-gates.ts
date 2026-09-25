import type {
  FindingDisposition,
  ParsedReviewComment,
  RepoConfig,
} from "@codraoss/schema";
import type { FileDiff } from "./diff";
import type { ReviewModel } from "./ports";
import {
  renderDiffSnippet,
  parseVerifyResponse,
  type VerifyCandidate,
} from "./prompts/verify";
import { logger } from "./logger";
import { reviewBreadth } from "./prompts/file-review";

type VerifiableJob = { id: string };

const LOW_YIELD_TITLE =
  /missing|redundant|repetitive|inconsisten|documentation|\btype\b|\bany\b|potential/i;

export function shadowEvaluate(
  candidates: ParsedReviewComment[],
  posted: ParsedReviewComment[],
) {
  const postedSet = new Set(posted);
  const count = (predicate: (c: ParsedReviewComment) => boolean) => ({
    wouldDrop: candidates.filter(predicate).length,
    wouldDropPosted: posted.filter(predicate).length,
  });

  return {
    candidates: candidates.length,
    posted: postedSet.size,
    dropP3AndNit: count((c) => c.severity === "P3" || c.severity === "nit"),
    dropLowYieldTitle: count((c) => LOW_YIELD_TITLE.test(c.title)),
    dropUnmatchedEvidence: count((c) => !c.evidence),
  };
}

function verifyCandidateLimit(breadth: number) {
  return Math.min(40, Math.max(10, breadth * 3));
}

import { VERIFY_MIN_ANSWER_RATIO } from "./constants";

export type VerifyDrop = {
  comment: ParsedReviewComment;
  disposition: Extract<FindingDisposition, "verify" | "verify_unanswered">;
  reason?: string;
};

/** `null` means verification ran; any other value means findings were posted unverified. */
export type VerifySkipReason =
  "no_verifiable_candidates" | "low_answer_ratio" | "verify_call_failed";

export type VerifyOutcome = {
  comments: ParsedReviewComment[];
  dropped: VerifyDrop[];
  reasons: Map<ParsedReviewComment, string>;
  skipped: VerifySkipReason | null;
};

export async function verifyFindings(params: {
  job: VerifiableJob;
  config: RepoConfig;
  files: FileDiff[];
  comments: ParsedReviewComment[];
  model: Pick<ReviewModel, "verifyFindings">;
  maxCandidates?: number;
}): Promise<VerifyOutcome> {
  const { comments, files, model, config, job } = params;

  const keepAll = (skipped: VerifySkipReason | null): VerifyOutcome => ({
    comments,
    dropped: [],
    reasons: new Map(),
    skipped,
  });

  if (comments.length === 0) return keepAll(null);

  const limit = verifyCandidateLimit(
    params.maxCandidates ?? reviewBreadth(config.review),
  );
  const toVerify = comments.slice(0, limit);

  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const prepared = toVerify.map((comment) => ({
    comment,
    snippet: renderDiffSnippet(
      fileByPath.get(comment.path),
      comment.line ?? undefined,
    ),
  }));

  const verifiable = prepared.filter(
    (entry) => entry.snippet !== "" || entry.comment.evidence,
  );
  if (verifiable.length === 0) return keepAll("no_verifiable_candidates");

  const candidates: VerifyCandidate[] = verifiable.map((entry, index) => ({
    index,
    path: entry.comment.path,
    line: entry.comment.line ?? null,
    title: entry.comment.title,
    body: entry.comment.body,
    snippet: entry.snippet,
    evidence: entry.comment.evidence ?? null,
  }));

  try {
    const response = await model.verifyFindings({ candidates, config });
    const results = parseVerifyResponse(response.rawText);

    const byIndex = new Map<
      number,
      { verdict: "keep" | "drop"; reason?: string }
    >();
    const conflicting = new Set<number>();
    for (const result of results) {
      if (
        !Number.isInteger(result.index) ||
        result.index < 0 ||
        result.index >= candidates.length
      )
        continue;
      const verdict =
        result.decidable === false ? ("drop" as const) : result.verdict;
      const prior = byIndex.get(result.index);
      if (prior && prior.verdict !== verdict) {
        conflicting.add(result.index);
        continue;
      }
      if (!prior) byIndex.set(result.index, { verdict, reason: result.reason });
    }
    for (const index of conflicting) byIndex.delete(index);

    const answered = byIndex.size;
    if (
      answered === 0 ||
      answered / candidates.length < VERIFY_MIN_ANSWER_RATIO
    ) {
      logger.warn(
        "Verification did not answer enough indices; keeping all findings",
        {
          jobId: job.id,
          candidates: candidates.length,
          answered,
        },
      );
      return keepAll("low_answer_ratio");
    }

    const dropped: VerifyDrop[] = [];
    const reasons = new Map<ParsedReviewComment, string>();

    verifiable.forEach((entry, index) => {
      const result = byIndex.get(index);
      if (result?.reason) reasons.set(entry.comment, result.reason);

      if (result?.verdict === "drop") {
        dropped.push({
          comment: entry.comment,
          disposition: "verify",
          reason: result.reason,
        });
        return;
      }
      if (!result) {
        dropped.push({
          comment: entry.comment,
          disposition: "verify_unanswered",
          reason: "the verifier returned no verdict for this finding",
        });
      }
    });

    const droppedSet = new Set(dropped.map((drop) => drop.comment));
    logger.info("Verification pass complete", {
      jobId: job.id,
      candidates: candidates.length,
      answered,
      dropped: dropped.length,
      topReasons: dropped.slice(0, 5).map((drop) => drop.reason),
    });

    return {
      comments: comments.filter((comment) => !droppedSet.has(comment)),
      dropped,
      reasons,
      skipped: null,
    };
  } catch (error) {
    logger.warn("Verification pass failed; posting pre-verification findings", {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return keepAll("verify_call_failed");
  }
}
