import {
  fileReviewModelOutputSchema,
  type ClaimType,
  type ParsedReviewComment,
} from "@codraoss/schema";
import { logger } from "../logger";
import { z } from "zod";
import {
  findPositionForLine,
  getValidPositions,
  type DiffLine,
  type FileDiff,
} from "../diff";
import {
  buildPresenceIndex,
  checkAbsenceClaim,
} from "../claim-checks";
import { parseRawPayload } from "./json";
import {
  type EvidenceIndex,
  buildEvidenceIndex,
  foldFirstEvidenceLine,
  resolveEvidence,
} from "./evidence";
import {
  type BinAmbiguity,
  type RawFinding,
  type Withheld,
  formatWithheld,
  samePath,
  validateFindingShape,
  applyClaimGate,
  buildParsedComment,
} from "./claim-gate";

export function groundFindingInEvidence(
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

export function anchorToDiffPosition(
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

  const hasFindings = comments.length > 0;
  const verdict = parsed.overall_correctness
    ? (parsed.overall_correctness.toLowerCase().includes("patch is correct") ? "approve" : "comment")
    : (hasFindings ? "comment" : "approve");
  let fileSummary = parsed.overall_explanation || (hasFindings ? "Findings reported on modified lines." : "No defects identified.");

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
