import { describe, expect, it } from "vitest";
import {
  buildBatchReviewPrompts,
  buildFileReviewPrompts,
  changelogExcerptFromDiff,
} from "@codraoss/core/prompts/file-review";
import { defaultRepoConfig } from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

function file(
  path: string,
  lines: Array<{ kind: "add" | "context"; content: string }>,
): FileDiff {
  return {
    path,
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: lines.length,
    hunks: [
      {
        header: "@@ -1,1 +1,1 @@",
        lines: lines.map((line, i) => ({
          ...line,
          newLineNumber: i + 1,
          position: i + 1,
        })),
      },
    ],
  };
}

const codeFile = file("src/app.ts", [
  { kind: "add", content: "const timeout = config.timeout;" },
]);

describe("the PR intent block", () => {
  const build = (
    overrides: Partial<Parameters<typeof buildFileReviewPrompts>[0]> = {},
  ) =>
    buildFileReviewPrompts({
      file: codeFile,
      prTitle: "Drop the retry loop",
      prDescription: "Retries were masking a real upstream outage.",
      config: defaultRepoConfig.review,
      ...overrides,
    }).userPrompt;

  it("states the title and description under one labelled heading", () => {
    const prompt = build();

    expect(prompt).toContain("## PR INTENT (what the author set out to do)");
    expect(prompt).toContain("Title: Drop the retry loop");
    expect(prompt).toContain("Retries were masking a real upstream outage.");
    expect(prompt.indexOf("## PR INTENT")).toBeLessThan(
      prompt.indexOf("Unified diff"),
    );
  });

  it("makes the intent comparison part of the finding contract", () => {
    const prompt = build();

    expect(prompt).toMatch(/Intent check/);
    expect(prompt).toMatch(
      /If what you are about to flag IS the stated intent, it is not a finding/,
    );
  });

  it("still names the PR when there is no title and no description", () => {
    const prompt = build({ prTitle: null, prDescription: null });

    expect(prompt).toContain("Title: Untitled PR");
    expect(prompt).not.toContain("Description:");
    expect(prompt).not.toContain("Changelog lines added by this PR:");
  });

  it("sits in the batch preamble without adding a file segment or a language line", () => {
    const files = [
      codeFile,
      file("main.py", [{ kind: "add", content: "x = 1" }]),
    ];
    const { userPrompt } = buildBatchReviewPrompts({
      files,
      prTitle: "Drop the retry loop",
      prDescription: "Retries were masking a real upstream outage.",
      changelogExcerpt: "- Removed the retry loop.",
      config: defaultRepoConfig.review,
    });

    const segments = userPrompt.split("===== FILE ");
    expect(segments).toHaveLength(files.length + 1);
    expect(segments[0]).toContain("## PR INTENT");
    expect(segments[0]).toContain("- Removed the retry loop.");
    expect(userPrompt.match(/^Language: /gm)).toHaveLength(files.length);
  });
});

describe("changelogExcerptFromDiff", () => {
  const changelog = (
    lines: Array<{ kind: "add" | "context"; content: string }>,
  ) => file("CHANGELOG.md", lines);

  it("takes only the lines the PR added", () => {
    const excerpt = changelogExcerptFromDiff([
      codeFile,
      changelog([
        { kind: "context", content: "## 1.2.0 - an older release" },
        { kind: "add", content: "## 1.3.0" },
        {
          kind: "add",
          content:
            "- Removed the retry loop; failures now surface immediately.",
        },
      ]),
    ]);

    expect(excerpt).toBe(
      "## 1.3.0\n- Removed the retry loop; failures now surface immediately.",
    );
  });

  it("recognises release-notes files by convention, not extension", () => {
    for (const path of [
      "docs/RELEASE_NOTES.rst",
      "History.md",
      "packages/x/changes.txt",
    ]) {
      const excerpt = changelogExcerptFromDiff([
        file(path, [{ kind: "add", content: "- a change" }]),
      ]);
      expect(excerpt).toBe("- a change");
    }
  });

  it("returns null when the PR touched no changelog", () => {
    expect(changelogExcerptFromDiff([codeFile])).toBeNull();
    expect(changelogExcerptFromDiff([])).toBeNull();
    expect(
      changelogExcerptFromDiff([
        changelog([{ kind: "context", content: "## 1.2.0" }]),
      ]),
    ).toBeNull();
  });

  it("bounds a wholesale rewrite", () => {
    const excerpt = changelogExcerptFromDiff([
      changelog(
        Array.from({ length: 200 }, (_, i) => ({
          kind: "add" as const,
          content: `- change number ${i}`,
        })),
      ),
    ]);

    expect(excerpt).not.toBeNull();
    expect(excerpt!.length).toBeLessThanOrEqual(600);
    expect(excerpt).toContain("- change number 0");
    expect(excerpt).not.toContain("- change number 199");
  });

  it("reaches the prompt as its own labelled line", () => {
    const prompt = buildFileReviewPrompts({
      file: codeFile,
      prTitle: "Drop the retry loop",
      prDescription: null,
      changelogExcerpt: "- Removed the retry loop.",
      config: defaultRepoConfig.review,
    }).userPrompt;

    expect(prompt).toContain("Changelog lines added by this PR:");
    expect(prompt).toContain("- Removed the retry loop.");
  });
});
