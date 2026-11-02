import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppEnv, DashboardSessionUser } from "../env";

const SESSION_COOKIE_NAME = "codra_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type SessionRecord = DashboardSessionUser;

export async function createSession(
  c: Context<AppEnv>,
  session: SessionRecord,
) {
  const token = await c.env.SESSION_STORE.createSession(session);

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  c.set("sessionToken", token);
  c.set("sessionUser", session);

  return token;
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (token) {
    await c.env.SESSION_STORE.destroySession(token);
  }

  c.set("sessionToken", null);
  c.set("sessionUser", null);

  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: "/",
  });
}

export async function readSession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE_NAME) ?? null;
  c.set("sessionToken", token);

  if (!token) {
    c.set("sessionUser", null);
    return null;
  }

  const session = await c.env.SESSION_STORE.readSession(token);
  c.set("sessionUser", session);
  return session;
}
