import { logger } from "@codraoss/core/logger";
import {
  assertResponseOk,
  type GitHubRequestContext,
  repoApiPath,
  withRetry,
} from "./http";
import type { ReviewComment } from "./types";

export function appendDroppedCommentsToSummary(
  summaryBody: string,
  droppedComments: ReviewComment[],
): string {
  if (droppedComments.length === 0) return summaryBody;
  const rows = droppedComments.map((comment) => {
    const file = `\`${comment.path}\``;
    const line =
      typeof comment.line === "number" && comment.line > 0
        ? String(comment.line)
        : typeof comment.position === "number" && comment.position > 0
          ? `pos ${comment.position}`
          : "-";
    const body = comment.body
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, "<br/>");
    return `| ${file} | ${line} | ${body} |`;
  });
  const appendix = [
    "### ⚠️ Comments on Out-of-Diff Lines",
    "",
    "The following comments could not be posted inline (lines outside the pull request diff):",
    "",
    "| File | Line | Finding |",
    "| :--- | :--- | :--- |",
    ...rows,
  ].join("\n");
  const trimmed = summaryBody.trimEnd();
  return trimmed ? `${trimmed}\n\n${appendix}` : appendix;
}

export function parseRejectedCommentIndices(
  errorText: string,
  commentCount: number,
): number[] {
  try {
    const rejected = new Set<number>();
    for (const match of errorText.matchAll(/(?:comments?[.[]|"index":\s*)(\d+)/gi)) {
      const idx = Number.parseInt(match[1], 10);
      if (idx >= 0 && idx < commentCount) rejected.add(idx);
    }
    return Array.from(rejected);
  } catch {
    return [];
  }
}

export async function postReview(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  pullNumber: number,
  input: {
    commitSha: string;
    event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
    body: string;
    comments: ReviewComment[];
  },
) {
  return withRetry(`createReview ${owner}/${repo}#${pullNumber}`, async () => {
    // Address by `line` + `side`, or legacy `position`.
    const mapped = input.comments.map((comment, index) => {
      if (typeof comment.line === "number" && comment.line > 0) {
        return {
          originalIndex: index,
          comment: {
            path: comment.path,
            line: comment.line,
            side: comment.side ?? "RIGHT",
            body: comment.body,
          },
        };
      }
      if (typeof comment.position === "number" && comment.position > 0) {
        return {
          originalIndex: index,
          comment: {
            path: comment.path,
            position: comment.position,
            body: comment.body,
          },
        };
      }
      return null;
    });

    const addressable = mapped.filter(
      (m): m is NonNullable<typeof m> => m !== null,
    );
    let postedIndices = addressable.map((a) => a.originalIndex);
    const comments = addressable.map((a) => a.comment);

    const unaddressable = input.comments.length - addressable.length;
    if (unaddressable > 0) {
      logger.warn("Dropping review comments with no usable line/position", {
        owner,
        repo,
        pullNumber,
        unaddressable,
        total: input.comments.length,
      });
    }

    const reviewPath = `${repoApiPath(owner, repo)}/pulls/${pullNumber}/reviews`;
    let response = await ctx.request(reviewPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commit_id: input.commitSha,
        event: input.event,
        body: input.body,
        comments,
      }),
    });

    if (response.status === 422 && comments.length > 0) {
      const reason = await response
        .clone()
        .text()
        .catch(() => "<unreadable>");
      const rejected = new Set(parseRejectedCommentIndices(reason, comments.length));

      // Attempt to salvage remaining valid comments if specific invalid ones were identified
      if (rejected.size > 0 && rejected.size < addressable.length) {
        const remaining = addressable.filter((_, i) => !rejected.has(i));
        const salvagedIndices = remaining.map((a) => a.originalIndex);
        const dropped = input.comments.filter((_, i) => !salvagedIndices.includes(i));
        const body = appendDroppedCommentsToSummary(input.body, dropped);

        logger.info(
          `GitHub review rejected ${rejected.size} comment(s); retrying with ${remaining.length} salvaged comment(s)`,
          { owner, repo, pullNumber, rejectedCount: rejected.size, salvagedCount: remaining.length },
        );

        response = await ctx.request(reviewPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commit_id: input.commitSha,
            event: input.event,
            body,
            comments: remaining.map((a) => a.comment),
          }),
        });

        if (response.status !== 422) {
          postedIndices = salvagedIndices;
        }
      }

      // If salvage was skipped or still returned 422, drop all inline comments and append to summary
      if (response.status === 422) {
        logger.warn(
          `GitHub review creation failed with 422, retrying without inline comments`,
          {
            owner,
            repo,
            pullNumber,
            droppedComments: input.comments.length,
            reason: reason.slice(0, 500),
          },
        );
        response = await ctx.request(reviewPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commit_id: input.commitSha,
            event: input.event,
            body: appendDroppedCommentsToSummary(input.body, input.comments),
            comments: [],
          }),
        });
        postedIndices = [];
      }
    }

    await assertResponseOk(response, reviewPath, "GitHub review creation");

    const review = (await response.json()) as { id: number };
    return { id: review.id, postedIndices };
  });
}

// Used by finalize to avoid double-posting when an earlier invocation died.
export async function findBotReviewForCommit(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string,
  botLogin: string,
): Promise<{ id: number } | null> {
  return withRetry(
    `findBotReviewForCommit ${owner}/${repo}#${pullNumber}`,
    async () => {
      const response = await ctx.requestAndCheck(
        `${repoApiPath(owner, repo)}/pulls/${pullNumber}/reviews?per_page=100`,
      );
      const reviews = (await response.json()) as Array<{
        id: number;
        commit_id?: string | null;
        user?: { login?: string | null } | null;
      }>;
      const login = botLogin.toLowerCase();
      const botSuffix = `${login}[bot]`;
      const match = reviews.find((review) => {
        if (review.commit_id !== commitSha) return false;
        const userLogin = (review.user?.login ?? "").toLowerCase();
        return userLogin === login || userLogin === botSuffix;
      });
      return match ? { id: match.id } : null;
    },
  );
}
