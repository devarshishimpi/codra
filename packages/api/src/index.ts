export { createApiRouter } from "./router";
export type { ApiRouterOptions } from "./router";
export type {
  ApiRouterDeps,
  ApiEnv,
  RepositoriesPort,
  ConfigPort,
  PlatformPort,
  AuthzPort,
  AuthorizeContext,
  AuthorizeResult,
  QuotaCheckInput,
  QuotaResult,
} from "./ports";
// Exported so an app embedding this router can reuse the same guards on its own routes.
export { requirePermission, requireQuota } from "./middleware/authorize";
export { requireSession } from "./middleware/auth";
export { requireCsrfHeader } from "./middleware/csrf";

export * from "./create-deps";
