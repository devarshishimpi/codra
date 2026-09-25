import type { DashboardSessionUser, SessionStore } from "@codraoss/core";

export class CloudflareSessionStore implements SessionStore {
  constructor(private readonly kv: KVNamespace) {}

  private sessionKey(token: string) {
    return `session:${token}`;
  }

  async createSession(session: DashboardSessionUser): Promise<string> {
    const token = crypto.randomUUID();
    await this.kv.put(this.sessionKey(token), JSON.stringify(session), {
      expirationTtl: 60 * 60 * 24 * 7,
    });
    return token;
  }

  async readSession(token: string): Promise<DashboardSessionUser | null> {
    const raw = await this.kv.get(this.sessionKey(token), "json");
    if (!raw) return null;

    const session = raw as any;
    if (session.githubUserId && !session.provider) {
      // Backward compatibility: adapt old GitHub sessions to the new provider-neutral shape.
      return {
        provider: "github",
        providerUserId: session.githubUserId.toString(),
        login: session.login,
        name: session.name,
        avatarUrl: session.avatarUrl,
        email: session.email,
        signedInAt: session.signedInAt,
        metadata: {
          githubUserId: session.githubUserId,
          githubUsername: session.login,
        },
      };
    }

    return session as DashboardSessionUser;
  }

  async destroySession(token: string): Promise<void> {
    await this.kv.delete(this.sessionKey(token));
  }

  async renewSession(token: string): Promise<void> {
    const session = await this.readSession(token);
    if (session) {
      await this.kv.put(this.sessionKey(token), JSON.stringify(session), {
        expirationTtl: 60 * 60 * 24 * 7,
      });
    }
  }
}
