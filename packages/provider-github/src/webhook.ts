import type {
  WebhookPayload,
  WebhookEventName,
} from "@codraoss/schema/webhook";
import type {
  PullRequestWebhookPayload,
  IssueCommentWebhookPayload,
} from "@codraoss/schema/github";

export function normalizeGitHubWebhook(
  eventName: string,
  payload: unknown,
): { eventName: WebhookEventName; payload: WebhookPayload } | null {
  if (eventName === "pull_request") {
    const prPayload = payload as PullRequestWebhookPayload;
    return {
      eventName: "change_request",
      payload: {
        action: prPayload.action,
        installationId: String(prPayload.installation?.id ?? ""),
        repository: {
          owner: prPayload.repository.owner.login,
          name: prPayload.repository.name,
        },
        changeRequest: {
          number: prPayload.pull_request.number,
          title: prPayload.pull_request.title,
          author: prPayload.pull_request.user.login,
          head: {
            sha: prPayload.pull_request.head.sha,
            ref: prPayload.pull_request.head.ref,
          },
          base: {
            sha: prPayload.pull_request.base.sha,
            ref: prPayload.pull_request.base.ref,
          },
          draft: prPayload.pull_request.draft,
          body: prPayload.pull_request.body,
        },
      },
    };
  }

  if (eventName === "issue_comment") {
    const icPayload = payload as IssueCommentWebhookPayload;
    return {
      eventName: "comment",
      payload: {
        action: icPayload.action,
        installationId: String(icPayload.installation?.id ?? ""),
        repository: {
          owner: icPayload.repository.owner.login,
          name: icPayload.repository.name,
        },
        issue: {
          number: icPayload.issue.number,
          isChangeRequest: !!icPayload.issue.pull_request,
        },
        comment: {
          body: icPayload.comment.body,
        },
      },
    };
  }

  return null;
}
