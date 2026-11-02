import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv } from "../helpers";

// Regression: hitting the per-invocation subrequest cap used to fail the job instead of
// rescheduling on a fresh budget.

const {
  getJobForProcessingMock,
  mapJobMock,
  getOtherRunningJobsCountMock,
  claimJobLeaseMock,
  releaseJobLeaseMock,
  markJobContinuationQueuedMock,
  updateJobStepMock,
  failJobMock,
  markJobCheckRunCompletedMock,
  resetJobContinuationCountMock,
  getPullRequestMock,
} = vi.hoisted(() => ({
  getJobForProcessingMock: vi.fn(),
  mapJobMock: vi.fn(),
  getOtherRunningJobsCountMock: vi.fn(),
  claimJobLeaseMock: vi.fn(),
  releaseJobLeaseMock: vi.fn(),
  markJobContinuationQueuedMock: vi.fn(),
  updateJobStepMock: vi.fn(),
  failJobMock: vi.fn(),
  markJobCheckRunCompletedMock: vi.fn(),
  resetJobContinuationCountMock: vi.fn(),
  getPullRequestMock: vi.fn(),
}));

vi.mock("@codraoss/db/jobs", async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    getJobForProcessing: getJobForProcessingMock,
    mapJob: mapJobMock,
    getOtherRunningJobsCount: getOtherRunningJobsCountMock,
    claimJobLease: claimJobLeaseMock,
    releaseJobLease: releaseJobLeaseMock,
    markJobContinuationQueued: markJobContinuationQueuedMock,
    updateJobStep: updateJobStepMock,
    failJob: failJobMock,
    markJobCheckRunCompleted: markJobCheckRunCompletedMock,
    resetJobContinuationCount: resetJobContinuationCountMock,
  };
});

vi.mock("@codraoss/db/app-settings", async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    getReviewSettings: vi
      .fn()
      .mockResolvedValue({ concurrencyLevel: "low", maxComments: 20 }),
  };
});

vi.mock("@codraoss/provider-github", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    GitHubService: class {
      getPullRequest = getPullRequestMock;
      updateCheckRun = vi.fn().mockResolvedValue(undefined);
    },
  };
});

import { runReviewJob } from "@server/core/review";

const JOB_ID = "9dda151e-0c61-4205-9cba-497027706698";

const reviewJob = {
  id: JOB_ID,
  installationId: "123",
  owner: "test-owner",
  repo: "test-repo",
  prNumber: 26,
  checkRunId: null as number | null,
  retryOfJobId: null as string | null,
  trigger: "auto" as const,
  createdAt: new Date().toISOString(),
  // Preparation done so runReviewPhase reaches the throwing getPullRequest call.
  steps: [{ name: "Preparation", status: "done" }],
  configSnapshot: undefined,
};

