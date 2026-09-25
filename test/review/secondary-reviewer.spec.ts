import { describe, expect, it } from "vitest";
import { reviewAndPersistFile } from "../../packages/core/src/review/file-runner";
import {
  budgetAwareFileLimit,
  estimatedSubrequestsPerFile,
} from "@server/core/review";
import { defaultRepoConfig, type RepoConfig } from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

// Two reviewers, unioned. The measured gain (F1 0.200 against 0.149 for the best single model) is
// entirely coverage, so the rules that matter are: never drop what only one reviewer found, never
// treat agreement as evidence, and never let the second reviewer cost the file if it fails.

const file: FileDiff = {
  path: "src/app.ts",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 2,
  hunks: [
    {
      header: "@@ -1,1 +1,2 @@",
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

const pr = { title: "PR", body: null, head: { sha: "abc" } } as never;
const job = { id: "job-1" } as never;

function review(modelUsed: string, titles: string[]) {
  return {
    modelUsed,
    provider: "Google",
    rawText: "{}",
    inputTokens: 10,
    outputTokens: 20,
    reviewedLineCount: 1,
    wasPromptTruncated: false,
    userPrompt: "prompt",
    parsed: {
      comments: titles.map((title) => ({
        path: file.path,
        line: 1,
        position: 1,
        severity: "P2" as const,
        category: "quality" as const,
        title,
        body: "body",
        anchorHash: title,
        fingerprint: title,
      })),
      verdict: "comment" as const,
      fileSummary: "summary",
      overallCorrectness: "patch is incorrect",
      confidenceScore: 0.8,
      evidenceStats: {
        total: 1,
        matched: 1,
        unmatched: 0,
        weak: 0,
        absent: 0,
        contextOnly: 0,
      },
      claimTypeCounts: {},
      deniedClaimCounts: {},
      absenceCheckStats: {
        absenceShaped: 0,
        identifierExtracted: 0,
        refuted: 0,
      },
    },
  };
}

function harness(byModel: Record<string, string[] | "throws">) {
  const rows: any[] = [];
  const seen: string[] = [];
  const env = {
    clock: { now: () => 0 },
    fileReviews: {
      upsertFileReview: async (_id: string, row: any) => {
        rows.push(row);
      },
    },
  } as never;
  const model = {
    reviewFile: async (params: any) => {
      const main = params.config.model.main;
      seen.push(main);
      const outcome = byModel[main];
      if (outcome === "throws") throw new Error("secondary provider down");
      return review(main, outcome ?? []);
    },
  } as never;
  return { env, model, rows, seen };
}

const config = (secondary?: {
  model: string;
  fallbacks: string[];
}): RepoConfig => ({
  ...defaultRepoConfig,
  model: {
    main: "primary-model",
    fallbacks: [],
    size_overrides: [],
    ...(secondary ? { secondary } : {}),
  },
});

const run = (
  h: ReturnType<typeof harness>,
  cfg: RepoConfig,
  previousReview?: { transient_error_count: number },
) =>
  reviewAndPersistFile(
    h.env,
    job,
    file as never,
    pr,
    cfg,
    2,
    h.model,
    async () => null,
    previousReview,
  );

describe("the secondary reviewer", () => {
  it("does not run at all unless one is configured", async () => {
    const h = harness({ "primary-model": ["Only finding"] });

    await run(h, config());

    expect(h.seen).toEqual(["primary-model"]);
    expect(h.rows[0].parsedComments.map((c: any) => c.title)).toEqual([
      "Only finding",
    ]);
  });

  it("unions both reviewers into one row, keeping what only one of them found", async () => {
    const h = harness({
      "primary-model": ["Primary only", "Shared finding"],
      "second-model": ["Shared finding", "Secondary only"],
    });

    await run(h, config({ model: "second-model", fallbacks: [] }));

    expect(h.seen).toEqual(["primary-model", "second-model"]);
    // One row per file: file_reviews is unique on (job_id, file_path).
    expect(h.rows).toHaveLength(1);
    // Everything survives here -- collapsing duplicates is dedupe's job, later and job-wide.
    expect(h.rows[0].parsedComments.map((c: any) => c.title)).toEqual([
      "Primary only",
      "Shared finding",
      "Shared finding",
      "Secondary only",
    ]);
  });

  it("attributes each finding to the reviewer that produced it", async () => {
    const h = harness({ "primary-model": ["A"], "second-model": ["B"] });

    await run(h, config({ model: "second-model", fallbacks: [] }));

    const byTitle = Object.fromEntries(
      h.rows[0].parsedComments.map((c: any) => [c.title, c.reviewerModel]),
    );
    expect(byTitle).toEqual({ A: "primary-model", B: "second-model" });
  });

  it("sums the cost of both calls onto the row", async () => {
    const h = harness({ "primary-model": ["A"], "second-model": ["B"] });

    await run(h, config({ model: "second-model", fallbacks: [] }));

    expect(h.rows[0].inputTokens).toBe(20);
    expect(h.rows[0].outputTokens).toBe(40);
  });

  // The primary result already exists by then; losing the file over a second opinion would be a
  // strictly worse review than not having asked for one.
  it("keeps the primary review when the secondary fails", async () => {
    const h = harness({
      "primary-model": ["Primary finding"],
      "second-model": "throws",
    });

    await run(h, config({ model: "second-model", fallbacks: [] }));

    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].fileStatus).toBe("done");
    expect(h.rows[0].parsedComments.map((c: any) => c.title)).toEqual([
      "Primary finding",
    ]);
  });

  // `compactPrompt` is set after a transient failure, when the point is to ask for LESS.
  it("stands down on a retry that is already being scaled back", async () => {
    const h = harness({ "primary-model": ["A"], "second-model": ["B"] });

    await run(h, config({ model: "second-model", fallbacks: [] }), {
      transient_error_count: 1,
    });

    expect(h.seen).toEqual(["primary-model"]);
  });
});

describe("the subrequest budget with a secondary reviewer", () => {
  it("prices the second chain without doubling the fixed per-file cost", () => {
    const single = estimatedSubrequestsPerFile(3, false, false);
    const paired = estimatedSubrequestsPerFile(3, false, true);

    expect(paired).toBeGreaterThan(single);
    expect(paired).toBeLessThan(single * 2);
  });

  // Fewer files per invocation is the correct answer; zero is not -- that defers the job forever.
  it("still lets at least one file through on a tight budget", () => {
    expect(budgetAwareFileLimit(6, 8, 3, true, true)).toBeGreaterThanOrEqual(1);
    expect(budgetAwareFileLimit(0, 8, 3, true, true)).toBe(0);
  });
});
