export type WebhookEventName = "change_request" | "comment";

export type ChangeRequestWebhookPayload = {
  action: "opened" | "synchronize" | "ready_for_review" | "reopened" | "closed";
  installationId: string;
  repository: { owner: string; name: string };
  changeRequest: {
    number: number;
    title: string;
    author: string;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    draft: boolean;
    body: string | null;
  };
};

export type CommentWebhookPayload = {
  action: "created";
  installationId: string;
  repository: { owner: string; name: string };
  issue: { number: number; isChangeRequest: boolean };
  comment: { body: string };
};

export type WebhookPayload =
  ChangeRequestWebhookPayload | CommentWebhookPayload;
