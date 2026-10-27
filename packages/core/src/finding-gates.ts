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
import { dedupeFindings } from "./model-output/dedupe";

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
  | "no_verifiable_candidates"
  | "low_answer_ratio"
  | "verify_call_failed"
  // the model profile switches the verifier off on purpose (review.model_tuning.verify)
  | "disabled_by_profile";

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
  secondaryModel?: Pick<ReviewModel, "verifyFindings">;
  maxCandidates?: number;
}): Promise<VerifyOutcome> {
  const { comments, files, model, secondaryModel, config, job } = params;

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
  const dedupeRadius = config.review.dedupe_line_radius ?? 2;
  const dedupedComments = dedupeFindings(comments, { lineRadius: dedupeRadius });
  const toVerify = dedupedComments.slice(0, limit);

  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const vRadius =
    config.review.model_tuning?.verification_radius ?? config.review.verification_radius ?? 35;

  // Deterministic absence check: refute claims asserting a symbol is missing when it is present in the diff
  const falseAbsenceDrops: VerifyDrop[] = [];
  const validCandidates: ParsedReviewComment[] = [];

  for (const comment of toVerify) {
    const file = fileByPath.get(comment.path);
    let isFalseAbsence = false;
    if (file) {
      const match =
        comment.title.match(/\bmissing\s+['"`]?([a-zA-Z0-9_$]{3,})['"`]?\b/i) ??
        comment.body.match(/\bmissing\s+['"`]?([a-zA-Z0-9_$]{3,})['"`]?\b/i);
      if (match) {
        const symbol = match[1];
        const present = file.hunks.some((h) =>
          h.lines.some((l) => l.content.includes(symbol)),
        );
        if (present) {
          isFalseAbsence = true;
          falseAbsenceDrops.push({
            comment,
            disposition: "verify",
            reason: `symbol "${symbol}" asserted as missing was found directly in the modified file diff`,
          });
        }
      }
    }
    if (!isFalseAbsence) {
      validCandidates.push(comment);
    }
  }

  const prepared = validCandidates.map((comment) => ({
    comment,
    snippet: renderDiffSnippet(
      fileByPath.get(comment.path),
      comment.line ?? undefined,
      vRadius,
    ),
  }));

  const verifiable = prepared.filter(
    (entry) => entry.snippet !== "" || entry.comment.evidence,
  );
  if (verifiable.length === 0) {
    return {
      comments: validCandidates,
      dropped: falseAbsenceDrops,
      reasons: new Map(falseAbsenceDrops.map((d) => [d.comment, d.reason ?? ""])),
      skipped: "no_verifiable_candidates",
    };
  }

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
      { verdict: "keep" | "drop"; reason?: string; confidence?: number }
    >();
    const conflicting = new Set<number>();
    for (const result of results) {
      if (
        !Number.isInteger(result.index) ||
        result.index < 0 ||
        result.index >= candidates.length
      )
        continue;

      // Verifier verdicts:
      // Drop if verifier answered "drop" or if the claim is not decidable from the diff.
      let verdict: "keep" | "drop";
      if (result.verdict === "drop" || result.decidable === false) {
        verdict = "drop";
      } else {
        verdict = "keep";
      }

      const prior = byIndex.get(result.index);
      if (prior && prior.verdict !== verdict) {
        conflicting.add(result.index);
        continue;
      }
      if (!prior) byIndex.set(result.index, { verdict, reason: result.reason, confidence: result.confidence });
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
      if (typeof result?.confidence === "number") {
        entry.comment.confidenceScore = result.confidence;
      }

      if (result?.verdict === "drop") {
        dropped.push({
          comment: entry.comment,
          disposition: "verify",
          reason: result.reason ?? "verification refuted this finding",
        });
        return;
      }
      if (!result) {
        if (typeof entry.comment.confidenceScore === "number" && entry.comment.confidenceScore >= 0.7) {
          // Preserve high confidence candidate omitted by verifier output
        } else {
          dropped.push({
            comment: entry.comment,
            disposition: "verify_unanswered",
            reason: "the verifier returned no verdict for this finding",
          });
          return;
        }
      }

      // Drop non-critical test suite nits (exempt non-source test artifacts like .trx, .xml, .log)
      const p = (entry.comment.path || "").toLowerCase();
      const isTestCode = (p.includes("/test/") || p.includes("/tests/") || p.includes("/spec/") || p.endsWith(".test.ts") || p.endsWith(".test.js") || p.endsWith("_test.go"))
        && !p.endsWith(".trx") && !p.endsWith(".xml") && !p.endsWith(".log") && !p.endsWith(".dump") && !p.endsWith(".json");
      if (isTestCode && entry.comment.severity === "nit") {
        dropped.push({
          comment: entry.comment,
          disposition: "verify",
          reason: "Non-critical finding in test suite or mock fixture",
        });
        return;
      }
    });

    const droppedSet = new Set(dropped.map((drop) => drop.comment));
    let survivingComments = comments.filter((comment) => !droppedSet.has(comment));

    if (secondaryModel && survivingComments.length > 0) {
      try {
        const secCandidates: VerifyCandidate[] = survivingComments.map((comment, index) => ({
          index,
          path: comment.path,
          line: comment.line ?? null,
          title: comment.title,
          body: comment.body,
          snippet: renderDiffSnippet(
            fileByPath.get(comment.path),
            comment.line ?? undefined,
            vRadius,
          ),
          evidence: comment.evidence ?? null,
        }));
        const secRes = await secondaryModel.verifyFindings({ candidates: secCandidates, config });
        const secResults = parseVerifyResponse(secRes.rawText);
        const secDropIndices = new Set<number>();
        for (const r of secResults) {
          if (r.verdict === "drop" || r.decidable === false) {
            secDropIndices.add(r.index);
          }
        }
        if (secDropIndices.size > 0) {
          survivingComments = survivingComments.filter((_, idx) => !secDropIndices.has(idx));
        }
      } catch (secErr) {
        logger.warn("Secondary verifier failed or unavailable; proceeding with self-verified findings", {
          jobId: job.id,
          error: secErr instanceof Error ? secErr.message : String(secErr),
        });
      }
    }

    logger.info("Verification pass complete", {
      jobId: job.id,
      candidates: candidates.length,
      answered,
      dropped: dropped.length,
      topReasons: dropped.slice(0, 5).map((drop) => drop.reason),
    });

    return {
      comments: survivingComments,
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
