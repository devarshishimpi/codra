import type { BatchReviewOutcome } from "@codraoss/models";
// Shared service doubles for the DB-backed review suites. `vi.mock` factories are hoisted, so pull
// these in with a dynamic `await import(...)` inside the factory.

// A PR that always resolves, with one changed file. Enough for any suite not testing GitHub itself.
export function makeGitHubServiceMock(overrides: Record<string, unknown> = {}) {
  return class MockGitHubService {
    async getPullRequest() {
      return {
        title: "Test PR",
        body: "Test Body",
        head: { sha: "headsha", ref: "feature" },
        base: { sha: "basesha", ref: "main" },
        user: { login: "author" },
      };
    }
    async getPullRequestDiff() {
      return [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 0000000..1111111 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -0,0 +1 @@",
        "+console.log(1);",
        "",
      ].join("\n");
    }
    async createCheckRun() {
      return { id: 123 };
    }
    async updateCheckRun() {
      return {};
    }
    async createReview() {
      return { id: 456 };
    }
    async findBotReviewForCommit() {
      return null;
    }
    async ensureLabel() {
      return {};
    }
    async addIssueLabels() {
      return {};
    }
    async removeIssueLabelsIfPresent() {
      return {};
    }
    async removeIssueLabel() {
      return {};
    }

    constructor() {
      Object.assign(this, overrides);
    }
  };
}

// One P2 finding on src/app.ts, with the counters finalize reads kept in step with the parser.
function reviewFileResponse(overrides: Record<string, unknown> = {}) {
  return {
    parsed: {
      comments: [
        {
          path: "src/app.ts",
          line: 1,
          position: 1,
          severity: "P2",
          category: "quality",
          title: "Typo",
          body: "Fixed typo",
        },
      ],
      verdict: "comment",
      fileSummary: "Looks ok",
      overallCorrectness: "issues found",
      confidenceScore: 0.9,
      // Must stay in step with parseFileReviewResponse; finalize sums these.
      evidenceStats: {
        total: 1,
        matched: 1,
        unmatched: 0,
        weak: 0,
        absent: 0,
        contextOnly: 0,
      },
      claimTypeCounts: { other: 1 },
      deniedClaimCounts: {},
      absenceCheckStats: {
        absenceShaped: 0,
        identifierExtracted: 0,
        refuted: 0,
      },
    },
    modelUsed: "test-model",
    provider: "test-provider",
    inputTokens: 10,
    outputTokens: 5,
    rawText: "{}",
    userPrompt: "",
    ...overrides,
  };
}

// One entry per packed file, shaped like parseBatchReviewResponse's output.
export function reviewBatchResponse(
  paths: readonly string[],
  overrides: Record<string, unknown> = {},
) {
  // `satisfies` the real `batch` shape, so a production field change breaks here.
  return {
    batch: {
      reviews: new Map(
        paths.map((path) => [
          path,
          {
            comments: [
              {
                path,
                line: 1,
                position: 1,
                severity: "P2",
                category: "quality",
                title: `Typo in ${path}`,
                body: "Fixed typo",
              },
            ],
            verdict: "comment" as const,
            fileSummary: `Looks ok: ${path}`,
            overallCorrectness: "issues found",
            confidenceScore: 0.9,
            evidenceStats: {
              total: 1,
              matched: 1,
              unmatched: 0,
              weak: 0,
              absent: 0,
              contextOnly: 0,
            },
            claimTypeCounts: { other: 1 },
            deniedClaimCounts: {},
            absenceCheckStats: {
              absenceShaped: 0,
              identifierExtracted: 0,
              refuted: 0,
            },
          },
        ]),
      ),
      missing: [] as string[],
      stats: {
        unroutableEntries: 0,
        pathMismatchFindings: 0,
        ambiguousAcrossBin: 0,
        flatFallback: 0,
        overCap: 0,
        entriesReturned: paths.length,
      },
    },
    modelUsed: "test-model",
    provider: "test-provider",
    inputTokens: 40,
    outputTokens: 12,
    rawText: '{"files":[]}',
    userPrompt: "",
    ...overrides,
  } satisfies Pick<BatchReviewOutcome, "batch" | "userPrompt"> &
    Record<string, unknown>;
}

// Synchronous by default (`submitReviewBatch` returns null); `verifyFindings` keeps every candidate,
// or the verifier fails open and masks real failures.
export function makeModelServiceMock(overrides: Record<string, unknown> = {}) {
  return class MockModelService {
    async submitReviewBatch() {
      return null;
    }
    async pollReviewBatch() {
      return { status: "pending" as const };
    }
    async reviewFile() {
      return reviewFileResponse();
    }
    async reviewFiles({ files }: { files: Array<{ path: string }> }) {
      return reviewBatchResponse(files.map((f) => f.path));
    }
    async generateSummary() {
      return {
        modelUsed: "sum-model",
        provider: "google",
        rawText: '{"summary": "test"}',
        inputTokens: 3,
        outputTokens: 2,
      };
    }
    async verifyFindings({
      candidates,
    }: {
      candidates: Array<{ index: number }>;
    }) {
      return {
        modelUsed: "verify-model",
        provider: "test-provider",
        rawText: JSON.stringify({
          results: candidates.map((c) => ({
            index: c.index,
            reason: "confirmed",
            verdict: "keep",
          })),
        }),
        inputTokens: 1,
        outputTokens: 1,
      };
    }

    constructor() {
      Object.assign(this, overrides);
    }
  };
}

export const isRetryableModelErrorMock = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    (error as { retryable?: boolean }).retryable === true,
  );

// Every hand-built mock of the '@codraoss/models' barrel must include this. The review
// runners call it inside their catch block, so a missing export is a TypeError raised while
// handling a failure -- which silently converts a deferral into a terminal one.
export const nextChainIndexOfMock = (error: unknown) => {
  const value = (error as { nextChainIndex?: unknown } | null)?.nextChainIndex;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
};
