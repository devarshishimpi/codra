import { logger } from "../logger";
import { defaultRepoConfig, type RepoConfig } from "@codraoss/schema";
import type { ReviewGitProvider, ReviewRuntime } from "../ports";
import { getDiffFiles } from "./diff-cache";
import type { RejectedExemplar } from "../prompts/file-review";
import { type PersistedReviewJob, enqueueJobPhase } from "./phase-control";
import {
  JOB_LEASE_SECONDS,
  FRESH_INVOCATION_YIELD_SECONDS,
} from "../constants";

export async function runPreparePhase(
  env: ReviewRuntime,
  job: PersistedReviewJob,
  leaseOwner: string,
  github: ReviewGitProvider,
) {
  await env.jobs.updateJobStep(job.id, "Preparation", { status: "running" });
  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;

  try {
    await env.jobs.setJobPullRequestMeta(job.id, {
      prTitle: pr.title ?? null,
      prAuthor: pr.user?.login ?? null,
    });
  } catch (error) {
    logger.warn(
      `Failed to refresh PR metadata for job ${job.id}`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  let checkRunId = job.checkRunId;
  if (!checkRunId) {
    const checkRun = await github.createCheckRun(job.owner, job.repo, {
      headSha: pr.head.sha,
      title: "Review queued",
      summary: "Codra has started reviewing this pull request.",
    });
    checkRunId = checkRun.id;
    await env.jobs.updateJobCheckRun(job.id, checkRun.id);
  }

  const { maxFiles } = await env.settings.getReviewSettings();
  const { files } = await getDiffFiles(env, job, github, config, maxFiles);
  await env.jobs.completePreparationStep(job.id, files.length);
  await env.jobs.heartbeatJobLease(job.id, leaseOwner, JOB_LEASE_SECONDS);

  if (files.length === 0) {
    await env.jobs.updateJobStep(job.id, "Reviewing Files", { status: "done" });
    await enqueueJobPhase(
      env,
      job.id,
      "finalize",
      FRESH_INVOCATION_YIELD_SECONDS,
    );
    return;
  }

  if (checkRunId) {
    try {
      await github.updateCheckRun(job.owner, job.repo, checkRunId, {
        title: `Reviewing (0/${files.length})`,
        summary: "Codra is analyzing changed files.",
      });
    } catch (error) {
      logger.warn(
        `Failed to update initial progress check run for job ${job.id}; continuing to the review phase anyway`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  await enqueueJobPhase(env, job.id, "review", FRESH_INVOCATION_YIELD_SECONDS);
}

export async function loadRejectedExemplars(
  env: Pick<ReviewRuntime, "learning">,
  job: PersistedReviewJob,
): Promise<RejectedExemplar[]> {
  try {
    const repositoryId = await env.learning.getRepositoryIdForJob(job.id);
    if (repositoryId === null) return [];
    const rows = await env.learning.getRejectedExemplars({
      repositoryId,
      limit: 5,
    });
    return rows.map((row) => ({ title: row.title, claimType: row.claim_type }));
  } catch (error) {
    logger.warn("Could not load rejected exemplars; reviewing without them", {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
