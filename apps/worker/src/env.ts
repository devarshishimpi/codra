import type { ReviewJobMessage } from "@codraoss/schema";
import type {
  DashboardSessionUser,
  SessionStore,
  IdentityProvider,
} from "@codraoss/core";

export type { DashboardSessionUser };

export interface WorkersAiBinding {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<any>;
}

export interface QueueProducer<T> {
  send(message: T, options?: { delaySeconds?: number }): Promise<void>;
}

export interface AssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface HyperdriveBinding {
  connectionString: string;
}

export interface AppBindings {
  SESSION_STORE: SessionStore;
  IDENTITY_PROVIDER: IdentityProvider;
  AI: WorkersAiBinding;
  APP_KV: KVNamespace;
  REVIEW_QUEUE: QueueProducer<ReviewJobMessage>;
  REVIEW_WORKFLOW: Workflow;
  ASSETS: AssetsBinding;
  HYPERDRIVE: HyperdriveBinding;
  APP_PRIVATE_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_WEBHOOK_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  AUTH_CALLBACK_URL: string;
  APP_URL: string;
  DASHBOARD_ALLOWED_USERS: string;
  LLM_CONFIG_ENCRYPTION_KEY: string;
  BOT_USERNAME: string;
  ENVIRONMENT: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
}

export interface AppVariables {
  sessionToken: string | null;
  sessionUser: DashboardSessionUser | null;
  requestId: string;
}

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
