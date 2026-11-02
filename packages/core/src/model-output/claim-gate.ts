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
import { z } from "zod";
import type { FileDiff } from "../diff";
import {
  buildAnchorHash,
  buildFindingFingerprint,
  buildFindingFingerprintV2,
} from "../fingerprint";
import {
  isVersionClaimRefutedByPin,
  looksLikeExternalVersionClaim,
  refuteUndecidableClaim,
} from "../claim-checks";
import type { BinAmbiguityIndex } from "./evidence";

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

export function withSuggestion(body: string, codeSuggestion?: string) {
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

export function repairClaimType(
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

export type RawFinding = z.infer<
  typeof fileReviewModelOutputSchema
>["findings"][number];

export type Withheld = { title: string; body: string; tag?: string };

export function formatWithheld(w: Withheld): string {
  return w.tag
    ? `- **[${w.tag}] ${w.title}:** ${w.body}`
    : `- **${w.title}:** ${w.body}`;
}

export function validateFindingShape(finding: RawFinding): {
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

export function applyClaimGate(
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

  // Real defect categories such as resource leaks or null dereferences are not dropped here, before
  // verification: the verifier inspects them.
  const hardDenied = new Set([
    "react_hook_missing_deps",
    "react_missing_cleanup",
    "redos_regex",
    "external_version_claim",
  ]);
  if (hardDenied.has(claimType)) {
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

export function buildParsedComment(params: {
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
    typeof finding.confidence_score === "number" ? finding.confidence_score : undefined;

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
