import { describe, expect, it } from "vitest";
import {
  BIN_MAX_FILES,
  PACKABLE_MAX_DIFF_LINES,
  type LedgerEntry,
  narrowUnit,
  planReviewUnits,
  unitFiles,
} from "@server/core/review";
import type { FileDiff } from "@codraoss/core/diff";

function file(path: string, lineCount: number, contentWidth = 20): FileDiff {
  return {
    path,
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount,
    hunks: [
      {
        header: "@@ -1,10 +1,10 @@",
        lines: Array.from({ length: lineCount }, (_, i) => ({
          kind: "add" as const,
          content: "x".repeat(contentWidth),
          newLineNumber: i + 1,
          oldLineNumber: undefined,
          position: i + 1,
        })),
      },
    ],
  };
}

const ledger = (entries: Record<string, Partial<LedgerEntry>>) =>
  new Map(
    Object.entries(entries).map(([path, entry]) => [
      path,
      {
        handled: entry.handled ?? false,
        transientErrorCount: entry.transientErrorCount ?? 0,
      },
    ]),
  );

describe("planReviewUnits", () => {
  // Independent ceilings: a file under the line limit can still blow the char budget alone.
  it("packs small files, respects both ceilings, and no-ops when disabled", () => {
    const paths = Array.from(
      { length: BIN_MAX_FILES },
      (_unused, index) => `f${index}.ts`,
    );
    const files = paths.map((path) => file(path, 10));

    const packed = planReviewUnits(files, { enabled: true });
    expect(packed).toHaveLength(1);
    expect(unitFiles(packed[0]).map((f) => f.path)).toEqual(paths);

    const unpacked = planReviewUnits(files, { enabled: false });
    expect(unpacked).toHaveLength(BIN_MAX_FILES);
    expect(unpacked.every((u) => u.kind === "single")).toBe(true);

    const units = planReviewUnits(
      [
        file("a.ts", 5),
        file("tall.ts", PACKABLE_MAX_DIFF_LINES + 1),
        file("wide.ts", 100, 400),
        file("b.ts", 5),
      ],
      { enabled: true },
    );
    for (const path of ["tall.ts", "wide.ts"]) {
      expect(
        units.find((u) => unitFiles(u).some((f) => f.path === path))?.kind,
      ).toBe("single");
    }
    // Every file still reviewed exactly once, in input order.
    expect(units.flatMap(unitFiles).map((f) => f.path)).toEqual([
      "a.ts",
      "tall.ts",
      "wide.ts",
      "b.ts",
    ]);
  });
});

describe("narrowUnit", () => {
  it("drops handled files and collapses to a single when one is left", () => {
    // Needs a bin big enough to still hold two files after one is handled, whatever the cap is.
    const paths = Array.from(
      { length: Math.max(3, BIN_MAX_FILES) },
      (_unused, index) => `f${index}.ts`,
    );
    const [unit] = planReviewUnits(
      paths.slice(0, BIN_MAX_FILES).map((path) => file(path, 10)),
      { enabled: true },
    );
    const inBin = unitFiles(unit).map((f) => f.path);

    // Handling all but the last leaves exactly one file, which must de-escalate to a single.
    const allButLast = Object.fromEntries(
      inBin.slice(0, -1).map((path) => [path, { handled: true }]),
    );
    const one = narrowUnit(unit, ledger(allButLast));
    expect(one).toEqual([
      {
        kind: "single",
        file: expect.objectContaining({ path: inBin[inBin.length - 1] }),
      },
    ]);

    // Handling every member leaves nothing to review.
    const all = Object.fromEntries(
      inBin.map((path) => [path, { handled: true }]),
    );
    expect(narrowUnit(unit, ledger(all))).toEqual([]);
  });

  // Otherwise a deterministic plan re-forms the same failing bin; de-escalating must not strand
  // the other files.
  it("explodes a bin into singles once any member has failed transiently", () => {
    // Sized from BIN_MAX_FILES so lowering the cap cannot turn this into a test about packing.
    const paths = Array.from(
      { length: BIN_MAX_FILES },
      (_unused, index) => `f${index}.ts`,
    );
    const [unit] = planReviewUnits(
      paths.map((path) => file(path, 10)),
      { enabled: true },
    );
    expect(unitFiles(unit)).toHaveLength(BIN_MAX_FILES);

    // First file already done, last one failed transiently: the rest must not be stranded with it.
    const narrowed = narrowUnit(
      unit,
      ledger({
        [paths[0]]: { handled: true },
        [paths[paths.length - 1]]: { transientErrorCount: 2 },
      }),
    );

    expect(narrowed.every((u) => u.kind === "single")).toBe(true);
    expect(narrowed.flatMap(unitFiles).map((f) => f.path)).toEqual(
      paths.slice(1),
    );
  });
});
