import {
  chunkFileDiff,
  filterReviewableFiles,
  findPositionForLine,
  getValidNewLines,
  parseDiffHeaderPath,
  parseUnifiedDiff,
  truncateFileDiff,
} from "@codraoss/core/diff";
import { defaultRepoConfig } from "@codraoss/schema";

describe("Diff Engine Deep Dive", () => {
  const sampleDiff = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,4 @@
 const answer = 41;
+const next = answer + 1;
 export function value() {
   return answer;
 }`;

  describe("parseUnifiedDiff", () => {
    it("tracks new lines and GitHub positions for standard diffs", () => {
      const [file] = parseUnifiedDiff(sampleDiff);
      expect(file.path).toBe("src/example.ts");
      expect(file.lineCount).toBe(5);
      expect(getValidNewLines(file)).toEqual(new Set([1, 2, 3, 4, 5]));
      expect(findPositionForLine(file, 2)).toBe(2);
    });

    it("correctly handles file renames", () => {
      const renameDiff = `diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
`;
      const [file] = parseUnifiedDiff(renameDiff);
      expect(file.path).toBe("new-name.ts");
      expect(file.previousPath).toBe("old-name.ts");
    });

    it("gracefully skips binary files", () => {
      const binaryDiff = `diff --git a/image.png b/image.png
index 1234567..890abcd 100644
Binary files a/image.png and b/image.png differ
`;
      const [file] = parseUnifiedDiff(binaryDiff);
      expect(file.isBinary).toBe(true);
      expect(file.path).toBe("image.png");
    });
  });

  describe("truncateFileDiff", () => {
    it("truncates large files to the specified line limit", () => {
      const largeFile = {
        path: "large.ts",
        previousPath: null,
        isNew: false,
        isDeleted: false,
        isBinary: false,
        lineCount: 100,
        hunks: [
          {
            header: "@@ -1,50 +1,50 @@",
            lines: Array(50).fill({
              kind: "add",
              content: "line",
              position: 1,
            }),
          },
          {
            header: "@@ -51,100 +51,100 @@",
            lines: Array(50).fill({
              kind: "add",
              content: "line",
              position: 51,
            }),
          },
        ],
      } as any;

      const truncated = truncateFileDiff(largeFile, 60);
      expect(truncated.isTruncated).toBe(true);
      expect(truncated.hunks).toHaveLength(2);
      expect(truncated.hunks[1].lines).toHaveLength(10);
      expect(truncated.lineCount).toBe(60);
    });
  });

  // chunkFileDiff decides how much of a large file any model ever sees; a silent partition bug means
  // whole regions go unreviewed with nothing to report it. Invariant: every original line appears in
  // exactly one chunk, in order. Truncation is allowed; losing a line in the middle is not.
  describe("chunkFileDiff", () => {
    // Distinct content per line so a dropped or duplicated line is detectable - Array(n).fill(sameObject)
    // would hide exactly the bug this is looking for.
    const fileOf = (hunkSizes: number[]) => {
      let n = 0;
      return {
        path: "large.ts",
        previousPath: null,
        isNew: false,
        isDeleted: false,
        isBinary: false,
        lineCount: hunkSizes.reduce((a, b) => a + b, 0),
        hunks: hunkSizes.map((size, h) => ({
          header: `@@ hunk${h} @@`,
          lines: Array.from({ length: size }, () => {
            n += 1;
            return {
              kind: "add",
              content: `line ${n}`,
              newLineNumber: n,
              position: n,
            };
          }),
        })),
      } as any;
    };

    const linesOf = (files: any[]) =>
      files.flatMap((f) => f.hunks.flatMap((h: any) => h.lines));

    it("partitions every line exactly once, in order, across chunk boundaries", () => {
      const file = fileOf([50, 50, 50]);
      const chunks = chunkFileDiff(file, 40);

      const partitioned = linesOf(chunks);
      expect(partitioned).toHaveLength(150);
      expect(partitioned.map((l) => l.content)).toEqual(
        linesOf([file]).map((l) => l.content),
      );
    });

    it("never exceeds the cap, and reports lineCount that matches the lines actually carried", () => {
      const chunks = chunkFileDiff(fileOf([13, 71, 5, 44]), 30);
      for (const chunk of chunks) {
        const actual = chunk.hunks.reduce(
          (sum: number, h: any) => sum + h.lines.length,
          0,
        );
        expect(chunk.lineCount).toBe(actual);
        expect(actual).toBeLessThanOrEqual(30);
        expect(actual).toBeGreaterThan(0);
      }
    });

    // The MAX_CHUNKS cap in reviewFile is what makes this the load-bearing number: at 800 lines/chunk,
    // 4 chunks meant any file over 3,200 diff lines was silently cut off. src/server/core/review.ts
    // changed 3,749 lines in PR #55, so ~15% of the largest file in the PR reached no model at all.
    it("produces more than four chunks for a file the size of the largest in PR #55", () => {
      expect(chunkFileDiff(fileOf([3_749]), 800).length).toBeGreaterThan(4);
    });
  });

  describe("filterReviewableFiles", () => {
    it("applies complex exclusion patterns", () => {
      const files = [
        {
          path: "src/main.ts",
          isDeleted: false,
          isBinary: false,
          isNew: false,
          hunks: [],
        },
        {
          path: "dist/bundle.js",
          isDeleted: false,
          isBinary: false,
          isNew: false,
          hunks: [],
        },
        {
          path: "src/test.spec.ts",
          isDeleted: false,
          isBinary: false,
          isNew: false,
          hunks: [],
        },
      ] as any;

      const config = {
        ...defaultRepoConfig.review,
        skip_files: ["dist/**", "**/*.spec.ts"],
      };

      const filtered = filterReviewableFiles(files, config, 150);
      expect(filtered.files).toHaveLength(1);
      expect(filtered.files[0].path).toBe("src/main.ts");
      expect(filtered.skipped).toBe(0);
    });

    it("respects the file limit and reports how many it left out", () => {
      const manyFiles = Array(20)
        .fill(0)
        .map((_, i) => ({
          path: `file${i}.ts`,
          isDeleted: false,
          isBinary: false,
          isNew: false,
          hunks: [],
        })) as any;

      const filtered = filterReviewableFiles(
        manyFiles,
        defaultRepoConfig.review,
        5,
      );
      expect(filtered.files).toHaveLength(5);
      // Callers need this to say "5 of 20" instead of silently reviewing part of a PR.
      expect(filtered.skipped).toBe(15);
    });
  });
});

describe("diff --git header paths", () => {
  const header = (line: string) => parseDiffHeaderPath(line);

  it.each([
    [
      "reads a path containing spaces",
      "diff --git a/src/my file.ts b/src/my file.ts",
      "src/my file.ts",
    ],
    [
      "reads a path containing spaces",
      "diff --git a/docs/release notes.md b/docs/release notes.md",
      "docs/release notes.md",
    ],
    [
      "reads an ordinary path",
      "diff --git a/src/index.ts b/src/index.ts",
      "src/index.ts",
    ],
    ["reads a renamed path", "diff --git a/old b/new", "new"],
    [
      "reads a path containing a literal b/ segment",
      "diff --git a/a b/b b/a b/b",
      "a b/b",
    ],
  ])("%s", (name, input, expected) => {
    expect(header(input)).toBe(expected);
  });
});