describe("runReviewJob subrequest-budget handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getJobForProcessingMock.mockResolvedValue({ check_run_id: null });
    mapJobMock.mockReturnValue(reviewJob);
    getOtherRunningJobsCountMock.mockResolvedValue(0);
    claimJobLeaseMock.mockResolvedValue({ status: "claimed", row: {} });
    releaseJobLeaseMock.mockResolvedValue(undefined);
    markJobContinuationQueuedMock.mockResolvedValue(undefined);
    updateJobStepMock.mockResolvedValue(undefined);
    failJobMock.mockResolvedValue(undefined);
    resetJobContinuationCountMock.mockResolvedValue(undefined);
  });

  it("reschedules the same phase (fresh budget) instead of failing the job when it hits the per-invocation subrequest limit", async () => {
    const env = createTestEnv();
    getPullRequestMock.mockRejectedValue(
      new Error("Too many subrequests by single Worker invocation."),
    );

    const result = await runReviewJob(env, {
      jobId: JOB_ID,
      phase: "review",
    } as any);

    expect(result).toEqual({
      action: "next_phase",
      phase: "review",
      delaySeconds: expect.any(Number),
      jobId: JOB_ID,
      freshInstance: true,
    });
    expect(markJobContinuationQueuedMock).toHaveBeenCalledTimes(1);
    expect(releaseJobLeaseMock).toHaveBeenCalledTimes(1);
    expect(failJobMock).not.toHaveBeenCalled();
  });

  it("still fails the job terminally for an unrelated (non-subrequest, non-retryable) error", async () => {
    const env = createTestEnv();
    getPullRequestMock.mockRejectedValue(new Error("totally unexpected boom"));

    const result = await runReviewJob(env, {
      jobId: JOB_ID,
      phase: "review",
    } as any);

    expect(result).toEqual({ action: "ack" });
    expect(failJobMock).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      "totally unexpected boom",
    );
    expect(markJobContinuationQueuedMock).not.toHaveBeenCalled();
  });

  it("keeps rescheduling while the continuation count is still under the ceiling", async () => {
    const env = createTestEnv();
    // At MAX_JOB_CONTINUATIONS (20), still under the ceiling.
    markJobContinuationQueuedMock.mockResolvedValue(20);
    getPullRequestMock.mockRejectedValue(
      new Error("Too many subrequests by single Worker invocation."),
    );

    const result = await runReviewJob(env, {
      jobId: JOB_ID,
      phase: "review",
    } as any);

    expect(result).toEqual({
      action: "next_phase",
      phase: "review",
      delaySeconds: expect.any(Number),
      jobId: JOB_ID,
      freshInstance: true,
    });
    expect(failJobMock).not.toHaveBeenCalled();
  });

  it("degrades a wedged review phase to a partial review (finalize) once it exceeds the continuation ceiling", async () => {
    const env = createTestEnv();
    // Past the ceiling (21), hands off to finalize for a partial review instead of discarding it.
    markJobContinuationQueuedMock.mockResolvedValue(21);
    getPullRequestMock.mockRejectedValue(
      new Error("Too many subrequests by single Worker invocation."),
    );

    const result = await runReviewJob(env, {
      jobId: JOB_ID,
      phase: "review",
    } as any);

    expect(result).toEqual({
      action: "next_phase",
      phase: "finalize",
      delaySeconds: expect.any(Number),
      jobId: JOB_ID,
      freshInstance: true,
    });
    expect(failJobMock).not.toHaveBeenCalled();
    expect(releaseJobLeaseMock).toHaveBeenCalled();
    // Finalize needs a fresh continuation budget.
    expect(resetJobContinuationCountMock).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
    );
  });

  it("reschedules the finalize phase (fresh budget) while under its low continuation ceiling", async () => {
    const env = createTestEnv();
    // At MAX_FINALIZE_CONTINUATIONS (3), still under the ceiling.
    markJobContinuationQueuedMock.mockResolvedValue(3);
    getPullRequestMock.mockRejectedValue(
      new Error("Too many subrequests by single Worker invocation."),
    );

    const result = await runReviewJob(env, {
      jobId: JOB_ID,
      phase: "finalize",
    } as any);

    expect(result).toEqual({
      action: "next_phase",
      phase: "finalize",
      delaySeconds: expect.any(Number),
      jobId: JOB_ID,
      freshInstance: true,
    });
    expect(markJobContinuationQueuedMock).toHaveBeenCalledTimes(1);
    expect(releaseJobLeaseMock).toHaveBeenCalledTimes(1);
    expect(failJobMock).not.toHaveBeenCalled();
  });

  it("fails a wedged finalize phase fast once it exceeds the LOW finalize ceiling (not the review ceiling)", async () => {
    const env = createTestEnv();
    // Past finalize's tighter ceiling (3), fails instead of using review's larger one.
    markJobContinuationQueuedMock.mockResolvedValue(4);
    getPullRequestMock.mockRejectedValue(
      new Error("Too many subrequests by single Worker invocation."),
    );

    const result = await runReviewJob(env, {
      jobId: JOB_ID,
      phase: "finalize",
    } as any);

    expect(result).toEqual({ action: "ack" });
    expect(failJobMock).toHaveBeenCalledTimes(1);
    expect(releaseJobLeaseMock).toHaveBeenCalled();
  });

  it("fails a non-review phase terminally once it exceeds the continuation ceiling without making progress", async () => {
    const env = createTestEnv();
    // Prepare has no partial result to salvage, unlike review.
    markJobContinuationQueuedMock.mockResolvedValue(21);
    getPullRequestMock.mockRejectedValue(
      new Error("Too many subrequests by single Worker invocation."),
    );

    const result = await runReviewJob(env, {
      jobId: JOB_ID,
      phase: "prepare",
    } as any);

    expect(result).toEqual({ action: "ack" });
    expect(failJobMock).toHaveBeenCalledTimes(1);
    expect(failJobMock.mock.calls[0][2]).toMatch(
      /could not make progress after 21 continuation attempts/,
    );
    expect(releaseJobLeaseMock).toHaveBeenCalled();
  });
});
