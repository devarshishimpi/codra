export const feedbackGitHubWebhookEvents = [
  "pull_request_review_comment",
  "pull_request_review_thread",
] as const;

export type FeedbackGitHubWebhookEventName =
  (typeof feedbackGitHubWebhookEvents)[number];

export function isFeedbackGitHubWebhookEvent(
  eventName: string,
): eventName is FeedbackGitHubWebhookEventName {
  return (feedbackGitHubWebhookEvents as readonly string[]).includes(eventName);
}

export type GitHubReviewCommentPayload = {
  id: number;
  body: string | null;
  path?: string | null;
  line?: number | null;
  user?: { login?: string | null } | null;
};

export type PullRequestReviewCommentWebhookPayload = {
  action: "created" | "edited" | "deleted";
  installation?: { id: number };
  repository: { owner: { login: string }; name: string };
  pull_request: { number: number };
  comment: GitHubReviewCommentPayload;
};

export type PullRequestReviewThreadWebhookPayload = {
  action: "resolved" | "unresolved";
  installation?: { id: number };
  repository: { owner: { login: string }; name: string };
  pull_request: { number: number };
  thread: { node_id?: string; comments: GitHubReviewCommentPayload[] };
};

export type FeedbackWebhookPayload =
  | PullRequestReviewCommentWebhookPayload
  | PullRequestReviewThreadWebhookPayload;

export type PullRequestWebhookPayload = {
  action: "opened" | "synchronize" | "ready_for_review" | "reopened" | "closed";
  installation?: { id: number };
  repository: {
    owner: { login: string };
    name: string;
  };
  pull_request: {
    number: number;
    title: string;
    user: { login: string };
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    draft: boolean;
    body: string | null;
  };
};

export type IssueCommentWebhookPayload = {
  action: "created";
  installation?: { id: number };
  repository: {
    owner: { login: string };
    name: string;
  };
  issue: {
    number: number;
    pull_request?: {
      url: string;
    };
  };
  comment: {
    body: string;
  };
};

export type GitHubWebhookPayload =
  | FeedbackWebhookPayload
  | PullRequestWebhookPayload
  | IssueCommentWebhookPayload
  | Record<string, unknown>;
