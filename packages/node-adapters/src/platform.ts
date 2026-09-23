import type { Clock, IdGenerator, KvStore } from '@codraoss/core/ports';

export function makeKvStore(appKv: KvStore): KvStore {
  return appKv;
}

export const systemClock: Clock = { now: () => Date.now() };

export const cryptoIds: IdGenerator = { randomUUID: () => crypto.randomUUID() };
