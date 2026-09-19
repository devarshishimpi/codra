import { useEffect, useRef } from 'react';

export function usePolling(callback: () => Promise<void> | void, delay = 10_000, deps: any[] = []) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    savedCallback.current();

    if (delay === null) return;

    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id !== null) return;
      id = setInterval(() => {
        savedCallback.current();
      }, delay);
    };

    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };

    if (document.visibilityState === 'visible') {
      start();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        savedCallback.current();
        start();
      } else {
        stop();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // The caller owns `deps`, so the array is a spread the lint rule can't statically verify; the
    // callback itself is read through a ref, so nothing here can go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, ...deps]);
}
