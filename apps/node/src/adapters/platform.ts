import type { Clock, IdGenerator, KvStore } from '@codraoss/core/ports';
import type { NodeAppBindings } from '../env';

export function makeKvStore(env: NodeAppBindings): KvStore {
  return {
    get: (key) => env.APP_KV.get(key),
    put: (key, value, options) => env.APP_KV.put(key, value, options),
  };
}

export const systemClock: Clock = { now: () => Date.now() };

export const cryptoIds: IdGenerator = { randomUUID: () => crypto.randomUUID() };
