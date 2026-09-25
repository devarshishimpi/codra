import { describe, expect, it } from "vitest";
import {
  buildBatchReviewPrompts,
  buildBatchReviewResponseSchema,
  buildReviewResponseSchema,
  reviewBreadth,
} from "@codraoss/core/prompts/file-review";
import { BIN_DIFF_CHAR_BUDGET, BIN_MAX_FILES } from "@server/core/review";
import {
  PROMPT_FIT_SAFETY_FACTOR,
  estimatePromptTokens,
} from "@codraoss/models";
import { defaultRepoConfig } from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

function file(path: string, lines: string[]): FileDiff {
  return {
    path,
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: lines.length,
    hunks: [
      {
        header: "@@ -1,10 +1,10 @@",
        lines: lines.map((content, i) => ({
          kind: "add" as const,
          content,
          newLineNumber: i + 1,
          oldLineNumber: undefined,
          position: i + 1,
        })),
      },
    ],
  };
}

const build = (
  files: FileDiff[],
  overrides: Partial<Parameters<typeof buildBatchReviewPrompts>[0]> = {},
) =>
  buildBatchReviewPrompts({
    files,
    prTitle: "Batch it",
    prDescription: "Pack small files together.",
    config: defaultRepoConfig.review,
    ...overrides,
  });

describe("buildBatchReviewPrompts", () => {
  it("renders every packed file exactly once, with its diff", () => {
    const files = [
      file("src/a.ts", ["const a = 1;"]),
      file("src/b.ts", ["const b = 2;"]),
      file("src/c.ts", ["const c = 3;"]),
    ];

    const { userPrompt } = build(files);

    // Segment 0 is the preamble and lists every path, so tie each file to its OWN segment.
    const segments = userPrompt.split("===== FILE ");
    expect(segments).toHaveLength(files.length + 1);
    files.forEach((f, i) => {
      const segment = segments[i + 1];
      expect(segment.startsWith(`${i + 1} of 3: ${f.path} =====`)).toBe(true);
      expect(segment).toContain(`b/${f.path}`);
      expect(segment).toContain(`const ${["a", "b", "c"][i]} = ${i + 1};`);
    });
  });

  // A persona claims something about the whole response, so a mixed bin drops to generic and
  // move the guidelines next to the file they apply to.
  it("substitutes the cap and states the persona once per language present", () => {
    const uniform = build([file("src/a.ts", ["a"]), file("src/b.ts", ["b"])]);
    expect(uniform.systemPrompt).not.toContain("{{MAX_COMMENTS}}");
    expect(uniform.systemPrompt).toContain(
      `at most ${reviewBreadth(defaultRepoConfig.review)} findings PER FILE`,
    );
    expect(uniform.systemPrompt).toMatch(
      /^You are a world-class professional senior code reviewer as .+\./,
    );
    expect(uniform.userPrompt.match(/^Language: /gm)).toHaveLength(1);

    const mixed = build([file("src/a.ts", ["a"]), file("main.py", ["b"])]);
    expect(mixed.systemPrompt).toMatch(
      /^You are a world-class professional senior code reviewer\. /,
    );
    expect(mixed.userPrompt.match(/^Language: /gm)).toHaveLength(2);
  });

  // A refusal costs the whole bin, so a worst-case bin must fit with room to spare.
  it("a worst-case bin fits inside the rate-limit bucket", () => {
    const LEARNED_BUCKET_TOKENS = 16_000;
    const perFileChars = Math.floor(BIN_DIFF_CHAR_BUDGET / BIN_MAX_FILES);

    // Distinct extensions so every file also drags in its own language-guideline block.
    const extensions = ["ts", "py", "go", "rb", "java", "rs"];
    const files = Array.from({ length: BIN_MAX_FILES }, (_, i) =>
      file(
        `src/deeply/nested/path/segment/file-number-${i}.${extensions[i % extensions.length]}`,
        Array.from({ length: 40 }, () =>
          "x".repeat(Math.floor(perFileChars / 40) - 12),
        ),
      ),
    );

    const { systemPrompt, userPrompt } = build(files, {
      prDescription: "D".repeat(4_000),
      rejectedExemplars: Array.from({ length: 12 }, (_, i) => ({
        title: `Rejected finding number ${i} with a long title`,
        claimType: "other",
      })),
      config: {
        ...defaultRepoConfig.review,
        custom_rules: Array.from(
          { length: 10 },
          (_, i) => `Custom rule ${i} that is reasonably wordy`,
        ),
      },
    });

    const estimated = estimatePromptTokens(systemPrompt, userPrompt);

    expect(estimated).toBeLessThan(
      LEARNED_BUCKET_TOKENS * PROMPT_FIT_SAFETY_FACTOR,
    );
    // Two-sided: an upper bound alone would still pass if bins shrank to nothing.
    expect(estimated).toBeGreaterThan(5_000);
  });
});

describe("buildBatchReviewResponseSchema", () => {
  const schema = buildBatchReviewResponseSchema(10, 4).schema as any;
  const fileEntry = schema.properties.files.items;

  // Both grammars share findingItemSchema; only the array bounds differ, deliberately.
  it("leaves the per-file findings array unbounded and shares the finding shape with the single-file grammar", () => {
    const single = buildReviewResponseSchema(10).schema as any;

    // The single-file grammar caps in the schema; the batch one cannot. Gemini rejects a bounded
    // array nested inside a bounded array ("too many states for serving") and we lose constrained
    // decoding for the whole bin, so the per-file cap lives in prose and in parse-time truncation.
    expect(single.properties.findings.maxItems).toBe(10);
    expect(fileEntry.properties.findings.maxItems).toBeUndefined();
    expect(schema.properties.files.maxItems).toBe(4);
    // Path first, and required: the nesting is what carries file identity.
    expect(fileEntry.required.indexOf("absolute_file_path")).toBeLessThan(
      fileEntry.required.indexOf("findings"),
    );
    expect(Object.keys(fileEntry.properties)[0]).toBe("absolute_file_path");
    // No minItems -- provider support is uneven and a rejected grammar costs the whole bin.
    expect(schema.properties.files.minItems).toBeUndefined();

    expect(fileEntry.properties.findings.items).toEqual(
      single.properties.findings.items,
    );
    expect(Object.keys(fileEntry.properties.findings.items.properties)[0]).toBe(
      "evidence",
    );
  });
});
