import type {
  DashboardSessionUser,
  SessionStore,
  ReviewRuntime,
} from "@codraoss/core/ports";
import type { ApiAction } from "@codraoss/schema/api";

// Type stubs that represent what the API layer requires.
// By importing types from @codraoss/db, we avoid a runtime dependency while retaining type safety.
import type * as dbAccounts from "@codraoss/db/accounts";
import type * as dbJobs from "@codraoss/db/jobs";
import type * as dbFileReviews from "@codraoss/db/file-reviews";
import type * as dbCommentFeedback from "@codraoss/db/comment-feedback";
import type * as dbModelConfigs from "@codraoss/db/model-configs";
import type * as dbRepoConfigs from "@codraoss/db/repo-configs";
import type * as dbAppSettings from "@codraoss/db/app-settings";
import type * as dbStats from "@codraoss/db/stats";
import type * as dbWebhookDeliveries from "@codraoss/db/webhook-deliveries";

export interface RepositoriesPort {
  accounts: typeof dbAccounts;
  jobs: typeof dbJobs;
  fileReviews: typeof dbFileReviews;
  commentFeedback: typeof dbCommentFeedback;
  modelConfigs: typeof dbModelConfigs;
  repoConfigs: typeof dbRepoConfigs;
  appSettings: typeof dbAppSettings;
  stats: typeof dbStats;
  webhookDeliveries: typeof dbWebhookDeliveries;
}

export interface ConfigPort {
  getGlobalConfig: () => Promise<any>;
  updateGlobalConfig: (config: any) => Promise<void>;
  loadRepoConfig: (input: {
    installationId: string;
    owner: string;
    repo: string;
  }) => Promise<any>;
  invalidateRepoConfigCache: (owner: string, repo: string) => Promise<void>;
}

export interface ModelRunnerPort {
  testConnection: (modelId: string) => Promise<{
    ok: boolean;
    modelUsed: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    degraded?: string;
    warning?: string;
  }>;
  syncProviderModelCatalog: () => Promise<
    Array<{ providerId: string; providerName: string; error: string }>
  >;
  createProviderWithSecret: (input: {
    name: string;
    apiFormat: string;
    baseUrl?: string | null;
    apiKey?: string;
    enabled: boolean;
  }) => Promise<any>;
  updateProviderWithSecret: (
    id: string,
    input: {
      name: string;
      apiFormat: string;
      baseUrl?: string | null;
      apiKey?: string;
      clearApiKey?: boolean;
      enabled: boolean;
    },
  ) => Promise<any>;
}

export interface PlatformPort {
  scheduleBestEffortJobMaintenance: (executionContext?: any) => void;
  createReviewRuntime: () => ReviewRuntime;
  getUpdatesEmailPreference: (githubUserId: number) => Promise<any>;
  syncUpdatesEmail: (
    githubUserId: number,
    email: string | null | undefined,
  ) => Promise<boolean>;
  terminateJobWorkflow: (job: {
    id: string;
    workflowInstanceId?: string | null;
  }) => Promise<void>;
  enqueueReviewJob: (input: {
    jobId: string;
    deliveryId: string;
    phase: string;
    requestId?: string;
  }) => Promise<void>;
  getOrFetchRawDiffForCompletedJob: (
    runtime: ReviewRuntime,
    job: any,
    github: any,
  ) => Promise<string>;
  logger: {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    debug(message: string, data?: unknown): void;
  };
}

export interface AuthProviderPort {
  createOAuthState: () => Promise<string>;
  consumeOAuthState: (state: string) => Promise<boolean>;
  beginAuthorization: (
    callbackUrl: string,
    state: string,
  ) => Promise<{ url: string }>;
  completeAuthorization: (
    code: string,
    state: string,
    expectedState: string,
  ) => Promise<{ identity: any }>;
}

export interface WebhookPort {
  verifySignature: (signature: string | null, body: string) => Promise<boolean>;
  normalizePayload: (eventName: string, payload: any) => any;
  extractReviewRequest: (input: any) => any;
}

export interface AuthorizeContext {
  user: DashboardSessionUser;
  action: ApiAction;
  resource?: { type: string; id?: string };
}

export type AuthorizeResult =
  { allowed: true } | { allowed: false; reason?: string };

export interface AuthzPort {
  authorize(ctx: AuthorizeContext): Promise<AuthorizeResult>;
  // Returning undefined means "no restrictions"; computed per request, not stored on the session.
  listPermissions?(user: DashboardSessionUser): Promise<string[] | undefined>;
}

export interface QuotaCheckInput {
  action: ApiAction;
  // Absent on the webhook path, which runs without a signed-in user.
  user?: DashboardSessionUser;
  subject?: { installationId?: string; owner?: string; repo?: string };
  cost?: number;
}

export type QuotaResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds?: number; reason?: string };

export interface ApiRouterDeps {
  repositories: RepositoriesPort;
  gitProvider: {
    getAppInstallationUrl: () => Promise<string>;
    listInstallations: () => Promise<any[]>;
    createService: (installationId?: number | string | null) => any;
  };
  config: ConfigPort;
  modelRunner: ModelRunnerPort;
  sessionStore: SessionStore;
  platform: PlatformPort;
  authProvider: AuthProviderPort;
  webhook: WebhookPort;
  authz?: AuthzPort;
  checkQuota?: (input: QuotaCheckInput) => Promise<QuotaResult>;
}

export interface ApiEnv {
  Bindings: {
    deps: ApiRouterDeps;
    APP_URL: string;
    ENVIRONMENT: string;
    AUTH_CALLBACK_URL: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_APP_SLUG?: string;
    DASHBOARD_ALLOWED_USERS: string;
    BOT_USERNAME: string;
  };
  Variables: {
    sessionToken: string | null;
    sessionUser: DashboardSessionUser | null;
    requestId: string;
  };
}
