import type { KeyValueStore } from '@codraoss/core';

export class CloudflareKV implements KeyValueStore {
  constructor(private readonly kv: KVNamespace) {}

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    await this.kv.put(key, value, options);
  }

  async get(key: string, type?: 'json' | 'text'): Promise<any> {
    if (type === 'json') {
      return this.kv.get(key, 'json');
    }
    return this.kv.get(key, 'text');
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}
