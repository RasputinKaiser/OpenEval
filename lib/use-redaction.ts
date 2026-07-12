"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collectPathUsernames, redactDisplay } from "./redaction";

/**
 * App-wide redaction preference. One localStorage key (the Live page's
 * original) backs every page. Two sync channels: a custom event for other
 * hook instances in THIS tab (storage events never fire locally), and the
 * `storage` event for other open tabs. Defaults to ON — leaking is opt-in.
 */
export const REDACT_STORAGE_KEY = "openeval.live.redactUsernames";
const REDACT_EVENT = "openeval:redact-changed";

export function useRedaction(): { redact: boolean; setRedact: (v: boolean | ((v: boolean) => boolean)) => void } {
  const [redact, setRedactRaw] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(REDACT_STORAGE_KEY);
      if (stored === "0") setRedactRaw(false);
      if (stored === "1") setRedactRaw(true);
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === REDACT_STORAGE_KEY && e.newValue != null) setRedactRaw(e.newValue !== "0");
    };
    const onLocal = (e: Event) => setRedactRaw((e as CustomEvent<boolean>).detail);
    window.addEventListener("storage", onStorage);
    window.addEventListener(REDACT_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(REDACT_EVENT, onLocal);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(REDACT_STORAGE_KEY, redact ? "1" : "0");
    } catch {}
  }, [redact]);

  // Broadcast only on user-driven changes; receivers use the raw setter, so
  // there is no re-dispatch loop.
  const setRedact = useCallback((v: boolean | ((v: boolean) => boolean)) => {
    setRedactRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      queueMicrotask(() => window.dispatchEvent(new CustomEvent(REDACT_EVENT, { detail: next })));
      return next;
    });
  }, []);

  return { redact, setRedact };
}

/**
 * The one redaction contract for list/content surfaces: harvest local
 * usernames from the strings in `harvestFrom` (paths, titles, previews —
 * memoize the array in the caller), and get a `show()` that scrubs paths,
 * bare username tokens, and (optionally) credential shapes under the
 * app-wide toggle. Per-instance state — nothing is shared across
 * components, renders, or SSR requests.
 */
export function useRedactedShow(
  harvestFrom: ReadonlyArray<unknown>,
  opts: { secrets?: boolean } = {},
): { redact: boolean; setRedact: (v: boolean | ((v: boolean) => boolean)) => void; show: (v: unknown) => string; users: ReadonlySet<string> } {
  const { redact, setRedact } = useRedaction();
  const secrets = opts.secrets ?? false;
  const users = useMemo(() => {
    const names = new Set<string>();
    for (const v of harvestFrom) collectPathUsernames(v, names);
    return names as ReadonlySet<string>;
  }, [harvestFrom]);
  const show = useCallback(
    (v: unknown) => (redact ? redactDisplay(v, { usernames: users, secrets }) : String(v ?? "")),
    [redact, users, secrets],
  );
  return { redact, setRedact, show, users };
}
