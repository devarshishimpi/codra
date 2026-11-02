import { describe, expect, it } from "vitest";
import { parseFileReviewResponse } from "@codraoss/core/model-output";
import {
  CLAIM_TYPE_DECIDABILITY,
  DEFAULT_DENIED_CLAIM_TYPES,
  claimTypes,
} from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

import { reviewJson } from "../mocks/fixtures";
const file: FileDiff = {
  path: "src/app.ts",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 2,
  hunks: [
    {
      header: "@@ -1,2 +1,2 @@",
      lines: [
        {
          kind: "add",
          content: "const query = `SELECT * FROM users WHERE id = ${id}`;",
          newLineNumber: 1,
          position: 1,
        },
        {
          kind: "add",
          content: "server.listen(timeout);",
          newLineNumber: 2,
          position: 2,
        },
      ],
    },
  ],
};

const review = (finding: Record<string, unknown>) =>
  reviewJson(finding, {
    title: "Unvalidated input",
    body: "The value is never checked.",
  });

describe("claim types", () => {
  it("round-trips a valid claim type onto the parsed comment", () => {
    const raw = review({
      claim_type: "sql_injection",
      evidence: "const query = `SELECT * FROM users WHERE id = ${id}`;",
      code_location: { absolute_file_path: "src/app.ts", line: 1 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments[0].claimType).toBe("sql_injection");
    expect(result.claimTypeCounts).toEqual({ sql_injection: 1 });
  });

  // A Zod rejection here would discard every finding in the file over one bad label.
  it.each([["not_a_real_type"], [""], [undefined], [42]])(
    "coerces an unknown or missing claim type (%s) to other rather than throwing",
    (value) => {
      const raw = review({
        claim_type: value,
        evidence: "server.listen(timeout);",
        code_location: { absolute_file_path: "src/app.ts", line: 2 },
      });
      const result = parseFileReviewResponse(raw, file);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].claimType).toBe("other");
    },
  );

  // category was hardcoded to 'quality' on all 705 rows in production, making the per-category
  // dashboard aggregate a single meaningless bar.
  it("derives category from the claim type instead of hardcoding quality", () => {
    const raw = review({
      claim_type: "sql_injection",
      evidence: "const query = `SELECT * FROM users WHERE id = ${id}`;",
      code_location: { absolute_file_path: "src/app.ts", line: 1 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments[0].category).toBe("security");
  });
});

describe("claim type denylist", () => {
  const denied = (over: Record<string, unknown> = {}) =>
    review({
      claim_type: "redos_regex",
      evidence: "const query = `SELECT * FROM users WHERE id = ${id}`;",
      code_location: { absolute_file_path: "src/app.ts", line: 1 },
      ...over,
    });

  // The denylist reflects what the model cannot decide from a diff, regardless of whether this
  // particular evidence happens to resolve -- so a denied claim with flawless evidence still drops.
  it("drops a denied claim type even when its evidence matches perfectly", () => {
    const result = parseFileReviewResponse(denied(), file, {
      deniedClaimTypes: ["redos_regex"],
    });

    expect(result.comments).toHaveLength(0);
    expect(result.fileSummary).toContain("[claim-denied:redos_regex]");
    expect(result.deniedClaimCounts.redos_regex).toBe(1);
  });

  // Ordering matters: counting after the drop would erase denied types from the tally.
  it("counts a denied claim in claimTypeCounts before dropping it", () => {
    const result = parseFileReviewResponse(denied(), file, {
      deniedClaimTypes: ["redos_regex"],
    });
    expect(result.claimTypeCounts.redos_regex).toBe(1);
  });

  it.each(claimTypes)(
    "denies every claim type that is not decidable from the diff (%s)",
    (type) => {
      const denied = DEFAULT_DENIED_CLAIM_TYPES.includes(type);
      expect(denied).toBe(CLAIM_TYPE_DECIDABILITY[type] !== "diff_local");
    },
  );
});
