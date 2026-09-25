import { useCallback, useSyncExternalStore } from "react";

export const DEFAULT_STATS_DAYS = 14;

/**
 * The stats time range, shared by the dashboard and the stats page so navigating between them
 * doesn't silently swap the range out from under the reader.
 *
 * Module state, deliberately not persisted: it lives as long as the SPA session and a fresh page
 * load starts back at {@link DEFAULT_STATS_DAYS}.
 */
let days = DEFAULT_STATS_DAYS;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return days;
}

export function useStatsRange(): [number, (next: number) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setDays = useCallback((next: number) => {
    if (next === days) return;
    days = next;
    for (const listener of listeners) listener();
  }, []);

  return [value, setDays];
}
