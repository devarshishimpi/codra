import {
  defaultRepoConfig,
  reviewSettingsSchema,
  type ParsedReviewComment,
  type RepoConfig,
  type ReviewSettings,
} from "@codraoss/schema";
import type {
  BulkFileReviewInput,
  FileReviewRow,
  JobLeaseClaim,
  JobRow,
  PersistedReviewJob,
  ReviewRuntime,
} from "../src/ports";

export type Recorded = {
  /** Every port write, in order, so a test can assert on the sequence rather than the end state. */
  calls: string[];
  jobs: Map<string, PersistedReviewJob>;
  fileReviews: Map<string, FileReviewRow>;
  kv: Map<string, string>;
  postedReviews: Array<{
    body: string;
    comments: Array<{ path: string; body: string }>;
  }>;
  checkRuns: Array<{ title: string; status?: string; conclusion?: string }>;
  telemetry: unknown[];
};

const ISO = "2026-01-01T00:00:00.000Z";

export function makeJob(
  overrides: Partial<PersistedReviewJob> = {},
): PersistedReviewJob {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    owner: "acme",
    repo: "widgets",
    installationId: "42",
    prNumber: 7,
    prTitle: "Add a retry",
    prAuthor: "octocat",
    commitSha: "a".repeat(40),
    trigger: "auto",
    status: "queued",
    verdict: null,
    fileCount: 0,
    commentCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: ISO,
    updatedAt: ISO,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    steps: [],
    checkRunId: null,
    configSnapshot: null,
    ...overrides,
  };
}

export const SAMPLE_DIFF = `diff --git a/src/retry.ts b/src/retry.ts
index 1111111..2222222 100644
--- a/src/retry.ts
+++ b/src/retry.ts
@@ -1,3 +1,6 @@
 export function retry() {
+  const delay = 1000;
+  return delay;
 }
diff --git a/src/log.ts b/src/log.ts
index 3333333..4444444 100644
--- a/src/log.ts
+++ b/src/log.ts
@@ -1,2 +1,4 @@
 export function log(message: string) {
+  console.log(message);
 }
`;

export type ModelBehaviour = {
  /** Findings the model "reports" per file path. */
  findingsByPath?: Record<
    string,
    Array<{ title: string; body: string; line: number; evidence?: string }>
  >;
  /** Verdicts the verifier returns, keyed by candidate index. Absent means it keeps everything. */
  verifyVerdicts?: Record<number, "keep" | "drop">;
  failEveryCall?: Error;
};

