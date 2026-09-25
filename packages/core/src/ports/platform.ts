export interface KvStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  randomUUID(): string;
}

export interface SecretStore {
  getSecret(key: string): Promise<string | null>;
}

export type { Logger } from "../logger";
