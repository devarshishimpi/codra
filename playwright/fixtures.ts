import {
  defaultRepoConfig,
  type JobDetail,
  type JobSummary,
  type RepoConfigRecord,
  type StatsPayload,
} from "@codraoss/schema";

const createdAt = "2026-11-18T10:00:00.000Z";
const updatedAt = "2026-11-18T10:05:00.000Z";

export const detailJobId = "00000000-0000-4000-8000-000000000101";

export function makeJobSummary(index: number): JobSummary {
  const number = index + 1;
  return {
    id: `00000000-0000-4000-8000-${String(200 + number).padStart(12, "0")}`,
    owner: "acme",
    repo: "web-app",
    installationId: "1001",
    prNumber: 100 + number,
    prTitle:
      number === 1
        ? "Harden dashboard authorization"
        : `Update dashboard module ${number}`,
    prAuthor: "octocat",
    commitSha: "a1b2c3d4e5f6789012345678901234567890abcd",
    trigger: "auto",
    status: number % 3 === 0 ? "failed" : "done",
    verdict: number % 3 === 0 ? "comment" : "approve",
    fileCount: 2,
    commentCount: number % 3 === 0 ? 1 : 0,
    totalInputTokens: 1200 + number,
    totalOutputTokens: 450 + number,
    createdAt,
    updatedAt,
    nextRetryAt: null,
    startedAt: createdAt,
    finishedAt: updatedAt,
    errorMessage: null,
    overallConfidenceScore: 0.94,
    overallCorrectness: "correct",
    steps: [],
    checkRunId: null,
    configSnapshot: null,
    retryOfJobId: null,
  };
}

export const jobSummaries = Array.from({ length: 12 }, (_, index) =>
  makeJobSummary(index),
);

export const detailJob: JobDetail = {
  id: detailJobId,
  owner: "acme",
  repo: "web-app",
  installationId: "1001",
  prNumber: 142,
  prTitle: "Add account menu protections",
  prAuthor: "octocat",
  commitSha: "d4c3b2a109876543210fedcba09876543210abcd",
  trigger: "auto",
  status: "done",
  verdict: "comment",
  fileCount: 1,
  commentCount: 1,
  totalInputTokens: 2400,
  totalOutputTokens: 820,
  createdAt,
  updatedAt,
  nextRetryAt: null,
  startedAt: createdAt,
  finishedAt: updatedAt,
  errorMessage: null,
  overallConfidenceScore: 0.96,
  overallCorrectness: "correct",
  steps: [
    {
      name: "Fetch pull request",
      status: "done",
      startedAt: createdAt,
      finishedAt: "2026-11-18T10:00:10.000Z",
      error: null,
    },
    {
      name: "Review changed files",
      status: "done",
      startedAt: "2026-11-18T10:00:10.000Z",
      finishedAt: updatedAt,
      error: null,
    },
  ],
  baseSha: "1111111111111111111111111111111111111111",
  headRef: "feature/account-menu",
  baseRef: "main",
  summaryMarkdown: "The review found one authorization issue worth addressing.",
  configSnapshot: null,
  reviewId: 501,
  retryOfJobId: null,
  summaryModel: "gpt-4o-mini",
  files: [
    {
      id: "00000000-0000-4000-8000-000000000301",
      jobId: detailJobId,
      filePath: "src/components/AccountMenu.tsx",
      fileStatus: "done",
      modelUsed: "gpt-4o-mini",
      modelProvider: "OpenAI",
      diffLineCount: 8,
      diffInput: null,
      rawAiOutput: null,
      parsedComments: [
        {
          path: "src/components/AccountMenu.tsx",
          line: 18,
          severity: "P1",
          category: "security",
          title: "Check authorization before opening the menu",
          body: "The menu action should verify the current user's permissions before exposing account data.",
          codeSuggestion: null,
          confidenceScore: 0.96,
          evidence: "setMenuOpen(true)",
          fingerprint: "account-menu-auth-check",
          anchorHash: "account-menu-line-18",
          posted: true,
          claimType: null,
          contextSnippet: null,
          disposition: null,
          verifyReason: null,
          humanLabel: null,
          fingerprintV2: null,
          source: "llm",
          reviewerModel: null,
          ruleId: null,
        },
      ],
      inputTokens: 1200,
      outputTokens: 420,
      durationMs: 1800,
      verdict: "comment",
      fileSummary: "The account menu is rendered after the permission check.",
      overallCorrectness: "correct",
      confidenceScore: 0.96,
      batchSize: 1,
      withheldCounts: null,
      degraded: null,
      errorMessage: null,
      createdAt,
    },
  ],
};

