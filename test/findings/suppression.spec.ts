import { describe, expect, it } from "vitest";
import { createTestEnv, dbDescribe, sha, uniqueName } from "../helpers";
import { upsertDashboardFeedback } from "@codraoss/db/comment-feedback";
import { runWithDb, queryRows } from "@codraoss/db/client";
import { insertJob } from "@codraoss/db/jobs";
import {
  getSuppressedFindings,
  markCommentsPosted,
  upsertFileReview,
} from "@codraoss/db/file-reviews";
import type { ParsedReviewComment } from "@codraoss/schema";

const finding = (
  over: Partial<ParsedReviewComment> = {},
): ParsedReviewComment => ({
  path: "a.ts",
  line: 1,
  position: 1,
  severity: "P1",
  category: "quality",
  title: "Unvalidated input",
  body: "The value is never checked.",
  fingerprint: "fp0001",
  anchorHash: "anchor01",
  ...over,
});

dbDescribe("cross-run finding suppression", () => {
  const env = createTestEnv();

  async function seedJob(repo: string, commitSha: string) {
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo,
      prNumber: 1,
      prTitle: "PR",
      prAuthor: "author",
      commitSha,
      baseSha: sha("b"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });
    return job.id;
  }

  async function seedPostedFinding(
    jobId: string,
    comment: ParsedReviewComment,
  ) {
    await upsertFileReview(env, jobId, {
      filePath: comment.path,
      fileStatus: "done",
      modelUsed: "test-model",
      diffLineCount: 1,
      diffInput: null,
      rawAiOutput: null,
      parsedComments: [comment],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: "comment",
      fileSummary: "summary",
      errorMessage: null,
    });
    await markCommentsPosted(env, jobId, [comment.fingerprint!]);
  }

  it("suppresses a finding already posted on an earlier commit of the same PR", async () => {
    const repo = uniqueName("suppress-earlier");
    await runWithDb(env, async () => {
      const firstJob = await seedJob(repo, sha("1"));
      await seedPostedFinding(firstJob, finding());

      const secondJob = await seedJob(repo, sha("2"));
      const suppressed = await getSuppressedFindings(env, secondJob);

      expect(suppressed).toContainEqual(
        expect.objectContaining({
          fingerprint: "fp0001",
          anchor_hash: "anchor01",
          anchored: true,
        }),
      );
    });
  });

  // Identity alone is not enough. If the developer edited the flagged line the anchor hash changes,
  // and the caller must be able to tell that apart so the finding is raised again.
  it("reports the anchor hash so an edited line can still be re-raised", async () => {
    const repo = uniqueName("suppress-edited");
    await runWithDb(env, async () => {
      const firstJob = await seedJob(repo, sha("3"));
      await seedPostedFinding(firstJob, finding({ anchorHash: "anchor-old" }));

      const secondJob = await seedJob(repo, sha("4"));
      const suppressed = await getSuppressedFindings(env, secondJob);
      const match = suppressed.find((s) => s.fingerprint === "fp0001");

      expect(match?.anchor_hash).toBe("anchor-old");
      expect(match?.anchor_hash).not.toBe("anchor-new");
    });
  });

  // Retries and mention-triggered re-reviews reuse the SAME head commit; without the commit_sha
  // guard a manual re-review would match everything the previous run posted.
  it("does not suppress a re-review of the same commit", async () => {
    const repo = uniqueName("suppress-samesha");
    const commit = sha("5");
    await runWithDb(env, async () => {
      const firstJob = await seedJob(repo, commit);
      await seedPostedFinding(firstJob, finding());

      const retryJob = await seedJob(repo, commit);
      const suppressed = await getSuppressedFindings(env, retryJob);

      expect(suppressed.filter((s) => s.anchored)).toHaveLength(0);
    });
  });

  it("does not suppress findings that were generated but never posted", async () => {
    const repo = uniqueName("suppress-unposted");
    await runWithDb(env, async () => {
      const firstJob = await seedJob(repo, sha("6"));
      // Same as seedPostedFinding, minus the markCommentsPosted call: the 422 fallback and the
      // unaddressable-comment filter both produce findings GitHub never showed.
      await upsertFileReview(env, firstJob, {
        filePath: "a.ts",
        fileStatus: "done",
        modelUsed: "test-model",
        diffLineCount: 1,
        diffInput: null,
        rawAiOutput: null,
        parsedComments: [finding()],
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        verdict: "comment",
        fileSummary: "summary",
        errorMessage: null,
      });

      const secondJob = await seedJob(repo, sha("7"));
      const suppressed = await getSuppressedFindings(env, secondJob);

      expect(suppressed.filter((s) => s.anchored)).toHaveLength(0);
    });
  });

  it("suppresses repo-wide, anchor-independently, when a human deleted the comment", async () => {
    const repo = uniqueName("suppress-rejected");
    await runWithDb(env, async () => {
      const job = await seedJob(repo, sha("8"));
      const [{ repository_id: repositoryId }] = await queryRows<{
        repository_id: number;
      }>(env, "SELECT repository_id FROM jobs WHERE id = $1::uuid", [job]);
      await queryRows(
        env,
        `INSERT INTO comment_feedback (repository_id, pr_number, fingerprint, anchor_hash, github_comment_id, outcome)
         VALUES ($1::int, 1, 'fp-rejected', NULL, 12345, 'deleted')`,
        [repositoryId],
      );

      const suppressed = await getSuppressedFindings(env, job);
      const rejected = suppressed.find((s) => s.fingerprint === "fp-rejected");

      expect(rejected).toBeDefined();
      expect(rejected?.anchored).toBe(false);
      expect(rejected?.anchor_hash).toBeNull();
    });
  });

  // Resolving a thread usually means "I fixed it" -- the finding was good. Treating it as negative
  // would train the system to stop reporting exactly what works.
  it("does not suppress on resolved feedback", async () => {
    const repo = uniqueName("suppress-resolved");
    await runWithDb(env, async () => {
      const job = await seedJob(repo, sha("9"));
      const [{ repository_id: repositoryId }] = await queryRows<{
        repository_id: number;
      }>(env, "SELECT repository_id FROM jobs WHERE id = $1::uuid", [job]);
      await queryRows(
        env,
        `INSERT INTO comment_feedback (repository_id, pr_number, fingerprint, anchor_hash, github_comment_id, outcome)
         VALUES ($1::int, 1, 'fp-resolved', NULL, 54321, 'resolved')`,
        [repositoryId],
      );

      const suppressed = await getSuppressedFindings(env, job);
      expect(
        suppressed.find((s) => s.fingerprint === "fp-resolved"),
      ).toBeUndefined();
    });
  });

  // Ground truth from the dashboard. comment_feedback sat empty in production because the only way to
  // register a false positive was deleting an inline GitHub comment, which nobody ever did.
  describe("dashboard labels", () => {
    async function seedRepo(suffix: string) {
      const job = await seedJob(uniqueName(`label-${suffix}`), sha("d"));
      const [{ repository_id: repositoryId }] = await queryRows<{
        repository_id: number;
      }>(env, "SELECT repository_id FROM jobs WHERE id = $1::uuid", [job]);
      return { job, repositoryId };
    }

    const label = (
      repositoryId: number,
      job: string,
      outcome: "marked_wrong" | "marked_right",
      fingerprint = "fp-labelled",
    ) =>
      upsertDashboardFeedback(env, {
        repositoryId,
        prNumber: 1,
        fingerprint,
        anchorHash: null,
        jobId: job,
        labelledBy: 42,
        outcome,
      });

    it("suppresses a finding a human marked wrong", async () => {
      await runWithDb(env, async () => {
        const { job, repositoryId } = await seedRepo("wrong");
        await label(repositoryId, job, "marked_wrong");

        const suppressed = await getSuppressedFindings(env, job);
        expect(
          suppressed.find((s) => s.fingerprint === "fp-labelled"),
        ).toMatchObject({ anchored: false });
      });
    });

    // Same reasoning as 'resolved': marking a finding CORRECT must never suppress it.
    it("does not suppress a finding a human marked right", async () => {
      await runWithDb(env, async () => {
        const { job, repositoryId } = await seedRepo("right");
        await label(repositoryId, job, "marked_right");

        const suppressed = await getSuppressedFindings(env, job);
        expect(
          suppressed.find((s) => s.fingerprint === "fp-labelled"),
        ).toBeUndefined();
      });
    });
  });
});
