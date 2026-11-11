import { describe, it, expect } from "vitest";
import { runWithDb, getDb, type DbClient } from "@codraoss/db/client";
import type { DbEnv } from "@codraoss/db/env";

describe("Node.js connection pool reuse and client lifecycle", () => {
  const dummyEnv: DbEnv = {
    HYPERDRIVE: { connectionString: "postgres://postgres:password@localhost:5432/codra_test" },
    APP_KV: {
      put: async () => {},
      get: async () => null,
      delete: async () => {},
    },
    workerMode: false,
  };

  it("reuses process-level singleton DbClient across runWithDb calls when workerMode is false", () => {
    let client1: DbClient | undefined;
    let client2: DbClient | undefined;

    runWithDb(dummyEnv, () => {
      client1 = getDb(dummyEnv);
    });

    runWithDb(dummyEnv, () => {
      client2 = getDb(dummyEnv);
    });

    expect(client1).toBeDefined();
    expect(client2).toBeDefined();
    expect(client1).toBe(client2);
  });

  it("reuses explicit singleton DbClient passed into runWithDb", () => {
    const explicitClient = getDb(dummyEnv);
    let capturedClient: DbClient | undefined;

    runWithDb(dummyEnv, () => {
      capturedClient = getDb(dummyEnv);
    }, explicitClient);

    expect(capturedClient).toBe(explicitClient);
  });

  it("preserves Cloudflare Workers semantics by creating separate instances when workerMode is not false", () => {
    const workerEnv: DbEnv = {
      HYPERDRIVE: { connectionString: "postgres://postgres:password@localhost:5432/codra_worker_test" },
      APP_KV: dummyEnv.APP_KV,
      workerMode: true,
    };

    let clientA: DbClient | undefined;
    let clientB: DbClient | undefined;

    runWithDb(workerEnv, () => {
      clientA = getDb(workerEnv);
    });

    runWithDb(workerEnv, () => {
      clientB = getDb(workerEnv);
    });

    expect(clientA).toBeDefined();
    expect(clientB).toBeDefined();
    expect(clientA).not.toBe(clientB);
  });

  it("allows graceful close of DbClient", async () => {
    const envToClose: DbEnv = {
      HYPERDRIVE: { connectionString: "postgres://postgres:password@localhost:5432/codra_close_test" },
      APP_KV: dummyEnv.APP_KV,
      workerMode: false,
    };

    const client = getDb(envToClose);
    expect(typeof client.close).toBe("function");
    await expect(client.close?.()).resolves.toBeUndefined();
  });
});
