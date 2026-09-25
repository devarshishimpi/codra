import { describe, expect, it } from "vitest";
import { getLanguageForFile } from "@codraoss/core/prompts/languages";
import {
  buildFileReviewPrompts,
  buildFileReviewSystemPromptBase,
  buildReviewResponseSchema,
  generatorFindingCap,
  reviewBreadth,
} from "@codraoss/core/prompts/file-review";
import { defaultRepoConfig } from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

function fileAt(path: string): FileDiff {
  return {
    path,
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: 1,
    hunks: [
      {
        header: "@@ -1,1 +1,1 @@",
        lines: [
          {
            kind: "add",
            content: "const timeout = config.timeout;",
            newLineNumber: 1,
            position: 1,
          },
        ],
      },
    ],
  };
}

const promptFor = (path: string) =>
  buildFileReviewPrompts({
    file: fileAt(path),
    prTitle: "PR",
    prDescription: null,
    config: defaultRepoConfig.review,
  });

describe("language guideline selection", () => {
  // .tsx used to match both TypeScript and React entries, merging personas.
  it("does not hand .tsx files a hook-dependency checklist", () => {
    const { systemPrompt, userPrompt } = promptFor(
      "src/client/pages/settings.tsx",
    );
    const combined = `${systemPrompt}\n${userPrompt}`;
    expect(combined).not.toMatch(/useEffect|useCallback|useMemo/);
    expect(combined).not.toMatch(/dependenc/i);
  });

  it("gives .tsx a single, un-merged persona", () => {
    const info = getLanguageForFile("src/client/pages/settings.tsx");
    expect(info?.persona).toBe(
      "an expert TypeScript engineer focused on correctness and safe async code",
    );
    expect(info?.language).toBe("TypeScript/JavaScript");
    expect(info?.persona).not.toMatch(/react|hook/i);
  });

  it("falls back cleanly for an unknown extension", () => {
    expect(getLanguageForFile("bin/tool.xyz")).toBeUndefined();
    expect(promptFor("bin/tool.xyz").userPrompt).toContain("Language: Generic");
  });
});

// Contract stated in grammar and both prompts; must agree or decoder/prose diverge.
describe("output contract", () => {
  const schema = buildReviewResponseSchema(10) as unknown as {
    schema: {
      properties: {
        findings: {
          items: { required: string[]; properties: Record<string, unknown> };
        };
      };
    };
  };
  const finding = schema.schema.properties.findings.items;
  const systemBase = buildFileReviewSystemPromptBase();
  const { userPrompt } = promptFor("src/app.ts");

  const _orderIn = (text: string, fields: string[]) =>
    fields.map((f) => text.indexOf(`"${f}"`));
  const _isAscending = (positions: number[]) =>
    positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1]));

  it("requires evidence first, before any prose field", () => {
    expect(finding.required[0]).toBe("evidence");
    expect(finding.required.indexOf("evidence")).toBeLessThan(
      finding.required.indexOf("title"),
    );
    expect(finding.required.indexOf("evidence")).toBeLessThan(
      finding.required.indexOf("body"),
    );
    expect(finding.required.indexOf("evidence")).toBeLessThan(
      finding.required.indexOf("priority"),
    );
  });

  // Restraints no downstream gate can check; generator is the only enforcement point.
  it("keeps the restraints the gates cannot replace", () => {
    expect(systemBase).toMatch(/ONLY the diff/);
    expect(systemBase).toMatch(
      /Never predict that a change breaks callers, importers/,
    );
    expect(systemBase).toMatch(
      /your training data predates the installed version/,
    );
    expect(systemBase).toMatch(
      /Do not raise compatibility, polyfill, transpilation, engine-version or server-side-rendering concerns/,
    );

    // Evidence mandate: without it, recall goes to zero.
    expect(systemBase).toMatch(/copied VERBATIM from the diff/);
    expect(systemBase).toMatch(/you do not have a finding/);

    // External-version prohibition: 12 of the corpus's 23 denials.
    expect(systemBase).toMatch(
      /NEVER claim that a package, action, tag or version "does not exist"/,
    );
    expect(systemBase).toMatch(/resolves by that SHA/);

    expect(userPrompt).toMatch(/avoid subjective style feedback/);

    expect(systemBase).toMatch(/at most priority 3, never 0 or 1/);
  });
});

describe("the generator", () => {
  const _systemBase = buildFileReviewSystemPromptBase();

  it("bounds the grammar by the review breadth it is handed", () => {
    const maxItems = (cap: number) =>
      (
        buildReviewResponseSchema(cap) as unknown as {
          schema: { properties: { findings: { maxItems: number } } };
        }
      ).schema.properties.findings.maxItems;

    expect(maxItems(reviewBreadth(defaultRepoConfig.review))).toBe(25);
    expect(reviewBreadth(defaultRepoConfig.review)).toBeGreaterThan(
      defaultRepoConfig.review.max_comments,
    );
    expect(maxItems(0)).toBe(1);
  });

  it("falls back to the old derivation for a config snapshot with no review_breadth", () => {
    const legacy = {
      ...defaultRepoConfig.review,
      review_breadth: undefined,
    } as unknown as typeof defaultRepoConfig.review;

    expect(reviewBreadth(legacy)).toBe(
      generatorFindingCap(defaultRepoConfig.review.max_comments),
    );
    expect(generatorFindingCap(10)).toBe(20);
    expect(generatorFindingCap(1)).toBe(2);
  });
});

// ContextCRBench: diff-only F1 36.08, +PR description 62.12, +enclosing function only 42.56.
describe("PR description context", () => {
  it("carries substantially more of the description than a single truncated paragraph", () => {
    const description = `${"x".repeat(1_500)}NEEDLE${"y".repeat(1_000)}`;
    const { userPrompt } = buildFileReviewPrompts({
      file: fileAt("src/app.ts"),
      prTitle: "PR",
      prDescription: description,
      config: defaultRepoConfig.review,
    });

    expect(userPrompt).toContain("NEEDLE");
    expect(userPrompt).toContain("…");
  });
});

// Rejected findings only; RAG few-shot took F1 36.35 to 74.05, the strongest lever at this size.
describe("rejected exemplars", () => {
  const withExemplars = (
    exemplars: Array<{ title: string; claimType?: string | null }>,
  ) =>
    buildFileReviewPrompts({
      file: fileAt("src/app.ts"),
      prTitle: "PR",
      prDescription: null,
      config: defaultRepoConfig.review,
      rejectedExemplars: exemplars,
    }).userPrompt;

  it("injects rejected findings as things not to report", () => {
    const prompt = withExemplars([
      {
        title: "Invalid GitHub Action version",
        claimType: "external_version_claim",
      },
    ]);
    expect(prompt).toMatch(/already rejected/i);
    expect(prompt).toContain("Invalid GitHub Action version");
    expect(prompt).toContain("external_version_claim");
  });

  it("caps the block rather than letting it grow with the label count", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      title: `Rejected finding number ${i} with a long title`,
    }));
    const prompt = withExemplars(many);

    // Count exemplars included, not the whole prompt text.
    const included = many.filter((e) => prompt.includes(e.title));
    expect(included.length).toBeGreaterThan(0);
    expect(included.length).toBeLessThan(20);
    expect(prompt).not.toContain("Rejected finding number 99");
  });
});
