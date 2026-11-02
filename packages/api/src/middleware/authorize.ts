import type { Context } from "hono";
import type { ApiAction } from "@codraoss/schema/api";
import type { ApiEnv, QuotaCheckInput } from "../ports";

// Guards return a Response to short-circuit with, or null to continue.
// Both are inert when the corresponding port is not provided.

export async function requirePermission(
  c: Context<ApiEnv>,
  action: ApiAction,
  resource?: { type: string; id?: string },
): Promise<Response | null> {
  const authz = c.env.deps.authz;
  if (!authz) return null;

  const user = c.get("sessionUser");
  if (!user) {
    return c.json(
      { error: "Unauthorized", code: "unauthorized", action, reason: null },
      401,
    );
  }

  const result = await authz.authorize({ user, action, resource });
  if (result.allowed) return null;

  return c.json(
    {
      error: "Forbidden",
      code: "forbidden",
      action,
      reason: result.reason ?? null,
    },
    403,
  );
}

export async function requireQuota(
  c: Context<ApiEnv>,
  input: Omit<QuotaCheckInput, "user">,
): Promise<Response | null> {
  const checkQuota = c.env.deps.checkQuota;
  if (!checkQuota) return null;

  const user = c.get("sessionUser") ?? undefined;
  const result = await checkQuota({ ...input, user });
  if (result.allowed) return null;

  const headers = result.retryAfterSeconds
    ? { "Retry-After": String(result.retryAfterSeconds) }
    : undefined;

  return c.json(
    {
      error: "Too many requests",
      code: "quota_exceeded",
      action: input.action,
      reason: result.reason ?? null,
    },
    429,
    headers,
  );
}
