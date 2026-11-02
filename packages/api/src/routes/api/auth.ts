import { isSupportedTimeZone } from "@codraoss/schema/timezone";
import { Hono } from "hono";
import { z } from "zod";
import { jsonError } from "../../http";
import type { ApiEnv } from "../../ports";
import { requirePermission } from "../../middleware/authorize";

const emailSchema = z.strictObject({
  email: z.string().trim().email().max(254),
});

// Fields are independently optional (at least one required); timezone null means "follow the browser", else must be an Intl-known zone.
const accountUpdateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isSupportedTimeZone, {
        message: "Unknown time zone.",
      })
      .nullable()
      .optional(),
  })
  .refine((body) => body.name !== undefined || body.timezone !== undefined, {
    message: "Nothing to update.",
  });

export function createAuthApiRouter() {
  const app = new Hono<ApiEnv>();

  app.get("/session", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Omitted when nothing is restricted, which the dashboard reads as "every action allowed".
    const permissions = await c.env.deps.authz?.listPermissions?.(sessionUser);

    return c.json(
      permissions ? { user: sessionUser, permissions } : { user: sessionUser },
    );
  });

  app.get("/account", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accounts = c.env.deps.repositories.accounts;
    const githubUserId = Number(sessionUser.providerUserId);

    // Self-heals for sessions created before the account_settings table existed.
    let account = await accounts.getAccountSettings(c.env as any, githubUserId);
    if (!account) {
      account = await accounts.upsertAccountSettings(c.env as any, {
        githubUserId,
        githubUsername: sessionUser.login,
        accountName: sessionUser.name,
        accountEmail: sessionUser.email,
      });
    }

    return c.json({ account });
  });

  app.patch("/account", async (c) => {
    const denied = await requirePermission(c, "account.write");
    if (denied) return denied;
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await c.req.json().catch(() => null);
    const parsed = accountUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message;
      return jsonError(
        issue && issue !== "Invalid input"
          ? issue
          : "Enter a name (1-120 characters).",
        400,
      );
    }

    const accounts = c.env.deps.repositories.accounts;
    const githubUserId = Number(sessionUser.providerUserId);

    // Ensure a row exists first (self-heal for pre-existing sessions), then update.
    const existing = await accounts.getAccountSettings(
      c.env as any,
      githubUserId,
    );
    if (!existing) {
      await accounts.upsertAccountSettings(c.env as any, {
        githubUserId,
        githubUsername: sessionUser.login,
        accountName: sessionUser.name,
        accountEmail: sessionUser.email,
      });
    }

    const account = await accounts.updateAccountSettings(
      c.env as any,
      githubUserId,
      {
        accountName: parsed.data.name,
        timezone: parsed.data.timezone,
      },
    );
    return c.json({ account });
  });

  app.get("/updates-email", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const githubUserId = Number(sessionUser.providerUserId);
    const preference =
      await c.env.deps.platform.getUpdatesEmailPreference(githubUserId);
    return c.json({
      status: preference?.status ?? "pending",
      email: preference?.email ?? null,
      updatedAt: preference?.updatedAt ?? null,
    });
  });

  app.post("/updates-email", async (c) => {
    const denied = await requirePermission(c, "account.updatesEmail.write");
    if (denied) return denied;
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await c.req.json().catch(() => null);
    const parsed = emailSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Enter a valid email address.", 400);
    }

    const platform = c.env.deps.platform;
    const githubUserId = Number(sessionUser.providerUserId);

    const existingPreference =
      await platform.getUpdatesEmailPreference(githubUserId);
    if (existingPreference) {
      return c.json({
        status: existingPreference.status,
        email: existingPreference.email,
        updatedAt: existingPreference.updatedAt,
      });
    }

    const synced = await platform.syncUpdatesEmail(
      githubUserId,
      parsed.data.email,
    );
    if (!synced) {
      return jsonError("Could not save updates email right now.", 502);
    }

    const preference = await platform.getUpdatesEmailPreference(githubUserId);

    return c.json({
      status: preference?.status ?? "pending",
      email: preference?.email ?? null,
      updatedAt: preference?.updatedAt ?? null,
    });
  });

  return app;
}
