import type { KeyValueStore } from "./kv";
import type { QueueProducer } from "./queue";
import type { JobOrchestrator } from "./orchestrator";
import type { SessionStore, DashboardSessionUser } from "./session-store";
import type { ReviewJobMessage } from "@codraoss/schema";

export class InMemoryKV implements KeyValueStore {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    const expiresAt = options?.expirationTtl
      ? Date.now() + options.expirationTtl * 1000
      : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async get(key: string, type?: "json" | "text"): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    if (type === "json") {
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }
    return entry.value;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export class InMemoryQueue<T> implements QueueProducer<T> {
  public messages: Array<{ message: T; delaySeconds?: number }> = [];

  async send(message: T, options?: { delaySeconds?: number }): Promise<void> {
    this.messages.push({ message, delaySeconds: options?.delaySeconds });
  }
}

export class InMemoryOrchestrator implements JobOrchestrator {
  public jobs: Map<string, ReviewJobMessage> = new Map();

  async startReviewJob(id: string, params: ReviewJobMessage): Promise<void> {
    this.jobs.set(id, params);
  }
}

export class InMemorySessionStore implements SessionStore {
  private kv = new InMemoryKV();

  async createSession(session: DashboardSessionUser): Promise<string> {
    const token = Math.random().toString(36).substring(2);
    await this.kv.put(`session:${token}`, JSON.stringify(session), {
      expirationTtl: 60 * 60 * 24 * 7,
    });
    return token;
  }

  async readSession(token: string): Promise<DashboardSessionUser | null> {
    return this.kv.get(`session:${token}`, "json");
  }

  async destroySession(token: string): Promise<void> {
    await this.kv.delete(`session:${token}`);
  }

  async renewSession(token: string): Promise<void> {
    const session = await this.readSession(token);
    if (session) {
      await this.kv.put(`session:${token}`, JSON.stringify(session), {
        expirationTtl: 60 * 60 * 24 * 7,
      });
    }
  }
}
