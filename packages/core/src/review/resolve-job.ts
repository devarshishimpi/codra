import type { ReviewJobMessage } from "@codraoss/schema";
import type {
  ChangeRequestWebhookPayload,
  WebhookPayload,
} from "@codraoss/schema/webhook";
import { logger } from "../logger";
import type { ReviewRuntime } from "../ports";
import type { PersistedReviewJob } from "./phase-control";
import { extractReviewRequest } from "./request";

export async function resolveQueuedJob(
  env: ReviewRuntime,
  message: ReviewJobMessage,
): Promise<{
  job: PersistedReviewJob;
  phase: "prepare" | "review" | "finalize";
} | null> {
  if (message.jobId) {
    const row = await env.jobs.getJobForProcessing(message.jobId);
    return row
      ? { job: env.jobs.mapJob(row), phase: message.phase ?? "review" }
      : null;
  }

  if (!message.eventName) {
    logger.warn("Queue message ignored: missing eventName");
    return null;
  }

  let eventName = message.eventName;
  let payload = message.payload as WebhookPayload | undefined;

  if (payload === undefined) {
    const delivery = await env.webhooks.getWebhookDelivery(message.deliveryId);
    if (!delivery) {
      logger.warn(
        `Queue message ignored: webhook delivery not found: ${message.deliveryId}`,
      );
      return null;
    }

    eventName = delivery.event_name;
    payload = delivery.payload as WebhookPayload;
  }

  if (eventName !== "change_request" && eventName !== "comment") {
    logger.info(
      `Queue message ignored: unsupported webhook event ${eventName}`,
    );
    return null;
  }

  const installationId = String(payload.installationId ?? "");
  if (!installationId || !("repository" in payload) || !payload.repository) {
    logger.info(
      "Queue message ignored: missing installation or repository info",
    );
    return null;
  }

  const repoConfig = await env.repoConfig.loadRepoConfig({
    installationId,
    owner: payload.repository.owner,
    repo: payload.repository.name,
  });

  if (repoConfig.enabled === false) {
    logger.info(
      `Job ignored: repository ${payload.repository.owner}/${payload.repository.name} is disabled`,
    );
    return null;
  }

  const extracted = extractReviewRequest({
    eventName,
    payload,
    botUsername: env.botUsername,
    config: repoConfig.parsedJson,
  });

  if (!extracted) {
    if (eventName === "change_request") {
      const prPayload = payload as ChangeRequestWebhookPayload;
      if (
        prPayload.action === "closed" &&
        repoConfig.parsedJson.review.labels !== false
      ) {
        const labels = repoConfig.parsedJson.review.labels;
        const gh = env.githubClients.forInstallation(installationId);
        await gh.removeIssueLabelsIfPresent(
          prPayload.repository.owner,
          prPayload.repository.name,
          prPayload.changeRequest.number,
          [labels.p1, labels.p2, labels.p3],
        );
      }
    }
    return null;
  }

  let resolved = extracted;
  const githubClient = env.githubClients.forInstallation(installationId);
  if (eventName === "comment") {
    const pr = await githubClient.getPullRequest(
      extracted.owner,
      extracted.repo,
      extracted.prNumber,
    );
    resolved = {
      ...extracted,
      prTitle: pr.title,
      prAuthor: pr.user.login,
      commitSha: pr.head.sha,
      baseSha: pr.base.sha,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
    };
  }

  const duplicateJob = await env.jobs.findExistingJobForHead({
    owner: resolved.owner,
    repo: resolved.repo,
    prNumber: resolved.prNumber,
    commitSha: resolved.commitSha,
    trigger: resolved.trigger,
  });
  if (duplicateJob) {
    if (duplicateJob.status === "queued" || duplicateJob.status === "running") {
      logger.info(
        `Resuming duplicate in-flight job ${duplicateJob.id} for ${resolved.owner}/${resolved.repo} PR #${resolved.prNumber}.`,
      );
      return { job: duplicateJob, phase: message.phase ?? "prepare" };
    }

    logger.info(
      `Duplicate terminal job found for ${resolved.owner}/${resolved.repo} PR #${resolved.prNumber}, skipping.`,
    );
    return null;
  }

  const job = await env.jobs.insertJob({
    installationId: resolved.installationId,
    owner: resolved.owner,
    repo: resolved.repo,
    prNumber: resolved.prNumber,
    prTitle: resolved.prTitle,
    prAuthor: resolved.prAuthor,
    commitSha: resolved.commitSha,
    baseSha: resolved.baseSha,
    trigger: resolved.trigger,
    headRef: resolved.headRef,
    baseRef: resolved.baseRef,
    configSnapshot: repoConfig.parsedJson,
  });

  await env.jobs.supersedeOlderJobs({
    installationId: resolved.installationId,
    owner: resolved.owner,
    repo: resolved.repo,
    prNumber: resolved.prNumber,
    newJobId: job.id,
  });

  return { job, phase: "prepare" };
}
