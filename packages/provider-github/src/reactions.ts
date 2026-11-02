import {
  assertResponseOk,
  type GitHubRequestContext,
  repoApiPath,
  withRetry,
} from "./http";

/**
 * React to the pull request's opening post -- the author's own comment, which is what a reader sees
 * first. `/issues/{n}/reactions` is the right endpoint: a pull request IS an issue for this purpose,
 * and `/pulls/{n}` has no reactions collection.
 *
 * Idempotent by design at GitHub's end: re-reacting with the same content as the same user returns the
 * existing reaction rather than duplicating it, so a retried finalize is safe.
 */
export async function addIssueReaction(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  issueNumber: number,
  content: "+1" | "-1" | "eyes" | "rocket" | "heart",
) {
  return withRetry(
    `addIssueReaction ${owner}/${repo}#${issueNumber} ${content}`,
    async () => {
      const response = await ctx.request(
        `${repoApiPath(owner, repo)}/issues/${issueNumber}/reactions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );

      // 200 = the reaction already existed, 201 = created. Both are success.
      if (response.status === 200 || response.status === 201) return;
      await assertResponseOk(response, String(issueNumber), "GitHub reaction");
    },
  );
}
