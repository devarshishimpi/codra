import { describe, expect, it } from "vitest";
import {
  buildPresenceIndex,
  checkAbsenceClaim,
  stripCommentsAndStrings,
} from "@codraoss/core/claim-checks";
import type { FileDiff } from "@codraoss/core/diff";

import { fileFromLines } from "../mocks/fixtures";
const fileWith = fileFromLines;

const check = (
  file: FileDiff,
  title: string,
  body: string,
  anchorLine: number | undefined = 1,
) =>
  checkAbsenceClaim({
    title,
    body,
    anchorLine,
    index: buildPresenceIndex(file),
  });

describe("absence claim refutation", () => {
  // The production false positive, reproduced. The model claimed a parameter was never passed; the
  // added line `[clampedDays],` was two lines below the code it cited.
  it("refutes a claim that an identifier is not passed when it is passed two lines below", () => {
    const file = fileWith([
      { content: "const rows = await queryRows(" },
      { content: "  sqlForWindow," },
      { content: "  [clampedDays]," },
      { content: ");" },
    ]);

    const verdict = check(
      file,
      "Query parameter is never bound",
      "The `clampedDays` value is never passed to the query, so the interval is unbound.",
    );

    expect(verdict.status).toBe("refuted");
    if (verdict.status === "refuted")
      expect(verdict.identifier).toBe("clampedDays");
  });

  it("refutes when the identifier appears inside a template interpolation", () => {
    const file = fileWith([
      { content: "const sql = `SELECT * FROM t WHERE d >= ${clampedDays}`;" },
    ]);

    expect(
      check(file, "Unbound parameter", "The `clampedDays` value is never used.")
        .status,
    ).toBe("refuted");
  });

  it("does not refute when the identifier only appears in a comment", () => {
    const file = fileWith([
      { content: "const rows = await queryRows(sql);" },
      { content: "// TODO: bind clampedDays here" },
    ]);

    expect(
      check(
        file,
        "Unbound parameter",
        "The `clampedDays` value is never passed.",
      ),
    ).toMatchObject({ status: "unknown", reason: "not_present" });
  });

  it("does not refute when the identifier only appears inside a string literal", () => {
    const file = fileWith([
      { content: "logger.warn('clampedDays was not supplied');" },
    ]);

    expect(
      check(
        file,
        "Unbound parameter",
        "The `clampedDays` value is never passed.",
      ),
    ).toMatchObject({ status: "unknown", reason: "not_present" });
  });

  // A removed line proving presence is backwards: the identifier being deleted is consistent with
  // the claim that it is gone.
  it("does not refute from a removed line", () => {
    const file = fileWith([
      { content: "const rows = await queryRows(sql);" },
      {
        content: "  [clampedDays],",
        kind: "del",
        newLineNumber: undefined,
        oldLineNumber: 2,
      },
    ]);

    expect(
      check(
        file,
        "Unbound parameter",
        "The `clampedDays` value is never passed.",
      ),
    ).toMatchObject({ status: "unknown", reason: "not_present" });
  });

  // The unsound inference this module exists to avoid: the claim is about a call site, not about
  // whether the language keyword appears anywhere in the file.
  it("does not refute a keyword claim from an unrelated use of that keyword", () => {
    const file = fileWith([
      { content: "await other();" },
      { content: "doSomething();" },
    ]);

    expect(
      check(
        file,
        "Missing await",
        "The call is missing `await`, so the promise floats.",
      ),
    ).toMatchObject({ status: "unknown", reason: "stoplisted" });
  });

  it("does not refute without a delimited identifier", () => {
    const file = fileWith([{ content: "  [clampedDays]," }]);

    expect(
      check(
        file,
        "Unbound parameter",
        "The days parameter is never passed to the query.",
      ),
    ).toMatchObject({ status: "unknown", reason: "no_identifier" });
  });

  it("does not refute when two identifiers are equally plausible", () => {
    const file = fileWith([{ content: "  [clampedDays, offset]," }]);

    expect(
      check(
        file,
        "Unbound parameters",
        "The `clampedDays` and `offset` values are not passed to the query.",
      ),
    ).toMatchObject({ status: "unknown", reason: "ambiguous_identifier" });
  });

  it("does not refute across a distant hunk", () => {
    const file: FileDiff = {
      ...fileWith([{ content: "const rows = await queryRows(sql);" }]),
      hunks: [
        {
          header: "@@ -1,1 +1,1 @@",
          lines: [
            {
              kind: "add",
              content: "const rows = await queryRows(sql);",
              newLineNumber: 1,
              position: 1,
            },
          ],
        },
        {
          header: "@@ -400,1 +400,1 @@",
          lines: [
            {
              kind: "add",
              content: "const clampedDays = clamp(days);",
              newLineNumber: 400,
              position: 3,
            },
          ],
        },
      ],
    };

    expect(
      checkAbsenceClaim({
        title: "Unbound parameter",
        body: "The `clampedDays` value is never passed.",
        anchorLine: 1,
        index: buildPresenceIndex(file),
      }),
    ).toMatchObject({ status: "unknown", reason: "out_of_window" });
  });

  it("ignores claims that are not absence-shaped at all", () => {
    const file = fileWith([{ content: "  [clampedDays]," }]);

    expect(
      check(
        file,
        "Naming could be clearer",
        "Consider renaming `clampedDays` to `dayWindow`.",
      ),
    ).toMatchObject({ status: "unknown", reason: "not_absence_shaped" });
  });

  it("skips a line whose quoting cannot be scanned confidently", () => {
    const file = fileWith([
      { content: "const broken = 'unterminated + clampedDays" },
    ]);

    expect(
      check(
        file,
        "Unbound parameter",
        "The `clampedDays` value is never passed.",
      ),
    ).toMatchObject({ status: "unknown", reason: "not_present" });
  });
});

describe("comment and string stripping", () => {
  const js = { line: ["//"] as const, block: true };

  it("drops line comments, block comments and string contents", () => {
    expect(stripCommentsAndStrings("const a = 1; // set b", js)).toBe(
      "const a = 1; ",
    );
    expect(stripCommentsAndStrings("const a = /* b */ 1;", js)).toBe(
      "const a =   1;",
    );
    expect(stripCommentsAndStrings('const a = "b";', js)).toBe("const a =  ;");
  });

  it("keeps template interpolations but not the literal text around them", () => {
    const stripped = stripCommentsAndStrings(
      "const s = `days ${clampedDays} end`;",
      js,
    );
    expect(stripped).toContain("clampedDays");
    expect(stripped).not.toContain("end");
  });

  it("gives up rather than guessing on unterminated quoting", () => {
    expect(stripCommentsAndStrings("const a = 'oops", js)).toBeNull();
    expect(stripCommentsAndStrings("const a = /* oops", js)).toBeNull();
  });

  it("respects an escaped quote instead of ending the string early", () => {
    expect(
      stripCommentsAndStrings("const a = 'it\\'s'; const b = c;", js),
    ).toBe("const a =  ; const b = c;");
  });

  // `//` is floor division in Python and `#` is a private field in JS, so neither can be treated as
  // a comment universally without truncating real code.
  it("uses hash comments for python and leaves floor division alone", () => {
    const py = fileWith(
      [{ content: "total = a // b  # clampedDays ignored" }],
      "src/stats.py",
    );
    const index = buildPresenceIndex(py);
    expect(index.byToken.has("b")).toBe(true);
    expect(index.byToken.has("clampedDays")).toBe(false);
  });
});
