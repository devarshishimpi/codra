import type { ClaimType, ParsedReviewComment } from "@codraoss/schema";
import type { DiffLine, FileDiff } from "../diff";
import { commentSyntaxFor, stripCommentsAndStrings } from "../claim-checks";
import {
  buildAnchorHash,
  buildFindingFingerprint,
  buildFindingFingerprintV2,
  normalizeDiffText,
} from "../fingerprint";
import { CLAIM_TYPE_CATEGORY } from "@codraoss/schema";
import { RULES, type Rule } from "./table";

import { MAX_RULE_SCAN_ADDED_LINES } from "../constants";

export type RuleHit = {
  rule: Rule;
  line: DiffLine;
  shadow: boolean;
};

export type RuleScanStats = {
  addedLinesScanned: number;
  sievePassed: number;
  hits: number;
  shadowHits: number;
  suppressedAsMoved: number;
  unstrippable: number;
  truncated: boolean;
  byRule: Record<string, number>;
};

export type RuleScanResult = { hits: RuleHit[]; stats: RuleScanStats };

export type RuleScanOptions = {
  disabledRuleIds?: readonly string[];
  shadowRuleIds?: readonly string[];
  deniedClaimTypes?: readonly ClaimType[];
};

function extensionOf(path: string) {
  return path.toLowerCase().split(".").pop() ?? "";
}

function ruleApplies(rule: Rule, ext: string) {
  return !rule.extensions || rule.extensions.includes(ext);
}

export function scanFileForRuleHits(
  file: FileDiff,
  options: RuleScanOptions = {},
): RuleScanResult {
  const stats: RuleScanStats = {
    addedLinesScanned: 0,
    sievePassed: 0,
    hits: 0,
    shadowHits: 0,
    suppressedAsMoved: 0,
    unstrippable: 0,
    truncated: false,
    byRule: {},
  };
  const hits: RuleHit[] = [];

  if (file.isDeleted || file.isBinary || !file.path) return { hits, stats };

  const ext = extensionOf(file.path);
  const denied = new Set(options.deniedClaimTypes ?? []);
  const disabled = new Set(options.disabledRuleIds ?? []);
  const shadowIds = new Set(options.shadowRuleIds ?? []);

  const active = RULES.filter(
    (rule) =>
      rule.enabled &&
      !disabled.has(rule.id) &&
      !denied.has(rule.claimType) &&
      ruleApplies(rule, ext),
  );
  if (active.length === 0) return { hits, stats };

  const triggers = [...new Set(active.flatMap((rule) => rule.triggers))];
  const syntax = commentSyntaxFor(file.path);

  for (const hunk of file.hunks) {
    const removed = new Set<string>();
    for (const l of hunk.lines) {
      if (l.kind === "del") removed.add(normalizeDiffText(l.content));
    }

    for (const line of hunk.lines) {
      if (line.kind !== "add") continue;
      if (stats.addedLinesScanned >= MAX_RULE_SCAN_ADDED_LINES) {
        stats.truncated = true;
        break;
      }
      stats.addedLinesScanned += 1;

      const raw = line.content;
      if (!triggers.some((trigger) => raw.includes(trigger))) continue;
      stats.sievePassed += 1;

      const stripped = stripCommentsAndStrings(raw, syntax);
      if (stripped === null) {
        stats.unstrippable += 1;
        continue;
      }

      for (const rule of active) {
        if (!rule.triggers.some((trigger) => raw.includes(trigger))) continue;
        if (!rule.pattern.test(stripped)) continue;
        if (rule.rejectRaw?.test(raw)) continue;

        if (removed.has(normalizeDiffText(raw))) {
          stats.suppressedAsMoved += 1;
          continue;
        }

        const shadow = shadowIds.has(rule.id);
        hits.push({ rule, line, shadow });
        stats.byRule[rule.id] = (stats.byRule[rule.id] ?? 0) + 1;
        if (shadow) stats.shadowHits += 1;
        else stats.hits += 1;
        break;
      }
    }
    if (stats.truncated) break;
  }

  return { hits, stats };
}

export function ruleHitsToComments(
  file: FileDiff,
  result: RuleScanResult,
): ParsedReviewComment[] {
  const comments: ParsedReviewComment[] = [];
  for (const hit of result.hits) {
    if (hit.shadow) continue;

    const { rule, line } = hit;
    const anchorHash = buildAnchorHash(line.content);
    comments.push({
      path: file.path,
      line: line.newLineNumber ?? null,
      position: line.position ?? null,
      severity: rule.severity,
      category: CLAIM_TYPE_CATEGORY[rule.claimType] ?? "quality",
      title: rule.title,
      body: rule.body,
      evidence: line.content,
      anchorHash,
      claimType: rule.claimType,
      fingerprint: buildFindingFingerprint(
        file.path,
        `${rule.title} @${anchorHash}`,
      ),
      fingerprintV2: buildFindingFingerprintV2(
        file.path,
        rule.claimType,
        anchorHash,
      ),
      source: "rule" as const,
      ruleId: rule.id,
    } satisfies ParsedReviewComment);
  }

  return comments;
}
