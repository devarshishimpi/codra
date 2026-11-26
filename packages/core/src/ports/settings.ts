import type { ClaimType, RepoConfig, ReviewSettings } from "@codraoss/schema";
import type {
  WebhookEventName,
  WebhookPayload,
} from "@codraoss/schema/webhook";

export interface ReviewSettingsReader {
  getReviewSettings(): Promise<ReviewSettings>;
}

export interface RepoConfigLoader {
  loadRepoConfig(input: {
    installationId: string;
    owner: string;
    repo: string;
  }): Promise<{ parsedJson: RepoConfig; enabled: boolean }>;
}

export interface ModelConfigReader {
  getResolvedModelConfig(
    modelId: string,
  ): Promise<{ providerName: string } | null>;
}

export interface WebhookDeliveryReader {
  getWebhookDelivery(
    deliveryId: string,
  ): Promise<{
    delivery_id: string;
    event_name: string;
    payload: unknown;
  } | null>;
  normalizePayload?(
    eventName: string,
    payload: unknown,
  ): { eventName: WebhookEventName; payload: WebhookPayload } | null;
}

export interface LearningStore {
  getRepositoryIdForJob(jobId: string): Promise<number | null>;
  getRejectedExemplars(input: {
    repositoryId: number;
    claimTypes?: readonly ClaimType[];
    limit?: number;
  }): Promise<
    Array<{
      title: string;
      body: string;
      claim_type: ClaimType | null;
      context_snippet: string | null;
      path: string;
    }>
  >;
}
