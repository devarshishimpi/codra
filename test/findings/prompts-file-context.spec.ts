import { describe, expect, it } from "vitest";
import {
  buildFileReviewPrompts,
  buildFileReviewSystemPromptBase,
  wantsFileContext,
} from "@codraoss/core/prompts/file-review";
import { contentMatchesDiff } from "../../packages/core/src/review/file-context";
import { defaultRepoConfig, type RepoConfig } from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

const SOURCE = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`);

function largeFile(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: "src/app.ts",
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: 300,
    hunks: [
      {
        header: "@@ -200,2 +200,2 @@",
        lines: [
          {
            kind: "context",
            content: "line 200",
            oldLineNumber: 200,
            newLineNumber: 200,
            position: 1,
          },
          { kind: "add", content: "line 201", newLineNumber: 201, position: 2 },
        ],
      },
    ],
    ...overrides,
  };
}

const withContext = (review: Partial<RepoConfig["review"]> = {}) => ({
  ...defaultRepoConfig.review,
  full_file_context: true,
  ...review,
});

describe("wantsFileContext", () => {
  it("is off unless the repo asks for it", () => {
    expect(wantsFileContext(largeFile(), false)).toBe(false);
    expect(wantsFileContext(largeFile(), true)).toBe(true);
  });

  it("is scoped to files whose diff is larger than a packable one", () => {
    expect(wantsFileContext(largeFile({ lineCount: 150 }), true)).toBe(false);
    expect(wantsFileContext(largeFile({ lineCount: 151 }), true)).toBe(true);
  });

  it("skips files whose content the diff already contains, or that have none", () => {
    expect(wantsFileContext(largeFile({ isNew: true }), true)).toBe(false);
    expect(wantsFileContext(largeFile({ isDeleted: true }), true)).toBe(false);
    expect(wantsFileContext(largeFile({ isBinary: true }), true)).toBe(false);
  });

  it("does not enlarge a prompt that is being retried for being too much", () => {
    expect(wantsFileContext(largeFile(), true, { compactPrompt: true })).toBe(
      false,
    );
  });
});

describe("contentMatchesDiff", () => {
  it("accepts content whose lines sit where the diff says they do", () => {
    expect(contentMatchesDiff(largeFile(), SOURCE.join("\n"))).toBe(true);
  });

  it("rejects content that has shifted out from under the diff", () => {
    const shifted = ["a new import", ...SOURCE].join("\n");
    expect(contentMatchesDiff(largeFile(), shifted)).toBe(false);
  });

  it("rejects a diff with nothing to check against", () => {
    const deletionOnly = largeFile({
      hunks: [
        {
          header: "@@ -200,1 +199,0 @@",
          lines: [
            {
              kind: "del",
              content: "line 200",
              oldLineNumber: 200,
              position: 1,
            },
          ],
        },
      ],
    });
    expect(contentMatchesDiff(deletionOnly, SOURCE.join("\n"))).toBe(false);
  });
});

describe("the full-file context block", () => {
  const build = (fileContext: string | null) =>
    buildFileReviewPrompts({
      file: largeFile(),
      fileContext,
      prTitle: "PR",
      prDescription: null,
      config: withContext(),
    });

  it("windows the file around this prompt's own hunks rather than pasting all of it", () => {
    const { userPrompt } = build(SOURCE.join("\n"));

    expect(userPrompt).toContain("Full file after the change");
    expect(userPrompt).toContain("80\tline 80");
    expect(userPrompt).toContain("321\tline 321");
    expect(userPrompt).not.toContain("79\tline 79");
    expect(userPrompt).not.toContain("322\tline 322");
  });

  it("bounds the block even when the window is enormous", () => {
    const wide = largeFile({
      hunks: [
        {
          header: "@@ -1,400 +1,400 @@",
          lines: [
            {
              kind: "context",
              content: "line 1",
              oldLineNumber: 1,
              newLineNumber: 1,
              position: 1,
            },
            {
              kind: "context",
              content: "line 400",
              oldLineNumber: 400,
              newLineNumber: 400,
              position: 2,
            },
          ],
        },
      ],
    });
    const long = Array.from(
      { length: 400 },
      (_, i) => `line ${i + 1}${"x".repeat(200)}`,
    );
    const { userPrompt } = buildFileReviewPrompts({
      file: wide,
      fileContext: long.join("\n"),
      prTitle: "PR",
      prDescription: null,
      config: withContext(),
    });

    const block = userPrompt.slice(
      userPrompt.indexOf("Full file after the change"),
    );
    expect(block.length).toBeLessThan(9_000);
  });

  it("tells the model the context is not evidence", () => {
    const { userPrompt, systemPrompt } = build(SOURCE.join("\n"));

    expect(userPrompt).toMatch(
      /copied character-for-character from the UNIFIED DIFF/,
    );
    expect(userPrompt).toMatch(/counts as no evidence at all/);
    expect(systemPrompt).not.toMatch(/You can see ONLY the diff below/);
    expect(systemPrompt).toMatch(/cannot see the rest of the repository/);
  });

  it("changes nothing at all when no context was fetched", () => {
    const { userPrompt, systemPrompt } = build(null);

    expect(userPrompt).not.toContain("Full file after the change");
    expect(userPrompt).not.toContain("counts as no evidence at all");
    expect(systemPrompt).toMatch(/You can see ONLY the diff below/);
    expect(buildFileReviewSystemPromptBase()).toMatch(/ONLY the diff/);
  });
});
