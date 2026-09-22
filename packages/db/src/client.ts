import type { DbEnv } from './env';
import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';

type DbClient = {
  query<T>(sqlText: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
};

const dbStorage = new AsyncLocalStorage<DbClient>();

function createDbClient(env: DbEnv): DbClient {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE, 10) : 5,
    fetch_types: false,
    prepare: false,
    onnotice: () => {},
    ssl: env.HYPERDRIVE.connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  return {
    async query<T>(sqlText: string, params: unknown[] = []) {
      return (await sql.unsafe(sqlText, params.map(normalizeParam) as any[], { prepare: false })) as T[];
    },
    async transaction<T>(fn: (tx: DbClient) => Promise<T>) {
      return (await sql.begin(async (t) => {
        const txClient: DbClient = {
          async query<U>(sqlText: string, params: unknown[] = []) {
            return (await t.unsafe(sqlText, params.map(normalizeParam) as any[], { prepare: false })) as U[];
          },
          async transaction<U>(innerFn: (tx: DbClient) => Promise<U>) {
            // Nested transactions could use savepoints, but for now we just reuse the same txClient
            return await innerFn(txClient);
          }
        };
        return await fn(txClient);
      })) as T;
    }
  };
}

// WRITING JSONB: bind JSON.stringify(value) and cast the placeholder $n::text::jsonb, not $n::jsonb -- postgres.js otherwise stores a jsonb STRING SCALAR, and JSON operators see nothing.
function normalizeParam(param: unknown): unknown {
  return Array.isArray(param) ? toPostgresArrayLiteral(param) : param;
}

function toPostgresArrayLiteral(values: unknown[]) {
  return `{${values.map(toPostgresArrayElement).join(',')}}`;
}

function toPostgresArrayElement(value: unknown) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  const text = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  return `"${text}"`;
}

export function runWithDb<T>(env: DbEnv, fn: () => T): T {
  return dbStorage.run(createDbClient(env), fn);
}

// Module-scoped Map pools connections outside runWithDb, but must self-heal when request context changes.
const fallbackClients = new Map<string, DbClient>();

// Catch dead request context I/O errors and terminated connections.
function isStaleConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Cannot perform I/O on behalf of a different request')
    || message.includes('CONNECTION_CLOSED');
}

export function getDb(env: DbEnv) {
  const store = dbStorage.getStore();
  if (store) return store;

  const connectionString = env.HYPERDRIVE.connectionString;
  let client = fallbackClients.get(connectionString);
  if (!client) {
    client = createDbClient(env);
    fallbackClients.set(connectionString, client);
  }
  return client;
}

// Retries op once on a fresh client if the module-cached socket has gone stale.
async function withStaleConnectionRecovery<T>(env: DbEnv, op: (db: DbClient) => Promise<T>): Promise<T> {
  const inScope = dbStorage.getStore() !== undefined;
  try {
    return await op(getDb(env));
  } catch (error) {
    if (inScope || !isStaleConnectionError(error)) throw error;

    const connectionString = env.HYPERDRIVE.connectionString;
    fallbackClients.delete(connectionString);
    const fresh = createDbClient(env);
    fallbackClients.set(connectionString, fresh);

    return await op(fresh);
  }
}

export async function queryRows<T>(env: DbEnv, sqlText: string, params: unknown[] = []) {
  return withStaleConnectionRecovery(env, (db) => db.query<T>(sqlText, params));
}

export async function queryTransaction<T>(env: DbEnv, fn: (tx: DbClient) => Promise<T>) {
  // Safe to re-run: the failed attempt never reached the server, so no partial transaction was committed.
  return withStaleConnectionRecovery(env, (db) => db.transaction<T>(fn));
}

export function parseJsonColumn<T>(value: T | string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value;
}
