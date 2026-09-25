import { logger } from "@codraoss/core/logger";
import {
  assertResponseOk,
  type GitHubRequestContext,
  repoApiPath,
  withRetry,
} from "./http";
import type { ReviewComment } from "./types";

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
    const mapped = input.comments.map((comment) => {
      if (typeof comment.line === "number" && comment.line > 0) {
        return {
          path: comment.path,
          line: comment.line,
          side: comment.side ?? "RIGHT",
          body: comment.body,
        };
      }
      if (typeof comment.position === "number" && comment.position > 0) {
        return {
          path: comment.path,
          position: comment.position,
          body: comment.body,
        };
      }
      return null;
    });

    // Which of the caller's comments survived mapping; marking a dropped one "posted" would suppress it on every future commit unseen.
    let postedIndices = mapped.flatMap((c, index) =>
      c === null ? [] : [index],
    );

    const comments = mapped.filter(
      (c): c is NonNullable<typeof c> => c !== null,
    );
    const unaddressable = mapped.length - comments.length;
    if (unaddressable > 0) {
      logger.warn("Dropping review comments with no usable line/position", {
        owner,
        repo,
        pullNumber,
        unaddressable,
        total: mapped.length,
      });
    }

    const body = {
      commit_id: input.commitSha,
      event: input.event,
      body: input.body,
      comments,
    };

    const reviewPath = `${repoApiPath(owner, repo)}/pulls/${pullNumber}/reviews`;
    let response = await ctx.request(reviewPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 422 && body.comments.length > 0) {
      // A 422 here almost always means a comment pointed at a line outside the diff; log the response text or this failure is invisible.
      const reason = await response
        .clone()
        .text()
        .catch(() => "<unreadable>");
      logger.warn(
        `GitHub review creation failed with 422, retrying without inline comments`,
        {
          owner,
          repo,
          pullNumber,
          droppedComments: body.comments.length,
          reason: reason.slice(0, 500),
        },
      );
      response = await ctx.request(reviewPath, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          commit_id: input.commitSha,
          event: input.event,
          body: input.body,
          comments: [],
        }),
      });
      postedIndices = []; // Summary posts, but no inline comments.
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
      const match = reviews.find(
        (review) =>
          review.commit_id === commitSha &&
          (review.user?.login ?? "").toLowerCase().startsWith(login),
      );
      return match ? { id: match.id } : null;
    },
  );
}
