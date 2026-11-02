export type DbEnv = {
  workerMode?: boolean;
  HYPERDRIVE: { connectionString: string };
  APP_KV: {
    put(
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ): Promise<void>;
    get(key: string): Promise<string | null>;
    delete(key: string): Promise<void>;
  };
};
