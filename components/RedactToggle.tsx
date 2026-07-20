"use client";

import clsx from "clsx";
import { Eye, Lock } from "lucide-react";
import { compactDisplayPath } from "@/lib/redaction";
import { useRedaction } from "@/lib/use-redaction";

/**
 * The one Redact button, shared by every page that shows session content.
 * Green/locked = safe to screenshot; amber/eye = raw local paths visible.
 */
export function RedactToggle({ redact, onToggle, compact }: { redact: boolean; onToggle: () => void; compact?: boolean }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={redact}
      title="Hide local usernames in paths, titles, and content (one preference, app-wide)"
      className={clsx(
        "flex items-center gap-1.5 rounded-md border transition-colors",
        compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-sm",
        redact ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn",
      )}
    >
      {redact ? <Lock className={compact ? "size-3" : "size-3.5"} /> : <Eye className={compact ? "size-3" : "size-3.5"} />}
      Redact {redact ? "on" : "off"}
    </button>
  );
}

/**
 * A file path rendered under the app-wide redaction preference — for server
 * components (page headers) that can't read the client-side toggle themselves.
 */
export function RedactedPath({ path, className }: { path: string; className?: string }) {
  const { redact } = useRedaction();
  return <span className={className}>{compactDisplayPath(path, redact)}</span>;
}
