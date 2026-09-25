import { logger } from "../logger";
import {
  defaultRepoConfig,
  type ParsedReviewComment,
  type RepoConfig,
} from "@codraoss/schema";
import { shadowEvaluate } from "../finding-gates";
import { getDiffFiles } from "./diff-cache";
import type {
  ReviewFormatter,
  ReviewGitProvider,
  ReviewModel,
  ReviewRuntime,
} from "../ports";
import {
  type PersistedReviewJob,
  enqueueJobPhase,
  heartbeatAndCheckSuperseded,
} from "./phase-control";
import { FRESH_INVOCATION_YIELD_SECONDS } from "../constants";
import { sendReviewTelemetry } from "./telemetry";
import { applyFindingGates } from "./gate-pipeline";

/**
 * Why a completed review is less than the whole pull request, for the job record the dashboard reads.
 *
 * Files dropped by the limits count as partial too. They used to be reported only in the PR comment,
 * which no longer carries that line, so without this a truncated run reports plain success -- which is
 * how a 250-file pull request reviewed 25 files and said nothing.
 */
export function partialReviewMessage(input: {
  failedFileCount: number;
  reviewedFileCount: number;
  filesOverCap: number;
}): string | null {
  const plural = (n: number) => (n === 1 ? "" : "s");
  const reasons: string[] = [];

  if (input.failedFileCount > 0) {
    reasons.push(
      `${input.failedFileCount} of ${input.reviewedFileCount} file${plural(input.reviewedFileCount)} could not be reviewed`,
    );
  }
  if (input.filesOverCap > 0) {
    reasons.push(
      `${input.filesOverCap} file${plural(input.filesOverCap)} left out by the file and diff-size limits`,
    );
  }

  return reasons.length > 0 ? `Partial review: ${reasons.join("; ")}.` : null;
}

