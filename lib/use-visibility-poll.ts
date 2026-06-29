import { useEffect, useRef } from "react";

export function useVisibilityPoll(
  callback: () => void | Promise<void>,
  intervalMs: number,
  deps: unknown[] = [],
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    function scheduleNext() {
      if (cancelledRef.current || !enabled) return;
      timerRef.current = setTimeout(poll, intervalMs);
    }

    async function poll() {
      if (cancelledRef.current || !enabled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        await callbackRef.current();
      } catch {
        // swallow — poller errors are non-fatal
      }
      if (!cancelledRef.current && enabled) scheduleNext();
    }

    if (enabled) poll();

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && !cancelledRef.current && enabled) {
        if (timerRef.current) clearTimeout(timerRef.current);
        poll();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelledRef.current = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled, ...deps]);
}