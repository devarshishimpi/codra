export interface KvCompat {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  get(key: string, type: 'json'): Promise<unknown>;
  get(key: string, type?: 'text'): Promise<string | null>;
  delete(key: string): Promise<void>;
}