export async function runFinalizePhase(
  env: ReviewRuntime,
  job: PersistedReviewJob,
  leaseOwner: string,
  github: ReviewGitProvider,
  formatter: ReviewFormatter,
  model: ReviewModel,
) {
  await env.jobs.updateJobStep(job.id, "Generating Summary", {
    status: "running",
  });

  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
  const reviewSettings = await env.settings.getReviewSettings();
  const [{ files, skipped: filesOverCap }, initialReviews] = await Promise.all([
    getDiffFiles(env, job, github, config, reviewSettings.maxFiles),
    env.fileReviews.getFileReviewsForJobs([job.id]),
  ]);
  let reviews = initialReviews;

  {
    const reviewedPaths = new Set(reviews.map((r) => r.file_path));
    const missingFiles = files.filter((f) => !reviewedPaths.has(f.path));

    if (missingFiles.length > 0) {
      logger.warn(
        `Job ${job.id} reached finalize phase with ${missingFiles.length} missing file reviews. Forcing them to failed state.`,
      );
      await env.fileReviews.bulkMarkFilesFailed(
        job.id,
        missingFiles.map((file) => ({
          filePath: file.path,
          diffLineCount: file.lineCount,
        })),
        {
          modelUsed: config.model?.main ?? "unconfigured",
          errorMessage:
            "This file was not reviewed before the review run completed.",
        },
      );

      reviews = await env.fileReviews.getFileReviewsForJobs([job.id]);
    } else if (reviews.length < files.length) {
      await env.jobs.updateJobStep(job.id, "Reviewing Files", {
        status: "running",
      });
      await enqueueJobPhase(
        env,
        job.id,
        "review",
        FRESH_INVOCATION_YIELD_SECONDS,
      );
      return;
    }
  }

  await env.jobs.updateJobStep(job.id, "Reviewing Files", { status: "done" });

  const reviewedComments = reviews.flatMap(
    (review) => review.parsed_comments as ParsedReviewComment[],
  );
  const fileSummaries = reviews.map((review) => ({
    path: review.file_path,
    summary:
      review.file_status === "failed"
        ? `Review failed: ${review.error_msg ?? "Unknown file review error"}`
        : (review.file_summary ?? ""),
    verdict:
      review.file_status === "failed"
        ? "failed"
        : (review.verdict ?? "comment"),
  }));

  const { concurrencyLevel, maxComments: globalMaxComments } = reviewSettings;
  const effectiveMaxComments = Math.min(
    config.review.max_comments,
    globalMaxComments,
  );
  const retryCount = job.retryOfJobId ? 1 : 0;

  if (
    fileSummaries.length > 0 &&
    fileSummaries.every((file) => file.verdict === "failed")
  ) {
    await env.jobs.updateJobStep(job.id, "Generating Summary", {
      status: "failed",
      error: "All files failed to review",
    });

    await sendReviewTelemetry(
      env,
      job,
      files,
      reviews,
      { findingsReported: 0, verdict: "failed", severityDistribution: {} },
      { concurrencyLevel, retryCount },
    );

    throw new Error("All files failed to review");
  }

  const hasFailures = fileSummaries.some((file) => file.verdict === "failed");
  const failedFileCount = fileSummaries.filter(
    (file) => file.verdict === "failed",
  ).length;

  await env.jobs.updateJobStep(job.id, "Verifying Findings", {
    status: "running",
  });

  const {
    finalComments,
    dispositions,
    verifyReasons,
    verificationSkipped,
    suppressedComments,
    droppedBySuppression,
    beforeVerifyList,
    droppedByVerification,
    droppedByCap,
    omittedCount,
    droppedByFilters,
    withheldByParser,
    byClaimType,
  } = await applyFindingGates({
    env,
    job,
    config,
    files,
    model,
    effectiveMaxComments,
    reviewedComments,
    reviews,
  });

  logger.info("Finding pipeline outcome", {
    jobId: job.id,
    parsed: reviewedComments.length,
    verificationSkipped,
    droppedByFilters,
    droppedBySuppression,
    droppedByVerification,
    droppedByCap,
    posted: finalComments.length,
    withheldByParser,
    byClaimType,
    byChannel: {
      llm: finalComments.filter((c) => c.source !== "rule").length,
      rule: finalComments.filter((c) => c.source === "rule").length,
    },
    byRule: reviewedComments.reduce<Record<string, number>>((acc, c) => {
      if (c.source === "rule" && c.ruleId)
        acc[c.ruleId] = (acc[c.ruleId] ?? 0) + 1;
      return acc;
    }, {}),
    postedAny: finalComments.length > 0,
    postedPer100Files:
      files.length > 0
        ? Math.round((finalComments.length / files.length) * 1000) / 10
        : 0,
  });

  logger.info("Shadow filter evaluation", {
    jobId: job.id,
    ...shadowEvaluate(beforeVerifyList, finalComments),
  });

  // Failed on every skip reason: each one means findings were posted unverified.
  await env.jobs.updateJobStep(
    job.id,
    "Verifying Findings",
    verificationSkipped
      ? {
          status: "failed",
          error: `Verification did not run (${verificationSkipped}); findings were posted unverified.`,
        }
      : { status: "done" },
  );

  const rawVerdict = formatter.summarizeVerdict(
    [...finalComments, ...suppressedComments],
    hasFailures,
  );

  const everythingWithheld =
    finalComments.length === 0 &&
    suppressedComments.length === 0 &&
    (withheldByParser > 0 || omittedCount > 0);
  const verdictSummary =
    everythingWithheld && rawVerdict.verdict === "approve"
      ? { ...rawVerdict, verdict: "comment" as const }
      : rawVerdict;
  await env.jobs.updateJobStep(job.id, "Generating Summary", {
    status: "done",
  });
  await heartbeatAndCheckSuperseded(env, job.id, leaseOwner);

  const formattedSummary = formatter.formatReviewOverview({
    commitSha: pr.head.sha,
    postedFindings: finalComments.length,
    filesReviewed: files.length,
    linesReviewed: files.reduce((sum, file) => sum + file.lineCount, 0),
    withheldFindings:
      withheldByParser + droppedByFilters + droppedByVerification,
    filesFailed: failedFileCount,
  });

  // Skipped-file counts are dashboard information, not PR content: skips have more than one cause.
  if (filesOverCap > 0) {
    logger.info(
      "Some reviewable files were skipped by the file or diff-size limits",
      {
        jobId: job.id,
        filesOverCap,
        reviewed: files.length,
        maxFiles: reviewSettings.maxFiles,
      },
    );
  }

  const finalizeRetriedPastPost = job.steps.some(
    (step) =>
      step.name === "Completing" &&
      (step.status === "running" || step.status === "done"),
  );
  await env.jobs.updateJobStep(job.id, "Completing", { status: "running" });
  const existingReview: { id: number; postedIndices?: number[] } | null =
    finalizeRetriedPastPost
      ? await github.findBotReviewForCommit(
          job.owner,
          job.repo,
          job.prNumber,
          pr.head.sha,
          env.botUsername,
        )
      : null;
  const review =
    existingReview ??
    (await github.createReview(job.owner, job.repo, job.prNumber, {
      commitSha: pr.head.sha,
      event: formatter.toReviewEvent(verdictSummary.verdict),
      body: formattedSummary,
      comments: finalComments.map((comment) => ({
        path: comment.path,
        line: comment.line ?? undefined,
        side: "RIGHT" as const,
        position: comment.position ?? undefined,
        body: formatter.formatInlineComment(comment),
      })),
    }));

  if (review.postedIndices && review.postedIndices.length > 0) {
    const postedFingerprints = review.postedIndices
      .map((index) => finalComments[index]?.fingerprint)
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint));
    await env.fileReviews.markCommentsPosted(job.id, postedFingerprints);
  }

  // A clean pass also gets a thumbs-up on the pull request's opening post, so the author sees the
  // outcome without opening the review. Best-effort: reacting is decoration, and losing it must never
  // fail a job that already posted its review. GitHub returns the existing reaction on a repeat, so a
  // retried finalize does not duplicate it.
  if (finalComments.length === 0 && github.addIssueReaction) {
    try {
      await github.addIssueReaction(job.owner, job.repo, job.prNumber, "+1");
    } catch (error) {
      logger.warn("Could not react to the pull request", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const withReasons = new Map<
      string,
      { disposition: string | null; reason: string | null }
    >();
    for (const fingerprint of new Set([
      ...dispositions.keys(),
      ...verifyReasons.keys(),
    ])) {
      withReasons.set(fingerprint, {
        disposition: dispositions.get(fingerprint) ?? null,
        reason: verifyReasons.get(fingerprint) ?? null,
      });
    }
    await env.fileReviews.markCommentDispositions(job.id, withReasons);
  } catch (error) {
    logger.warn("Could not record finding dispositions", {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const fileInputTokens = reviews.reduce(
    (sum, review) => sum + (review.input_tokens ?? 0),
    0,
  );
  const fileOutputTokens = reviews.reduce(
    (sum, review) => sum + (review.output_tokens ?? 0),
    0,
  );

  const severityDistribution: Record<string, number> = {};
  for (const comment of finalComments) {
    const sev = comment.severity || "unknown";
    severityDistribution[sev] = (severityDistribution[sev] || 0) + 1;
  }

  const partialErrorMessage = partialReviewMessage({
    failedFileCount: hasFailures ? failedFileCount : 0,
    reviewedFileCount: files.length,
    filesOverCap,
  });
  await env.jobs.completeJob(job.id, {
    verdict: verdictSummary.verdict,
    fileCount: files.length,
    commentCount: finalComments.length,
    totalInputTokens: fileInputTokens,
    totalOutputTokens: fileOutputTokens,
    summaryMarkdown: formattedSummary,
    reviewId: review.id,
    summaryModel: null,
    errorMessage: partialErrorMessage,
  });
  logger.info(
    `Review job completed: ${job.owner}/${job.repo} PR #${job.prNumber}`,
  );

  try {
    if (job.checkRunId) {
      await github.updateCheckRun(job.owner, job.repo, job.checkRunId, {
        status: "completed",
        conclusion: hasFailures
          ? "failure"
          : verdictSummary.verdict === "approve"
            ? "success"
            : "neutral",
        title: hasFailures
          ? "Review partially failed"
          : verdictSummary.verdict === "approve"
            ? "LGTM"
            : "Comments posted",
        summary: `${finalComments.length} inline comments across ${files.length} files.${hasFailures ? ` ${failedFileCount} file${failedFileCount === 1 ? "" : "s"} could not be reviewed.` : ""}`,
      });
      await env.jobs.markJobCheckRunCompleted(job.id);
    }

    if (config.review.labels !== false) {
      const labels = config.review.labels;
      const labelMap = {
        comment: { name: labels.p1, color: "f79009" },
        approve: { name: labels.p2, color: "027a48" },
      } as const;
      const label = labelMap[verdictSummary.verdict];

      await github.removeIssueLabelsIfPresent(
        job.owner,
        job.repo,
        job.prNumber,
        [labels.p1, labels.p2, labels.p3].filter(
          (possibleLabel) => possibleLabel !== label.name,
        ),
      );

      await github.ensureLabel(job.owner, job.repo, label.name, label.color);
      await github.addIssueLabels(job.owner, job.repo, job.prNumber, [
        label.name,
      ]);
    }
  } catch (error) {
    logger.warn(
      `Post-review labels/check-run update failed for job ${job.id}; review is posted and job is completed, so leaving it best-effort`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  await sendReviewTelemetry(
    env,
    job,
    files,
    reviews,
    {
      findingsReported: finalComments.length,
      verdict: verdictSummary.verdict,
      severityDistribution,
    },
    { concurrencyLevel, retryCount },
  );
}
