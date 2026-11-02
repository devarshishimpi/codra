import { describe, expect, it } from "vitest";
import { parseFileReviewResponse } from "@codraoss/core/model-output";
import { verifyFindings } from "@server/core/review";
import {
  DEFAULT_DENIED_CLAIM_TYPES,
  defaultRepoConfig,
} from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

// The regression wall.
//
// These two findings are REAL defects, confirmed by hand and deliberately left unfixed in the
// repository so that review accuracy can be measured against something known-true. Every filter in
// this round is subtractive, and the honest failure mode of subtraction is that precision "improves"
// because the true positives were quietly eaten along with the false ones.
//
// If a future tightening breaks these tests, that tightening is not an improvement -- it is a recall
// regression that the precision numbers will not show you.

const appShell: FileDiff = {
  path: "src/client/components/layout/app-shell.tsx",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 4,
  hunks: [
    {
      header: "@@ -40,3 +40,4 @@",
      lines: [
        {
          kind: "context",
          content: "  const handleSignOut = () => {",
          newLineNumber: 40,
          position: 1,
        },
        {
          kind: "add",
          content: "    logout();",
          newLineNumber: 41,
          position: 2,
        },
        {
          kind: "add",
          content: '    navigate("/login");',
          newLineNumber: 42,
          position: 3,
        },
        { kind: "context", content: "  };", newLineNumber: 43, position: 4 },
      ],
    },
  ],
};

const button: FileDiff = {
  path: "src/client/components/ui/button.tsx",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 4,
  hunks: [
    {
      header: "@@ -20,3 +20,4 @@",
      lines: [
        {
          kind: "add",
          content: "  if (asChild) {",
          newLineNumber: 20,
          position: 1,
        },
        {
          kind: "add",
          content: "    return <Slot className={classes} {...rest} />;",
          newLineNumber: 21,
          position: 2,
        },
        { kind: "context", content: "  }", newLineNumber: 22, position: 3 },
        {
          kind: "context",
          content: "  return <button disabled={loading} {...rest} />;",
          newLineNumber: 23,
          position: 4,
        },
      ],
    },
  ],
};

function review(finding: Record<string, unknown>) {
  return JSON.stringify({
    findings: [finding],
    overall_correctness: "patch is incorrect",
    overall_explanation: "explanation",
    overall_confidence_score: 0.8,
  });
}

const gold = [
  {
    name: "un-awaited logout() leaves an unhandled promise rejection",
    file: appShell,
    finding: {
      title: "Unawaited logout call",
      body: "The `logout()` call returns a promise that is never awaited, so a failure surfaces as an unhandled rejection and navigation proceeds regardless.",
      priority: 1,
      confidence_score: 0.8,
      claim_type: "unhandled_promise_rejection",
      evidence: "    logout();",
      code_location: { absolute_file_path: appShell.path, line: 41 },
    },
  },
  {
    name: "asChild render path bypasses the loading guard",
    file: button,
    finding: {
      title: "Loading state ignored on the asChild path",
      body: "When `asChild` is set the component returns early and renders Slot, so the `disabled={loading}` guard on the normal path never applies and the button stays clickable while loading.",
      priority: 2,
      confidence_score: 0.7,
      claim_type: "other",
      evidence: "  if (asChild) {",
      code_location: { absolute_file_path: button.path, line: 20 },
    },
  },
];

describe("gold set: known-true findings survive the full gate chain", () => {
  for (const { name, file, finding } of gold) {
    it(`parses and keeps: ${name}`, () => {
      const result = parseFileReviewResponse(review(finding), file, {
        deniedClaimTypes: [...DEFAULT_DENIED_CLAIM_TYPES],
      });

      expect(result.comments).toHaveLength(1);
      // Evidence must resolve, or Phase 1's gate would drop it.
      expect(result.evidenceStats.matched).toBe(1);
      // Claim type must not be on the denylist, nor repaired onto it.
      expect(result.deniedClaimCounts).toEqual({});
      // And the shadow-mode absence check must not be refuting it.
      expect(result.absenceCheckStats.refuted).toBe(0);
    });

    it(`survives the Gatekeeper: ${name}`, async () => {
      const parsed = parseFileReviewResponse(review(finding), file, {
        deniedClaimTypes: [...DEFAULT_DENIED_CLAIM_TYPES],
      });

      const outcome = await verifyFindings({
        job: { id: "gold-1" },
        config: defaultRepoConfig,
        files: [file],
        comments: parsed.comments,
        model: {
          verifyFindings: async () => ({
            rawText:
              '{"results":[{"index":0,"reason":"claim matches the cited line","verdict":"keep"}]}',
            inputTokens: 0,
            outputTokens: 0,
            modelUsed: "m",
            provider: "p",
          }),
        },
      });

      expect(outcome.comments).toHaveLength(1);
      expect(outcome.dropped).toHaveLength(0);
    });
  }
});
