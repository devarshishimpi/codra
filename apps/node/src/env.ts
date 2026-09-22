import type { SessionStore, IdentityProvider, KeyValueStore, QueueProducer, JobOrchestrator } from '@codraoss/core/ports';
import type { ReviewJobMessage } from '@codraoss/schema';

export interface NodeAppBindings {
  SESSION_STORE: SessionStore;
  IDENTITY_PROVIDER?: IdentityProvider;
  APP_KV: KeyValueStore;
  REVIEW_QUEUE: QueueProducer<ReviewJobMessage>;
  REVIEW_ORCHESTRATOR: JobOrchestrator;

  // â”€â”€ Database â”€â”€
  DATABASE_CONFIG: { connectionString: string };

  // â”€â”€ Environment strings (loaded from process.env via dotenv) â”€â”€
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
}

export function createNodeEnv(stubs: {
  SESSION_STORE: SessionStore;
  APP_KV: KeyValueStore;
  REVIEW_QUEUE: QueueProducer<ReviewJobMessage>;
  REVIEW_ORCHESTRATOR?: JobOrchestrator; // Mark as optional
}): NodeAppBindings {
  const requireEnv = (key: string) => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required environment variable: ${key}`);
    return val;
  };

  return {
    ...stubs,
    REVIEW_ORCHESTRATOR: stubs.REVIEW_ORCHESTRATOR!,
    DATABASE_CONFIG: { connectionString: requireEnv('DATABASE_URL') },
    APP_PRIVATE_KEY: requireEnv('APP_PRIVATE_KEY'),
    GITHUB_APP_ID: requireEnv('GITHUB_APP_ID'),
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
    GITHUB_APP_WEBHOOK_SECRET: requireEnv('GITHUB_APP_WEBHOOK_SECRET'),
    GITHUB_CLIENT_ID: requireEnv('GITHUB_CLIENT_ID'),
    GITHUB_CLIENT_SECRET: requireEnv('GITHUB_CLIENT_SECRET'),
    AUTH_CALLBACK_URL: requireEnv('AUTH_CALLBACK_URL'),
    APP_URL: requireEnv('APP_URL'),
    DASHBOARD_ALLOWED_USERS: process.env.DASHBOARD_ALLOWED_USERS || 'devarshishimpi',
    LLM_CONFIG_ENCRYPTION_KEY: requireEnv('LLM_CONFIG_ENCRYPTION_KEY'),
    BOT_USERNAME: process.env.BOT_USERNAME || 'codra-app',
    ENVIRONMENT: process.env.ENVIRONMENT || 'development',
  };
}



