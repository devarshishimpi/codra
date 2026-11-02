import { describe, expect, it } from "vitest";
import {
  buildUnifiedDiffFromFiles,
  parseUnifiedDiff,
} from "@codraoss/core/diff";

// GitHub's unified-diff media type answers 406 `too_large` above 20,000 lines, so a large PR has to
// be rebuilt from `GET /pulls/{n}/files`. What matters is that the rebuilt text is indistinguishable
// to `parseUnifiedDiff` from what git would have produced -- these assert the round trip rather than
// the intermediate string, because the string is only a means of reaching the parser.
describe("rebuilding a diff from GitHub per-file JSON", () => {
  it("round-trips a modified file with correct line numbers and positions", () => {
    const raw = buildUnifiedDiffFromFiles([
      {
        filename: "src/app.ts",
        status: "modified",
        patch:
          "@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;",
      },
    ]);

    const [file] = parseUnifiedDiff(raw);
    expect(file.path).toBe("src/app.ts");
    expect(file.isNew).toBe(false);
    expect(file.isDeleted).toBe(false);
    expect(file.isBinary).toBe(false);

    const added = file.hunks[0].lines.filter((l) => l.kind === "add");
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe("const b = 3;");
    expect(added[0].newLineNumber).toBe(2);
    // Positions are what GitHub anchors inline comments on, so an off-by-one here posts comments on
    // the wrong lines.
    expect(added[0].position).toBeGreaterThan(0);
  });

  // `new file mode` / `deleted file mode` are what set these flags -- the /dev/null markers alone do
  // not, so emitting only those would silently misclassify every added and removed file.
  it("marks an added file as new", () => {
    const raw = buildUnifiedDiffFromFiles([
      {
        filename: "src/new.ts",
        status: "added",
        patch: "@@ -0,0 +1,2 @@\n+export const x = 1;\n+export const y = 2;",
      },
    ]);

    const [file] = parseUnifiedDiff(raw);
    expect(file.isNew).toBe(true);
    expect(file.path).toBe("src/new.ts");
  });

  it("marks a removed file as deleted", () => {
    const raw = buildUnifiedDiffFromFiles([
      {
        filename: "src/gone.ts",
        status: "removed",
        patch: "@@ -1,2 +0,0 @@\n-export const x = 1;\n-export const y = 2;",
      },
    ]);

    expect(parseUnifiedDiff(raw)[0].isDeleted).toBe(true);
  });

  it("carries a rename through to previousPath", () => {
    const raw = buildUnifiedDiffFromFiles([
      {
        filename: "src/renamed.ts",
        previous_filename: "src/original.ts",
        status: "renamed",
        patch: "@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
      },
    ]);

    const [file] = parseUnifiedDiff(raw);
    expect(file.path).toBe("src/renamed.ts");
    expect(file.previousPath).toBe("src/original.ts");
  });

  // A file with no patch must be visible and skipped, never silently absent -- otherwise it would be
  // indistinguishable from a file that was reviewed and found clean.
  it("represents a patch-less file as binary rather than dropping it", () => {
    const raw = buildUnifiedDiffFromFiles([
      { filename: "assets/logo.png", status: "modified" },
      {
        filename: "src/app.ts",
        status: "modified",
        patch: "@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
      },
    ]);

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(2);
    expect(files.find((f) => f.path === "assets/logo.png")?.isBinary).toBe(
      true,
    );
    expect(files.find((f) => f.path === "src/app.ts")?.isBinary).toBe(false);
  });

  it("keeps multiple files separate", () => {
    const raw = buildUnifiedDiffFromFiles([
      {
        filename: "a.ts",
        status: "modified",
        patch: "@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
      },
      {
        filename: "b.ts",
        status: "modified",
        patch: "@@ -1,1 +1,1 @@\n-const b = 1;\n+const b = 2;",
      },
    ]);

    expect(parseUnifiedDiff(raw).map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("produces nothing for an empty file list", () => {
    expect(parseUnifiedDiff(buildUnifiedDiffFromFiles([]))).toEqual([]);
  });
});