export function createInMemoryRuntime(
  seed: {
    job?: Partial<PersistedReviewJob>;
    settings?: Partial<ReviewSettings>;
    config?: RepoConfig;
    model?: ModelBehaviour;
  } = {},
): { runtime: ReviewRuntime; recorded: Recorded; now: { value: number } } {
  const config = seed.config ?? defaultRepoConfig;
  const job = makeJob({ configSnapshot: config, ...seed.job });
  const model = seed.model ?? {};

  const recorded: Recorded = {
    calls: [],
    jobs: new Map([[job.id, job]]),
    fileReviews: new Map(),
    kv: new Map(),
    postedReviews: [],
    checkRuns: [],
    telemetry: [],
  };
  const record = (name: string) => recorded.calls.push(name);

  const now = { value: 1_700_000_000_000 };

  const settings = reviewSettingsSchema.parse({
    maxFiles: 25,
    ...seed.settings,
  });

  const toRow = (j: PersistedReviewJob): JobRow => ({
    ...j,
    status: j.status,
    check_run_id: j.checkRunId ?? null,
  });
  const patch = (jobId: string, changes: Partial<PersistedReviewJob>) => {
    const existing = recorded.jobs.get(jobId);
    if (existing) recorded.jobs.set(jobId, { ...existing, ...changes });
  };
  const setStep = (
    jobId: string,
    name: string,
    status: "pending" | "running" | "done" | "failed",
  ) => {
    const existing = recorded.jobs.get(jobId);
    if (!existing) return;
    const steps = existing.steps.filter((step) => step.name !== name);
    recorded.jobs.set(jobId, {
      ...existing,
      steps: [
        ...steps,
        {
          name,
          status,
          startedAt: ISO,
          finishedAt: status === "done" ? ISO : null,
        },
      ],
    });
  };

  const emptyRow = (
    jobId: string,
    input: { filePath: string; diffLineCount?: number },
  ): FileReviewRow => ({
    id: `fr-${input.filePath}`,
    job_id: jobId,
    file_path: input.filePath,
    file_status: "pending",
    model_used: "fake/model",
    diff_line_count: input.diffLineCount ?? 0,
    diff_input: null,
    raw_ai_output: null,
    parsed_comments: [],
    input_tokens: null,
    output_tokens: null,
    duration_ms: null,
    verdict: null,
    file_summary: null,
    overall_correctness: null,
    confidence_score: null,
    error_msg: null,
    model_provider: null,
    transient_error_count: 0,
    async_request_id: null,
    async_model: null,
    withheld_counts: {},
    batch_size: null,
  });

  const findingsFor = (path: string): ParsedReviewComment[] =>
    (model.findingsByPath?.[path] ?? []).map((finding) => ({
      path,
      line: finding.line,
      title: finding.title,
      body: finding.body,
      severity: "P1" as const,
      confidenceScore: 90,
      evidence: finding.evidence,
    })) as ParsedReviewComment[];

  const runtime: ReviewRuntime = {
    kv: {
      get: async (key) => recorded.kv.get(key) ?? null,
      put: async (key, value) => {
        recorded.kv.set(key, value);
      },
    },
    clock: { now: () => now.value },
    ids: { randomUUID: () => "lease-owner-0001" },

    botUsername: "codra-bot",

    jobs: {
      mapJob: (row) => recorded.jobs.get(String(row.id))!,
      getJobForProcessing: async (jobId) => {
        const found = recorded.jobs.get(jobId);
        return found ? toRow(found) : null;
      },
      claimJobLease: async (jobId): Promise<JobLeaseClaim> => {
        record("claimJobLease");
        const found = recorded.jobs.get(jobId);
        if (!found) return { status: "missing" };
        patch(jobId, {
          status: found.status === "queued" ? "running" : found.status,
        });
        return { status: "claimed", row: toRow(recorded.jobs.get(jobId)!) };
      },
      heartbeatJobLease: async () => {
        record("heartbeat");
      },
      releaseJobLease: async () => {
        record("releaseJobLease");
      },
      markJobContinuationQueued: async () => 1,
      resetJobContinuationCount: async () => {},
      getOtherRunningJobsCount: async () => 0,

      recoverExpiredJobLeases: async () => ({
        requeuedJobIds: [],
        failedJobs: [],
      }),
      getTerminalJobsNeedingCheckRunCompletion: async () => [],
      hasPendingMaintenanceWork: async () => false,
      clearSystemActive: async () => {},

      setJobWorkflowInstance: async () => {},
      setJobPullRequestMeta: async (jobId, meta) => {
        patch(jobId, meta);
      },
      insertJob: async () => job,
      findExistingJobForHead: async () => null,

      updateJobCheckRun: async (jobId, checkRunId) => {
        patch(jobId, { checkRunId });
      },
      markJobCheckRunCompleted: async () => {
        record("markJobCheckRunCompleted");
      },
      completePreparationStep: async (jobId, fileCount) => {
        record("completePreparationStep");
        patch(jobId, { fileCount });
        setStep(jobId, "Preparation", "done");
      },
      updateJobStep: async (jobId, stepName, update) => {
        record(`step:${stepName}:${update.status}`);
        setStep(jobId, stepName, update.status);
      },
      completeJob: async (jobId, input) => {
        record("completeJob");
        patch(jobId, {
          status: "done",
          verdict: input.verdict,
          commentCount: input.commentCount,
          fileCount: input.fileCount,
          totalInputTokens: input.totalInputTokens,
          totalOutputTokens: input.totalOutputTokens,
        });
      },
      failJob: async (jobId, errorMessage) => {
        record("failJob");
        patch(jobId, { status: "failed", errorMessage });
      },
      supersedeOlderJobs: async () => 0,
    },

    fileReviews: {
      upsertFileReview: async (jobId, input) => {
        record(`upsert:${input.filePath}:${input.fileStatus}`);
        recorded.fileReviews.set(input.filePath, {
          ...emptyRow(jobId, input),
          file_status: input.fileStatus,
          model_used: input.modelUsed,
          model_provider: input.modelProvider ?? null,
          diff_line_count: input.diffLineCount,
          raw_ai_output: input.rawAiOutput,
          parsed_comments: input.parsedComments,
          input_tokens: input.inputTokens,
          output_tokens: input.outputTokens,
          duration_ms: input.durationMs,
          verdict: input.verdict,
          file_summary: input.fileSummary,
          confidence_score: input.confidenceScore ?? null,
          error_msg: input.errorMessage,
          withheld_counts: input.withheldCounts ?? {},
          batch_size: 1,
        });
      },
      recordRetryableFileReviewFailure: async (_jobId, input) => {
        record(`transientFailure:${input.filePath}`);
        const existing = recorded.fileReviews.get(input.filePath);
        const count =
          (existing?.transient_error_count ?? 0) +
          (input.countsAsAttempt === false ? 0 : 1);
        recorded.fileReviews.set(input.filePath, {
          ...(existing ?? emptyRow(_jobId, input)),
          transient_error_count: count,
          error_msg: input.errorMessage,
        });
        return count;
      },
      getFileReviewsForJobs: async () => [...recorded.fileReviews.values()],

      bulkInheritFileReviews: async () => [],
      bulkUpsertFileReviews: async (jobId, inputs: BulkFileReviewInput[]) => {
        record(`bulkUpsert:${inputs.length}`);
        for (const input of inputs) {
          recorded.fileReviews.set(input.filePath, {
            ...emptyRow(jobId, input),
            file_status: input.fileStatus,
            model_used: input.modelUsed,
            model_provider: input.modelProvider ?? null,
            diff_line_count: input.diffLineCount,
            raw_ai_output: input.rawAiOutput,
            parsed_comments: input.parsedComments,
            input_tokens: input.inputTokens,
            output_tokens: input.outputTokens,
            duration_ms: input.durationMs,
            verdict: input.verdict,
            file_summary: input.fileSummary,
            confidence_score: input.confidenceScore ?? null,
            error_msg: input.errorMessage,
            batch_size: input.batchSize,
          });
        }
      },
      bulkRecordRetryableFileReviewFailures: async (_jobId, inputs) =>
        inputs.map((input) => ({
          filePath: input.filePath,
          transientErrorCount: 1,
        })),
      bulkMarkFilesFailed: async (jobId, files, opts) => {
        record(`bulkMarkFailed:${files.length}`);
        for (const file of files) {
          recorded.fileReviews.set(file.filePath, {
            ...emptyRow(jobId, file),
            file_status: "failed",
            model_used: opts.modelUsed,
            error_msg: opts.errorMessage,
          });
        }
      },

      getSuppressedFindings: async () => [],
      markCommentsPosted: async (_jobId, fingerprints) => {
        record(`markCommentsPosted:${fingerprints.length}`);
      },
      markCommentDispositions: async (_jobId, byFingerprint) => {
        record(`markDispositions:${byFingerprint.size}`);
      },
    },

    settings: { getReviewSettings: async () => settings },
    webhooks: { getWebhookDelivery: async () => null },
    learning: {
      getRepositoryIdForJob: async () => 1,
      getRejectedExemplars: async () => [],
    },
    modelConfigs: {
      getResolvedModelConfig: async () => ({ providerName: "fake" }),
    },
    repoConfig: {
      loadRepoConfig: async () => ({ parsedJson: config, enabled: true }),
    },
    telemetry: {
      send: async (event) => {
        recorded.telemetry.push(event);
      },
    },

    createTokenTracker: () => new TokenTrackerStub() as never,
    createGitHub: () => ({
      getPullRequest: async () => ({
        number: job.prNumber,
        title: job.prTitle,
        body: "Adds a retry helper.",
        draft: false,
        head: { sha: job.commitSha, ref: "feature" },
        base: { sha: "b".repeat(40), ref: "main" },
        user: { login: job.prAuthor ?? "octocat" },
      }),
      getPullRequestDiff: async () => {
        record("getPullRequestDiff");
        return SAMPLE_DIFF;
      },
      getCompareDiff: async () => SAMPLE_DIFF,
      createCheckRun: async (_o, _r, params) => {
        recorded.checkRuns.push({ title: params.title });
        return { id: 555 };
      },
      updateCheckRun: async (_o, _r, _id, params) => {
        recorded.checkRuns.push({
          title: params.title,
          status: params.status,
          conclusion: params.conclusion,
        });
        return undefined;
      },
      createReview: async (_o, _r, _pr, params) => {
        record("createReview");
        recorded.postedReviews.push({
          body: params.body,
          comments: params.comments.map((c) => ({
            path: c.path,
            body: c.body,
          })),
        });
        return {
          id: 999,
          postedIndices: params.comments.map((_c, index) => index),
        };
      },
      findBotReviewForCommit: async () => null,
      ensureLabel: async () => undefined,
      addIssueLabels: async () => undefined,
      removeIssueLabelsIfPresent: async () => undefined,
    }),
    createModel: () => ({
      reviewFile: async (params) => {
        if (model.failEveryCall) throw model.failEveryCall;
        record(`reviewFile:${params.file.path}`);
        const comments = findingsFor(params.file.path);
        return {
          rawText: JSON.stringify({ comments }),
          inputTokens: 100,
          outputTokens: 20,
          modelUsed: "fake/model",
          provider: "fake",
          reviewedLineCount: params.file.lineCount,
          wasPromptTruncated: false,
          userPrompt: "prompt",
          parsed: {
            comments,
            verdict: comments.length > 0 ? "comment" : "approve",
            fileSummary: `Reviewed ${params.file.path}`,
          },
        } as never;
      },
      reviewFiles: async (params) => {
        if (model.failEveryCall) throw model.failEveryCall;
        record(`reviewFiles:${params.files.length}`);
        const reviews = new Map(
          params.files.map((file) => {
            const comments = findingsFor(file.path);
            return [
              file.path,
              {
                comments,
                verdict: comments.length > 0 ? "comment" : "approve",
                fileSummary: `Reviewed ${file.path}`,
              },
            ];
          }),
        );
        return {
          rawText: "batch",
          inputTokens: 200,
          outputTokens: 40,
          modelUsed: "fake/model",
          provider: "fake",
          userPrompt: "prompt",
          batch: { reviews, missing: [] },
        } as never;
      },
      submitReviewBatch: async () => null,
      pollReviewBatch: async () => ({ status: "pending" as const }),
      verifyFindings: async (params) => {
        record(`verifyFindings:${params.candidates.length}`);
        const results = params.candidates.map((candidate) => ({
          index: candidate.index,
          verdict: model.verifyVerdicts?.[candidate.index] ?? "keep",
          reason: "fake verdict",
        }));
        return {
          rawText: JSON.stringify({ results }),
          inputTokens: 50,
          outputTokens: 10,
          modelUsed: "fake/model",
          provider: "fake",
        };
      },
    }),
    createFormatter: () => ({
      toReviewEvent: (verdict) =>
        verdict === "approve" ? "APPROVE" : "COMMENT",
      summarizeVerdict: (comments, hasFailures) => ({
        verdict: comments.length > 0 || hasFailures ? "comment" : "approve",
        errors: 0,
        warnings: comments.length,
      }),
      formatInlineComment: (comment) =>
        `**${comment.title}**\n\n${comment.body}`,
      formatReviewOverview: ({ commitSha, postedFindings }) =>
        `### Codra Review\nReviewed ${commitSha.slice(0, 7)}: ${postedFindings} posted`,
    }),

    githubClients: {
      forInstallation: () => {
        throw new Error("webhook resolution is not exercised by these tests");
      },
    },
    modelErrors: {
      isRetryableModelError: (error) =>
        error instanceof Error && error.message.includes("transient"),
      nextChainIndexOf: () => null,
    },
  };

  return { runtime, recorded, now };
}

class TokenTrackerStub {
  incrementSubrequests() {}
  getSubrequestCount() {
    return 0;
  }
  remainingSafeBudget() {
    return 40;
  }
  getTotalUsage() {
    return { inputTokens: 0, outputTokens: 0 };
  }
  getWasted() {
    return { calls: 0, inputTokens: 0, outputTokens: 0 };
  }
}
