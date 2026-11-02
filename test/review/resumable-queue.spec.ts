import worker from "../../apps/worker/src/index";
import {
  claimJobLease,
  getJobForProcessing,
  insertJob,
  markJobContinuationQueued,
  recoverExpiredJobLeases,
  releaseJobLease,
} from "@codraoss/db/jobs";
import {
  getFileReviewsForJobs,
  recordRetryableFileReviewFailure,
  upsertFileReview,
} from "@codraoss/db/file-reviews";
import { getDb } from "@codraoss/db/client";
import { createTestEnv, dbDescribe, sha, uniqueName } from "../helpers";

dbDescribe("resumable queue primitives", () => {
  const env = createTestEnv();

  it("sets a fresh lease when claiming a queued job", async () => {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueName("lease"),
      prNumber: 1,
      prTitle: "Lease Test",
      prAuthor: "author",
      commitSha: sha("a"),
      baseSha: sha("b"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    const claim = await claimJobLease(env, job.id, "lease-a", 600);
    expect(claim.status).toBe("claimed");

    const row = await getJobForProcessing(env, job.id);
    expect(row?.status).toBe("running");
    expect(row?.lease_owner).toBe("lease-a");
    expect(row?.lease_expires_at).toBeTruthy();
    expect(row?.heartbeat_at).toBeTruthy();
  });

  it("reports busy for a fresh duplicate delivery instead of reclaiming", async () => {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueName("busy"),
      prNumber: 1,
      prTitle: "Busy Test",
      prAuthor: "author",
      commitSha: sha("c"),
      baseSha: sha("d"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    await claimJobLease(env, job.id, "lease-a", 600);
    const duplicate = await claimJobLease(env, job.id, "lease-b", 600);
    expect(duplicate.status).toBe("busy");
  });

  it("reclaims an expired lease", async () => {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueName("expired"),
      prNumber: 1,
      prTitle: "Expired Test",
      prAuthor: "author",
      commitSha: sha("e"),
      baseSha: sha("f"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    await claimJobLease(env, job.id, "lease-a", 600);
    await getDb(env).query(
      `UPDATE jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [job.id],
    );

    const reclaimed = await claimJobLease(env, job.id, "lease-b", 600);
    expect(reclaimed.status).toBe("claimed");

    const row = await getJobForProcessing(env, job.id);
    expect(row?.lease_owner).toBe("lease-b");
  });

  it("fails repeatedly expired jobs after the recovery limit", async () => {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueName("recovery"),
      prNumber: 1,
      prTitle: "Recovery Test",
      prAuthor: "author",
      commitSha: sha("1"),
      baseSha: sha("2"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    await claimJobLease(env, job.id, "lease-a", 600);
    await getDb(env).query(
      `UPDATE jobs SET lease_expires_at = now() - interval '1 minute', recovery_count = 3 WHERE id = $1`,
      [job.id],
    );

    // Scoped to this job: the sweep is table-wide with LIMIT 25 + SKIP LOCKED, so with
    // fileParallelism the stale 'running' rows of concurrent suites could crowd it out.
    const recovered = await recoverExpiredJobLeases(env, 3, 300, [job.id]);
    expect(recovered.failedJobs.map((row) => row.id)).toContain(job.id);

    const row = await getJobForProcessing(env, job.id);
    expect(row?.status).toBe("failed");
  });

  it("requeues running jobs that have no lease and an old continuation handoff", async () => {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueName("unleased"),
      prNumber: 1,
      prTitle: "Unleased Test",
      prAuthor: "author",
      commitSha: sha("5"),
      baseSha: sha("6"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    await claimJobLease(env, job.id, "lease-a", 600);
    await getDb(env).query(
      `
        UPDATE jobs
        SET lease_owner = NULL,
            lease_expires_at = NULL,
            heartbeat_at = now() - interval '5 minutes',
            last_queue_message_at = now() - interval '5 minutes'
        WHERE id = $1
      `,
      [job.id],
    );

    const recovered = await recoverExpiredJobLeases(env, 3, 120, [job.id]);
    expect(recovered.requeuedJobIds).toContain(job.id);

    const row = await getJobForProcessing(env, job.id);
    expect(row?.status).toBe("running");
    expect(row?.lease_owner).toBeNull();
    expect(row?.recovery_count).toBe(1);
    expect(row?.error_msg).toBeNull();
  });

  it("does not recover an unleased job that just scheduled a retry continuation", async () => {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueName("retry-handoff"),
      prNumber: 1,
      prTitle: "Retry Handoff Test",
      prAuthor: "author",
      commitSha: sha("7"),
      baseSha: sha("8"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    await claimJobLease(env, job.id, "lease-a", 600);
    await getDb(env).query(
      `
        UPDATE jobs
        SET heartbeat_at = now() - interval '10 minutes',
            last_queue_message_at = now() - interval '10 minutes'
        WHERE id = $1
      `,
      [job.id],
    );

    await markJobContinuationQueued(env, job.id);
    await releaseJobLease(env, job.id, "lease-a");

    // Also scoped, so the empty result proves the grace-period rule held rather than that the job
    // simply fell outside the batch window.
    const recovered = await recoverExpiredJobLeases(env, 3, 120, [job.id]);
    expect(recovered.requeuedJobIds).not.toContain(job.id);

    const row = await getJobForProcessing(env, job.id);
    expect(row?.status).toBe("running");
    expect(row?.lease_owner).toBeNull();
    expect(row?.recovery_count).toBe(0);
  });

  it("upserts file reviews without duplicating the same file", async () => {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueName("upsert"),
      prNumber: 1,
      prTitle: "Upsert Test",
      prAuthor: "author",
      commitSha: sha("3"),
      baseSha: sha("4"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    const baseReview = {
      filePath: "src/app.ts",
      fileStatus: "done" as const,
      modelUsed: "test-model",
      modelProvider: "test-provider",
      diffLineCount: 1,
      diffInput: "diff",
      rawAiOutput: "{}",
      parsedComments: [],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: "approve" as const,
      fileSummary: "ok",
      errorMessage: null,
    };

    await upsertFileReview(env, job.id, baseReview);
    await upsertFileReview(env, job.id, {
      ...baseReview,
      fileSummary: "updated",
    });

    const reviews = await getFileReviewsForJobs(env, [job.id]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].file_summary).toBe("updated");
  });

  it("tracks retryable file review failures and resets the count after success", async () => {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueName("transient-file"),
      prNumber: 1,
      prTitle: "Transient File Test",
      prAuthor: "author",
      commitSha: sha("9"),
      baseSha: sha("0"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    const failureInput = {
      filePath: "src/app.ts",
      modelUsed: "gemini-3.1-pro-preview",
      modelProvider: "google",
      diffLineCount: 1,
      diffInput: "diff",
      durationMs: 1,
      errorMessage: "All configured review models failed; retrying later.",
    };

    await expect(
      recordRetryableFileReviewFailure(env, job.id, failureInput),
    ).resolves.toBe(1);
    await expect(
      recordRetryableFileReviewFailure(env, job.id, failureInput),
    ).resolves.toBe(2);

    await upsertFileReview(env, job.id, {
      filePath: "src/app.ts",
      fileStatus: "done",
      modelUsed: "gemini-3.1-pro-preview",
      modelProvider: "google",
      diffLineCount: 1,
      diffInput: "diff",
      rawAiOutput: "{}",
      parsedComments: [],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: "approve",
      fileSummary: "ok",
      errorMessage: null,
    });

    const reviews = await getFileReviewsForJobs(env, [job.id]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].file_status).toBe("done");
    expect(reviews[0].transient_error_count).toBe(0);
  });
});

describe("queue handler", () => {
  it("drops invalid messages by acknowledging them", async () => {
    const env = createTestEnv();
    const message = {
      body: { bad: true },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await worker.queue(
      { messages: [message] } as any,
      env,
      {} as ExecutionContext,
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });
});
