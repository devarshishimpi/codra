import type { KeyValueStore } from "@codraoss/core/ports";
import type { Redis } from "ioredis";

export class RedisKVAdapter implements KeyValueStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string, type?: "json" | "text"): Promise<any> {
    const value = await this.redis.get(key);
    if (value === null) {
      return null;
    }

    if (type === "json") {
      try {
        return JSON.parse(value);
      } catch (err) {
        return null;
      }
    }

    return value;
  }

  async put(
    key: string,
    value: any,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);

    if (options?.expirationTtl) {
      // expirationTtl from Cloudflare KV is in seconds, EX parameter in Redis is also seconds
      await this.redis.set(key, stringValue, "EX", options.expirationTtl);
    } else {
      await this.redis.set(key, stringValue);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
