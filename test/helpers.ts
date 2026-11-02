import { describe } from "vitest";
import type { AppBindings } from "@server/env";
import { InMemorySessionStore } from "@codraoss/core";
import { encryptLlmApiKey, ModelRunner } from "@codraoss/models";
import { queryRows } from "@codraoss/db/client";
import { getResolvedModelConfig } from "@codraoss/db/model-configs";
import type { TokenTracker } from "@codraoss/core/token-tracker";
import { createApiRouterDeps } from "../apps/worker/src/api-deps";
import type { ApiRouterDeps } from "@codraoss/api";

export class MemoryKV {
  private readonly store = new Map<string, string>();

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async get(key: string, type?: "text" | "json" | Partial<any>) {
    const value = this.store.get(key) ?? null;
    if (value === null) return null;
    if (type === "json") {
      return JSON.parse(value);
    }
    return value;
  }

  async getWithMetadata(key: string, type?: "text" | "json" | Partial<any>) {
    return {
      value: await this.get(key, type as "text" | "json"),
      metadata: null,
      cacheStatus: null,
    } as any;
  }

  async list() {
    return {
      keys: Array.from(this.store.keys()).map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    } as any;
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

export class MockAssets {
  private readonly self = "mock-assets";

  async fetch(input: RequestInfo | URL) {
    if (this?.self !== "mock-assets") {
      throw new TypeError(
        "Illegal invocation: function called with incorrect `this` reference.",
      );
    }
    const request = input instanceof Request ? input : new Request(input);
    const pathname = new URL(request.url).pathname;

    if (pathname === "/index.html" || pathname.endsWith("/index.html")) {
      return new Response(null, {
        status: 307,
        headers: { location: pathname.slice(0, -"index.html".length) || "/" },
      });
    }

    return new Response(`<html><body>${pathname}</body></html>`, {
      headers: { "content-type": "text/html" },
    });
  }
}

export class MockQueue {
  public readonly sent: any[] = [];

  async send(message: any, options?: { delaySeconds?: number }) {
    this.sent.push({ ...message, options });
  }
}

export class MockWorkflow {
  public readonly created: any[] = [];
  public readonly terminated: string[] = [];

  async create(opts: any) {
    this.created.push(opts);
  }

  async get(id: string) {
    return {
      terminate: async () => {
        this.terminated.push(id);
      },
    };
  }
}

function usableEnvValue(value: string | undefined) {
  return value && value !== "undefined" && value !== "null" ? value : null;
}

function requiredEnv(key: keyof NodeJS.ProcessEnv) {
  const value = usableEnvValue(process.env[key]);
  if (!value) {
    throw new Error(`Missing required test environment variable: ${key}`);
  }
  return value;
}

function _unusedEnv(key: string): string {
  throw new Error(
    `${key} is not required by the current test suite. Add it to the test env only when a test exercises that path.`,
  );
}

export function getTestDatabaseUrl() {
  return requiredEnv("TEST_DATABASE_URL");
}

export function hasConfiguredTestDatabaseUrl() {
  return Boolean(usableEnvValue(process.env.TEST_DATABASE_URL));
}

import { FakeIdentityProvider } from "../packages/core/test/fakes/identity-provider";

export function createTestEnv(
  overrides: Partial<AppBindings> = {},
  depsOverrides: Partial<ApiRouterDeps> = {},
): AppBindings {
  const env = {
    AI: {
      async run() {
        return {
          response:
            '{"findings":[],"file_verdict":"approve","file_summary":"ok"}',
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        };
      },
    },
    APP_KV: new MemoryKV() as unknown as any,
    SESSION_STORE: new InMemorySessionStore(),
    IDENTITY_PROVIDER: new FakeIdentityProvider(),
    REVIEW_QUEUE: new MockQueue() as any,
    REVIEW_WORKFLOW: new MockWorkflow() as any,
    ASSETS: new MockAssets() as any,
    HYPERDRIVE: {
      connectionString: getTestDatabaseUrl(),
    },
    APP_PRIVATE_KEY: "private_key",
    GITHUB_APP_ID: "app_id",
    GITHUB_APP_SLUG: requiredEnv("GITHUB_APP_SLUG"),
    GITHUB_APP_WEBHOOK_SECRET: requiredEnv("GITHUB_APP_WEBHOOK_SECRET"),
    GITHUB_CLIENT_ID: requiredEnv("GITHUB_CLIENT_ID"),
    GITHUB_CLIENT_SECRET: requiredEnv("GITHUB_CLIENT_SECRET"),
    AUTH_CALLBACK_URL: requiredEnv("AUTH_CALLBACK_URL"),
    APP_URL: requiredEnv("APP_URL"),
    DASHBOARD_ALLOWED_USERS: requiredEnv("DASHBOARD_ALLOWED_USERS"),
    LLM_CONFIG_ENCRYPTION_KEY: "test-llm-config-encryption-key",
    BOT_USERNAME: requiredEnv("BOT_USERNAME"),
    ENVIRONMENT: "test",

    ...overrides,
  } as AppBindings;
  (env as any).deps = Object.assign(
    createApiRouterDeps(env, {} as any),
    depsOverrides,
  );
  return env;
}

export function createTestModelRunner(
  env: AppBindings,
  tracker?: TokenTracker,
  opts: { jobId?: string } = {},
) {
  return new ModelRunner({
    kv: env.APP_KV as any,
    secretStore: {
      getSecret: async (k: string) => ((env as any)[k] as string) || null,
    },
    getConfig: async (id: string) => getResolvedModelConfig(env as any, id),
    aiBinding: env.AI,
    tracker,
    jobId: opts.jobId,
  });
}

// ensureModelCatalog seeds only Cloudflare models, so these Gemini fixtures must be created here or a fresh CI database fails.
const GOOGLE_TEST_MODEL_IDS = [
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite",
];

export async function saveTestProviderApiKey(
  env: AppBindings,
  providerName = "Google",
  apiKey = "test-key",
) {
  const encrypted = await encryptLlmApiKey(
    {
      getSecret: async (key) =>
        (env[key as keyof AppBindings] as string) || null,
    },
    apiKey,
  );
  await queryRows(
    env,
    `
    UPDATE llm_providers
    SET encrypted_api_key = $1, enabled = TRUE, updated_at = now()
    WHERE name = $2
    `,
    [encrypted, providerName],
  );

  if (providerName === "Google") {
    for (const modelId of GOOGLE_TEST_MODEL_IDS) {
      await queryRows(
        env,
        `
        INSERT INTO model_configs (model_id, provider, provider_id, model_name, updated_at)
        SELECT $1, 'gemini', p.id, $1, now()
        FROM llm_providers p
        WHERE p.name = 'Google'
        ON CONFLICT (model_id) DO UPDATE SET
          provider = EXCLUDED.provider,
          provider_id = EXCLUDED.provider_id,
          model_name = EXCLUDED.model_name,
          updated_at = now()
        `,
        [modelId],
      );
    }
  }
}

export function generateMockDiff(
  files: { path: string; content: string }[],
): string {
  return files
    .map((f) => {
      const lines = f.content.split("\n");
      return `diff --git a/${f.path} b/${f.path}
index 1234567..890abcd 100644
--- a/${f.path}
+++ b/${f.path}
@@ -1,${lines.length} +1,${lines.length} @@
${lines.map((l) => `+${l}`).join("\n")}`;
    })
    .join("\n");
}

export function createMockPRWebhook(overrides: any = {}) {
  return {
    action: "opened",
    installation: { id: 12345 },
    repository: {
      name: "test-repo",
      owner: { login: "test-owner" },
    },
    pull_request: {
      number: 1,
      title: "Initial PR",
      body: "Testing PR body",
      user: { login: "dev-author" },
      head: { sha: "headsha", ref: "feature" },
      base: { sha: "basesha", ref: "main" },
      draft: false,
    },
    ...overrides,
  };
}

export const sha = (seed: string) => seed.repeat(40).slice(0, 40);

export const dbDescribe = hasConfiguredTestDatabaseUrl()
  ? describe
  : describe.skip;

let nameSeq = 0;
export function uniqueName(prefix: string) {
  nameSeq += 1;
  const salt = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${salt}-${nameSeq}`;
}

export const uniqueRepo = (label: string) => uniqueName(`test-repo-${label}`);
