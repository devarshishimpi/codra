import { Hono } from "hono";
import type { ApiEnv } from "../ports";
import { createSession, destroySession } from "../sessions";

function redirectToLogin(reason: string) {
  const params = new URLSearchParams({ error: reason });
  return `/login?${params.toString()}`;
}

export function parseAllowedUsers(input: string) {
  return new Set(
    input
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function createAuthRouter() {
  const app = new Hono<ApiEnv>();

  app.get("/github", async (c) => {
    const state = await c.env.deps.authProvider.createOAuthState();
    const result = await c.env.deps.authProvider.beginAuthorization(
      c.env.AUTH_CALLBACK_URL,
      state,
    );
    return c.redirect(result.url, 302);
  });

  app.get("/github/callback", async (c) => {
    const error = c.req.query("error");
    if (error) {
      return c.redirect(redirectToLogin(error), 302);
    }

    const code = c.req.query("code")?.trim();
    const state = c.req.query("state")?.trim();
    if (!code || !state) {
      return c.redirect(redirectToLogin("invalid_callback"), 302);
    }

    const stateMatches = await c.env.deps.authProvider.consumeOAuthState(state);
    if (!stateMatches) {
      return c.redirect(redirectToLogin("invalid_state"), 302);
    }

    try {
      const { identity } = await c.env.deps.authProvider.completeAuthorization(
        code,
        state,
        state,
      );
      const allowedUsers = parseAllowedUsers(c.env.DASHBOARD_ALLOWED_USERS);

      if (!allowedUsers.has(identity.login.toLowerCase())) {
        return c.redirect(redirectToLogin("not_allowed"), 302);
      }

      await destroySession(c);
      await createSession(c, identity);

      // Best-effort: a DB hiccup must not block sign-in (the account page self-heals on next load).
      try {
        await c.env.deps.repositories.accounts.upsertAccountSettings(
          c.env as any,
          {
            githubUserId: Number(identity.providerUserId),
            githubUsername: identity.login,
            accountName: identity.name,
            accountEmail: identity.email,
          },
        );
      } catch (err) {
        c.env.deps.platform.logger.warn(
          "Failed to persist account settings on sign-in",
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }

      return c.redirect("/dashboard", 302);
    } catch {
      return c.redirect(redirectToLogin("oauth_failed"), 302);
    }
  });

  app.post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  });

  return app;
}
