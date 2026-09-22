import type { Clock, IdGenerator, KvStore } from '@codraoss/core/ports';

export function makeKvStore(appKv: KvStore): KvStore {
  return {
    get: (key) => appKv.get(key),
    put: (key, value, options) => appKv.put(key, value, options),
  };
}

export const systemClock: Clock = { now: () => Date.now() };

export const cryptoIds: IdGenerator = { randomUUID: () => crypto.randomUUID() };
