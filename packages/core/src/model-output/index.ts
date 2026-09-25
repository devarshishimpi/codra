import {
  fileReviewModelOutputSchema,
  parsedReviewCommentSchema,
  toClaimType,
  CLAIM_TYPE_CATEGORY,
  type ClaimType,
  type ParsedReviewComment,
  reviewSeverities,
} from "@codraoss/schema";
import { renderDiffSnippet } from "../prompts/verify";
import { logger } from "../logger";
import { z } from "zod";
import {
  findPositionForLine,
  getValidPositions,
  type DiffLine,
  type FileDiff,
} from "../diff";
import {
  buildAnchorHash,
  buildFindingFingerprint,
  buildFindingFingerprintV2,
} from "../fingerprint";
import {
  buildPresenceIndex,
  checkAbsenceClaim,
  isVersionClaimRefutedByPin,
  looksLikeExternalVersionClaim,
  refuteUndecidableClaim,
} from "../claim-checks";
import { parseRawPayload } from "./json";
import {
  type BinAmbiguityIndex,
  type EvidenceIndex,
  buildEvidenceIndex,
  foldFirstEvidenceLine,
  resolveEvidence,
} from "./evidence";

export function samePath(a: string, b: string): boolean {
  const strip = (p: string) =>
    p
      .trim()
      .replace(/^\.\//, "")
      .replace(/^[ab]\//, "")
      .replace(/^\//, "");
  return strip(a) === strip(b);
}

export type BinAmbiguity = {
  index: BinAmbiguityIndex;
  filePath: string;
  stats: { ambiguousAcrossBin: number };
};

function withSuggestion(body: string, codeSuggestion?: string) {
  if (!codeSuggestion) return body;

  const cleanSuggestion = codeSuggestion
    .replace(/```suggestion\n?|```/g, "")
    .trim();

  const cleanBody = body.split("```suggestion")[0].trim();

  return `${cleanBody}\n\n\`\`\`suggestion\n${cleanSuggestion}\n\`\`\``;
}

const CLAIM_TYPE_REPAIRS: ReadonlyArray<{
  pattern: RegExp;
  claimType: ClaimType;
}> = [
  {
    pattern: /dependenc(?:y|ies)\s+array|exhaustive[- ]deps/i,
    claimType: "react_hook_missing_deps",
  },
  {
    pattern: /redos|catastrophic backtrack|exponential backtrack/i,
    claimType: "redos_regex",
  },
];

function repairClaimType(
  claimType: ClaimType,
  title: string,
  body: string,
  onRepair: () => void,
): ClaimType {
  if (claimType !== "other") return claimType;
  const text = `${title}\n${body}`;

  if (looksLikeExternalVersionClaim(title, body)) {
    onRepair();
    return "external_version_claim";
  }

  for (const { pattern, claimType: repaired } of CLAIM_TYPE_REPAIRS) {
    if (pattern.test(text)) {
      onRepair();
      return repaired;
    }
  }
  return claimType;
}

type RawFinding = z.infer<
  typeof fileReviewModelOutputSchema
>["findings"][number];

type Withheld = { title: string; body: string; tag?: string };

function formatWithheld(w: Withheld): string {
  return w.tag
    ? `- **[${w.tag}] ${w.title}:** ${w.body}`
    : `- **${w.title}:** ${w.body}`;
}

function groundFindingInEvidence(
  finding: RawFinding,
  evidenceIndex: EvidenceIndex,
  evidenceStats: {
    total: number;
    matched: number;
    unmatched: number;
    weak: number;
    absent: number;
    contextOnly: number;
  },
  ambiguity?: BinAmbiguity,
): { diffLine: DiffLine } | { withheld: Withheld } {
  const reportedLine =
    finding.code_location.line || finding.code_location.line_range?.start;

  evidenceStats.total += 1;
  const evidence = resolveEvidence(
    finding.evidence,
    evidenceIndex,
    reportedLine,
  );
  if (evidence.status === "matched") evidenceStats.matched += 1;
  else if (evidence.status === "unmatched") evidenceStats.unmatched += 1;
  else if (evidence.status === "weak") evidenceStats.weak += 1;
  else if (evidence.status === "absent") evidenceStats.absent += 1;

  if (evidence.status !== "matched") {
    return {
      withheld: {
        title: finding.title,
        body: finding.body,
        tag: `unverified:${evidence.status}`,
      },
    };
  }

  // The evidence exists, but only on lines this pull request did not touch. That is a review of the
  // repository, not of the change -- and it is the enforcement half of whole-file context: the prompt
  // says the context block is not evidence, and this is what makes that true. Deletions count as
  // touched: a finding about removed code is a finding about the change.
  if (!evidence.touched) {
    evidenceStats.contextOnly += 1;
    return {
      withheld: {
        title: finding.title,
        body: finding.body,
        tag: "unverified:context-only",
      },
    };
  }

  if (ambiguity) {
    const firstLine = foldFirstEvidenceLine(finding.evidence);
    const claimedPath = finding.code_location.absolute_file_path?.trim();
    const ambiguousAcrossBin = firstLine
      ? (ambiguity.index.get(firstLine) ?? 0) > 1
      : false;
    if (
      ambiguousAcrossBin &&
      claimedPath &&
      !samePath(claimedPath, ambiguity.filePath)
    ) {
      ambiguity.stats.ambiguousAcrossBin += 1;
      return {
        withheld: {
          title: finding.title,
          body: finding.body,
          tag: "unverified:ambiguous-across-bin",
        },
      };
    }
  }

  return { diffLine: evidence.line };
}

function anchorToDiffPosition(
  file: FileDiff,
  diffLine: DiffLine,
  validPositions: Set<number>,
  finding: RawFinding,
): { line: number; position: number } | { withheld: Withheld } {
  const line = diffLine.newLineNumber!;
  const position = findPositionForLine(file, line);

  if (position === undefined || !validPositions.has(position)) {
    return { withheld: { title: finding.title, body: finding.body } };
  }

  return { line, position };
}

function validateFindingShape(finding: RawFinding): {
  severity: (typeof reviewSeverities)[number];
  title: string;
  body: string;
} {
  const priorityMap: Record<number, (typeof reviewSeverities)[number]> = {
    0: "P0",
    1: "P1",
    2: "P2",
    3: "P3",
    4: "nit",
  };
  const severity =
    finding.priority !== undefined
      ? priorityMap[finding.priority] || "P3"
      : "P3";

  const cleanText = (text: string) => {
    let current = text.trim();
    let prev = "";
    while (current !== prev) {
      prev = current;
      current = current
        .replace(
          /^(?:[^\w\s]+|(?:QUALITY|SECURITY|BUG|PERFORMANCE|CORRECTNESS|P[0-3]|NIT)\b)+/giu,
          "",
        )
        .replace(/\n\s*/g, " ")
        .trim();
    }
    return current;
  };

  const title = cleanText(finding.title);
  let body = cleanText(finding.body);

  const bodyPrefix = cleanText(body.split("\n")[0]);
  if (
    bodyPrefix.toLowerCase().startsWith(title.toLowerCase()) ||
    title.toLowerCase().startsWith(bodyPrefix.toLowerCase())
  ) {
    body = cleanText(body.slice(body.split("\n")[0].length));
  }

  return { severity, title, body };
}

function applyClaimGate(
  finding: RawFinding,
  title: string,
  body: string,
  anchorContent: string,
  deniedClaimTypes: Set<ClaimType>,
  claimTypeCounts: Record<string, number>,
  deniedClaimCounts: Record<string, number>,
): { claimType: ClaimType } | { withheld: Withheld } {
  const claimType = repairClaimType(
    toClaimType(finding.claim_type),
    title,
    body,
    () => {
      claimTypeCounts.__repaired = (claimTypeCounts.__repaired ?? 0) + 1;
    },
  );

  claimTypeCounts[claimType] = (claimTypeCounts[claimType] ?? 0) + 1;

  if (deniedClaimTypes.has(claimType)) {
    deniedClaimCounts[claimType] = (deniedClaimCounts[claimType] ?? 0) + 1;
    return { withheld: { title, body, tag: `claim-denied:${claimType}` } };
  }

  if (isVersionClaimRefutedByPin({ title, body, anchorContent })) {
    deniedClaimCounts.version_claim_on_pinned_sha =
      (deniedClaimCounts.version_claim_on_pinned_sha ?? 0) + 1;
    return { withheld: { title, body, tag: "refuted:pinned-sha" } };
  }

  const undecidable = refuteUndecidableClaim({ title, body });
  if (undecidable) {
    const key = `undecidable_${undecidable.replace("-", "_")}`;
    deniedClaimCounts[key] = (deniedClaimCounts[key] ?? 0) + 1;
    return { withheld: { title, body, tag: `refuted:${undecidable}` } };
  }

  return { claimType };
}

function buildParsedComment(params: {
  file: FileDiff;
  line: number;
  position: number;
  severity: (typeof reviewSeverities)[number];
  title: string;
  body: string;
  claimType: ClaimType;
  anchorContent: string;
  finding: RawFinding;
}): ParsedReviewComment {
  const {
    file,
    line,
    position,
    severity,
    title,
    body,
    claimType,
    anchorContent,
    finding,
  } = params;

  const confidenceScore =
    typeof finding.confidence_score === "number" ? finding.confidence_score : 0;

  const codeSuggestion =
    typeof finding.code_suggestion === "string" &&
    finding.code_suggestion.trim()
      ? finding.code_suggestion
      : undefined;

  return parsedReviewCommentSchema.parse({
    path: file.path,
    line,
    position,
    severity,
    category: CLAIM_TYPE_CATEGORY[claimType],
    claimType,
    contextSnippet: renderDiffSnippet(file, line) || undefined,
    title,
    body: withSuggestion(body, codeSuggestion),
    codeSuggestion,
    confidenceScore,
    evidence:
      typeof finding.evidence === "string" && finding.evidence.trim()
        ? finding.evidence.trim()
        : undefined,
    fingerprint: buildFindingFingerprint(file.path, title),
    anchorHash: anchorContent ? buildAnchorHash(anchorContent) : undefined,
    fingerprintV2:
      buildFindingFingerprintV2(
        file.path,
        claimType,
        anchorContent ? buildAnchorHash(anchorContent) : undefined,
      ) ?? undefined,
  });
}

export type FileReviewPayload = z.infer<typeof fileReviewModelOutputSchema>;

export type GroundingOptions = {
  deniedClaimTypes?: readonly ClaimType[];
  ambiguity?: BinAmbiguity;
  // The file's validated post-change content, when `full_file_context` fetched one. Only widens the
  // absence check: an identifier the diff never showed is still present in the file, and a claim that
  // it is missing is refutable by looking. Evidence stays diff-anchored regardless.
  fileContent?: string | null;
};

export type GroundedFileReview = {
  comments: ParsedReviewComment[];
  verdict: "approve" | "comment";
  fileSummary: string;
  overallCorrectness?: string;
  confidenceScore?: number;
  evidenceStats: {
    total: number;
    matched: number;
    unmatched: number;
    weak: number;
    absent: number;
    contextOnly: number;
  };
  claimTypeCounts: Record<string, number>;
  deniedClaimCounts: Record<string, number>;
  absenceCheckStats: {
    absenceShaped: number;
    identifierExtracted: number;
    refuted: number;
  };
};

export function groundParsedFindings(
  parsed: FileReviewPayload,
  file: FileDiff,
  options?: GroundingOptions,
): GroundedFileReview {
  const validPositions = getValidPositions(file);
  const evidenceIndex = buildEvidenceIndex(file);
  const evidenceStats = {
    total: 0,
    matched: 0,
    unmatched: 0,
    weak: 0,
    absent: 0,
    contextOnly: 0,
  };
  const claimTypeCounts: Record<string, number> = {};
  const deniedClaimCounts: Record<string, number> = {};
  const deniedClaimTypes = new Set<ClaimType>(options?.deniedClaimTypes ?? []);
  const presenceIndex = buildPresenceIndex(file, options?.fileContent);
  const absenceCheckStats = {
    absenceShaped: 0,
    identifierExtracted: 0,
    refuted: 0,
  };
  const orphanedComments: string[] = [];

  const comments = (parsed.findings || [])
    .map((finding): ParsedReviewComment | null => {
      const grounded = groundFindingInEvidence(
        finding,
        evidenceIndex,
        evidenceStats,
        options?.ambiguity,
      );
      if ("withheld" in grounded) {
        orphanedComments.push(formatWithheld(grounded.withheld));
        return null;
      }

      const anchored = anchorToDiffPosition(
        file,
        grounded.diffLine,
        validPositions,
        finding,
      );
      if ("withheld" in anchored) {
        orphanedComments.push(formatWithheld(anchored.withheld));
        return null;
      }

      const { severity, title, body } = validateFindingShape(finding);

      const anchorContent =
        grounded.diffLine.content ??
        file.hunks
          .flatMap((h) => h.lines)
          .find((l) => l.newLineNumber === anchored.line)?.content ??
        "";

      const gated = applyClaimGate(
        finding,
        title,
        body,
        anchorContent,
        deniedClaimTypes,
        claimTypeCounts,
        deniedClaimCounts,
      );
      if ("withheld" in gated) {
        orphanedComments.push(formatWithheld(gated.withheld));
        return null;
      }

      // "X is missing / was removed / is never awaited", answered by looking. This verdict was computed
      // and then thrown away for a long time -- the finding was posted regardless -- so the machinery
      // was there and simply had no teeth.
      const absence = checkAbsenceClaim({
        title,
        body,
        anchorLine: anchored.line,
        index: presenceIndex,
      });
      if (absence.status === "refuted") {
        absenceCheckStats.absenceShaped += 1;
        absenceCheckStats.identifierExtracted += 1;
        absenceCheckStats.refuted += 1;

        // Not at P0. The matcher is a literal search over stripped source: it cannot tell a call from a
        // definition, or a live path from a dead one. Silencing a wrong nit is cheap; silencing a
        // correct P0 is not, and `claim-checks.ts` is written to be sound in exactly this direction.
        if (severity !== "P0") {
          logger.info(`Refuted an absence claim in ${file.path}`, {
            identifier: absence.identifier,
            foundAtLine: absence.line,
            title,
          });
          orphanedComments.push(
            formatWithheld({
              title,
              body,
              tag: `refuted:absence:${absence.identifier}`,
            }),
          );
          return null;
        }
      } else if (absence.reason !== "not_absence_shaped") {
        absenceCheckStats.absenceShaped += 1;
        if (
          absence.reason !== "no_identifier" &&
          absence.reason !== "ambiguous_identifier"
        ) {
          absenceCheckStats.identifierExtracted += 1;
        }
      }

      try {
        return buildParsedComment({
          file,
          line: anchored.line,
          position: anchored.position,
          severity,
          title,
          body,
          claimType: gated.claimType,
          anchorContent,
          finding,
        });
      } catch (error) {
        if (!(error instanceof z.ZodError)) throw error;

        orphanedComments.push(
          formatWithheld({
            title: finding.title,
            body: finding.body,
            tag: "unverified:unassemblable",
          }),
        );
        logger.warn("Dropped a finding that could not be assembled", {
          path: file.path,
          title: finding.title,
          error: error.message,
        });
        return null;
      }
    })
    .filter((comment): comment is ParsedReviewComment => Boolean(comment));

  const verdict = parsed.overall_correctness
    .toLowerCase()
    .includes("patch is correct")
    ? "approve"
    : "comment";
  let fileSummary = parsed.overall_explanation;

  if (orphanedComments.length > 0) {
    fileSummary += `\n\n### Additional Comments (Off-diff)\n${orphanedComments.join("\n")}`;
  }

  return {
    comments,
    verdict: comments.length > 0 ? "comment" : verdict,
    fileSummary,
    overallCorrectness: parsed.overall_correctness,
    confidenceScore: parsed.overall_confidence_score,
    evidenceStats,
    claimTypeCounts,
    deniedClaimCounts,
    absenceCheckStats,
  };
}

export function parseFileReviewResponse(
  raw: string,
  file: FileDiff,
  options?: GroundingOptions,
): GroundedFileReview {
  return groundParsedFindings(parseRawPayload(raw), file, options);
}

export { dedupeFindings } from "./dedupe";
export { isNonAnswerReview } from "./non-answer";
export {
  NON_ANSWER_MAX_RESPONSE_CHARS,
  NON_ANSWER_MIN_DIFF_LINES,
} from "../constants";
export { parseRawBatchPayload, type RawBatchPayload } from "./json-batch";
export {
  parseBatchReviewResponse,
  type BatchParseStats,
  type BatchReviewResult,
} from "./batch";