const trend = Array.from({ length: 14 }, (_, index) => {
  const day = new Date(Date.UTC(2026, 10, index + 1))
    .toISOString()
    .slice(0, 10);

  return {
    day,
    endDay: day,
    jobs: index + 1,
    inputTokens: (index + 1) * 100,
    outputTokens: (index + 1) * 45,
    comments: index % 3,
  };
});

export const statsFixture: StatsPayload = {
  totals: {
    jobs: 12,
    inputTokens: 13500,
    outputTokens: 6200,
    comments: 7,
  },
  trend,
  trendBucketDays: 1,
  verdicts: [
    { verdict: "approve", count: 8 },
    { verdict: "comment", count: 4 },
  ],
  models: [
    {
      modelUsed: "gpt-4o-mini",
      provider: "OpenAI",
      calls: 12,
      inputTokens: 13500,
      outputTokens: 6200,
    },
  ],
  topRepos: [{ owner: "acme", repo: "web-app", jobs: 12 }],
  statuses: [
    { status: "done", count: 9 },
    { status: "failed", count: 3 },
  ],
  triggers: [{ trigger: "auto", count: 12 }],
  severities: [
    { severity: "P1", count: 2 },
    { severity: "P2", count: 5 },
  ],
  categories: [
    { category: "security", count: 2 },
    { category: "quality", count: 5 },
  ],
  performance: {
    avgDurationMs: 1800,
    p95DurationMs: 3200,
    avgConfidence: 0.94,
  },
};

export const repoFixture: RepoConfigRecord = {
  installationId: "1001",
  owner: "acme",
  repo: "web-app",
  parsedJson: defaultRepoConfig,
  updatedAt,
  lastJobCreatedAt: updatedAt,
  lastJobVerdict: "approve",
  mainModel: null,
  fallbackModels: null,
  sizeOverrides: null,
  enabled: true,
};

export const providerId = "00000000-0000-4000-8000-000000000401";

export const modelsFixture = {
  providers: [
    {
      id: providerId,
      name: "OpenAI",
      apiFormat: "openai" as const,
      baseUrl: "https://api.openai.com/v1",
      enabled: true,
      hasApiKey: true,
      createdAt,
      updatedAt,
    },
  ],
  configs: [
    {
      modelId: "gpt-4o-mini",
      providerId,
      providerName: "OpenAI",
      apiFormat: "openai" as const,
      modelName: "GPT-4o mini",
      updatedAt,
    },
    {
      modelId: "gpt-4.1-mini",
      providerId,
      providerName: "OpenAI",
      apiFormat: "openai" as const,
      modelName: "GPT-4.1 mini",
      updatedAt,
    },
  ],
};

export const globalModelFixture = {
  config: {
    main: "gpt-4o-mini",
    fallbacks: [],
    size_overrides: [],
    secondary: null,
  },
};

export const jobDiffFixture = {
  diffs: {
    "src/components/AccountMenu.tsx": [
      "diff --git a/src/components/AccountMenu.tsx b/src/components/AccountMenu.tsx",
      "index 1111111..2222222 100644",
      "--- a/src/components/AccountMenu.tsx",
      "+++ b/src/components/AccountMenu.tsx",
      "@@ -14,4 +14,6 @@ export function AccountMenu() {",
      " const canOpen = permissions.includes('account.read');",
      "+if (!canOpen) return null;",
      "+setMenuOpen(true);",
    ].join("\n"),
  },
};
