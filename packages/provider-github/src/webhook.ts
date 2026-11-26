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
  if (eventName === "pull_request" || eventName === "change_request") {
    const raw = payload as any;
    if (raw && "changeRequest" in raw) {
      return { eventName: "change_request", payload: raw as WebhookPayload };
    }
    const prPayload = payload as PullRequestWebhookPayload;
    if (prPayload && prPayload.pull_request) {
      return {
        eventName: "change_request",
        payload: {
          action: prPayload.action,
          installationId: String(
            prPayload.installation?.id ?? (prPayload as any).installationId ?? "",
          ),
          repository: {
            owner:
              typeof prPayload.repository?.owner === "string"
                ? prPayload.repository.owner
                : prPayload.repository?.owner?.login ?? "",
            name: prPayload.repository?.name ?? "",
          },
          changeRequest: {
            number: prPayload.pull_request.number,
            title: prPayload.pull_request.title,
            author: prPayload.pull_request.user?.login ?? "",
            head: {
              sha: prPayload.pull_request.head?.sha ?? "",
              ref: prPayload.pull_request.head?.ref ?? "",
            },
            base: {
              sha: prPayload.pull_request.base?.sha ?? "",
              ref: prPayload.pull_request.base?.ref ?? "",
            },
            draft: Boolean(prPayload.pull_request.draft),
            body: prPayload.pull_request.body ?? null,
          },
        },
      };
    }
  }

  if (eventName === "issue_comment" || eventName === "comment") {
    const raw = payload as any;
    if (raw && "issue" in raw && "isChangeRequest" in raw.issue) {
      return { eventName: "comment", payload: raw as WebhookPayload };
    }
    const icPayload = payload as IssueCommentWebhookPayload;
    if (icPayload && icPayload.comment && icPayload.issue) {
      return {
        eventName: "comment",
        payload: {
          action: icPayload.action,
          installationId: String(
            icPayload.installation?.id ?? (icPayload as any).installationId ?? "",
          ),
          repository: {
            owner:
              typeof icPayload.repository?.owner === "string"
                ? icPayload.repository.owner
                : icPayload.repository?.owner?.login ?? "",
            name: icPayload.repository?.name ?? "",
          },
          issue: {
            number: icPayload.issue.number,
            isChangeRequest: !!icPayload.issue.pull_request,
          },
          comment: {
            body: icPayload.comment.body ?? "",
          },
        },
      };
    }
  }

  return null;
}
