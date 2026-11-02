import type { JobSummary, RepoConfig } from "@codraoss/schema";

export type PersistedReviewJob = JobSummary;

export type JobRow = {
  status:
    | "queued"
    | "running"
    | "done"
    | "failed"
    | "superseded"
    | "cancelled"
    | "stopped";
  check_run_id: number | null;
  [column: string]: unknown;
};

export type JobLeaseClaim =
  | { status: "claimed"; row: JobRow }
  | { status: "busy"; row: JobRow; retryAfterSeconds: number }
  | { status: "terminal"; row: JobRow }
  | { status: "missing" };

export interface JobStore {
  mapJob(row: JobRow): PersistedReviewJob;

  getJobForProcessing(jobId: string): Promise<JobRow | null>;
  claimJobLease(
    jobId: string,
    leaseOwner: string,
    leaseSeconds: number,
  ): Promise<JobLeaseClaim>;
  heartbeatJobLease(
    jobId: string,
    leaseOwner: string,
    leaseSeconds: number,
  ): Promise<void>;
  releaseJobLease(jobId: string, leaseOwner: string): Promise<void>;
  markJobContinuationQueued(
    jobId: string,
    delaySeconds?: number,
  ): Promise<number>;
  resetJobContinuationCount(jobId: string): Promise<void>;
  getOtherRunningJobsCount(excludeJobId: string): Promise<number>;

  setJobWorkflowInstance(
    jobId: string,
    workflowInstanceId: string,
  ): Promise<void>;
  setJobPullRequestMeta(
    jobId: string,
    meta: { prTitle: string | null; prAuthor: string | null },
  ): Promise<void>;
  insertJob(input: {
    installationId: string;
    owner: string;
    repo: string;
    prNumber: number;
    prTitle: string | null;
    prAuthor: string | null;
    commitSha: string;
    baseSha: string;
    trigger: "auto" | "mention" | "retry";
    headRef: string | null;
    baseRef: string | null;
    configSnapshot?: RepoConfig | null;
    retryOfJobId?: string | null;
  }): Promise<PersistedReviewJob>;
  findExistingJobForHead(input: {
    owner: string;
    repo: string;
    prNumber: number;
    commitSha: string;
    trigger: "auto" | "mention";
  }): Promise<PersistedReviewJob | null>;

  recoverExpiredJobLeases(maxCount: number): Promise<{
    requeuedJobIds: string[];
    failedJobs: Array<{ id: string }>;
  }>;
  getTerminalJobsNeedingCheckRunCompletion(limit: number): Promise<
    Array<{
      id: string;
      status: string;
      check_run_id: number | null;
      installation_id: string;
      owner: string;
      repo: string;
      verdict: string | null;
      file_count: number | null;
      comment_count: number | null;
      error_msg: string | null;
    }>
  >;
  hasPendingMaintenanceWork(): Promise<boolean>;
  clearSystemActive(): Promise<void>;

  updateJobCheckRun(jobId: string, checkRunId: number): Promise<void>;
  markJobCheckRunCompleted(jobId: string): Promise<void>;
  completePreparationStep(jobId: string, fileCount: number): Promise<void>;
  updateJobStep(
    jobId: string,
    stepName: string,
    update: {
      status: "pending" | "running" | "done" | "failed";
      startedAt?: string | null;
      finishedAt?: string | null;
      error?: string | null;
    },
  ): Promise<void>;
  completeJob(
    jobId: string,
    input: {
      verdict: "approve" | "comment";
      fileCount: number;
      commentCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      summaryMarkdown: string;
      reviewId: number | null;
      summaryModel: string | null;
      overallConfidenceScore?: number | null;
      errorMessage?: string | null;
    },
  ): Promise<void>;
  failJob(jobId: string, errorMessage: string): Promise<void>;
  supersedeOlderJobs(input: {
    installationId: string;
    owner: string;
    repo: string;
    prNumber: number;
    newJobId: string;
  }): Promise<number>;
}
