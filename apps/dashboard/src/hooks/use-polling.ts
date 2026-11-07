import { useEffect, useRef } from "react";

export function usePolling(
  callback: () => Promise<void> | void,
  delay: number | null = 10_000,
  deps: any[] = [],
) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    let active = document.visibilityState === "visible";
    let running = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const clearTimeoutIfScheduled = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const schedule = () => {
      clearTimeoutIfScheduled();
      if (!disposed && active && delay !== null) {
        timeout = setTimeout(() => void run(), delay);
      }
    };

    const run = async () => {
      if (disposed || !active || running) return;
      running = true;
      try {
        await savedCallback.current();
      } catch {
        // Polling callbacks own user-facing error state. A rejected callback must
        // not create an unhandled rejection or stop future polls.
      } finally {
        running = false;
        schedule();
      }
    };

    const start = () => {
      if (active) return;
      active = true;
      clearTimeoutIfScheduled();
      void run();
    };

    const stop = () => {
      active = false;
      clearTimeoutIfScheduled();
    };

    if (active) void run();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // The caller owns `deps`, so the array is a spread the lint rule can't statically verify; the
    // callback itself is read through a ref, so nothing here can go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, ...deps]);
}
