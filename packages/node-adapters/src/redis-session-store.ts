import type { DashboardSessionUser, SessionStore } from '@codraoss/core/ports';
import type Redis from 'ioredis';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 21);

export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: Redis) {}

  private sessionKey(id: string): string {
    return `session:${id}`;
  }

  async createSession(session: DashboardSessionUser): Promise<string> {
    const id = nanoid();
    await this.redis.setex(this.sessionKey(id), 60 * 60 * 24 * 7, JSON.stringify(session)); // 7 days expiration
    return id;
  }

  async readSession(token: string): Promise<DashboardSessionUser | null> {
    const sessionString = await this.redis.get(this.sessionKey(token));
    if (!sessionString) {
      return null;
    }
    try {
      return JSON.parse(sessionString) as DashboardSessionUser;
    } catch {
      // Return null if parsing fails (corrupted JSON)
      return null;
    }
  }

  async destroySession(token: string): Promise<void> {
    await this.redis.del(this.sessionKey(token));
  }

  async renewSession(token: string): Promise<void> {
    // Renew by extending the expiration, if it exists
    await this.redis.expire(this.sessionKey(token), 60 * 60 * 24 * 7); // 7 days expiration
  }
}
