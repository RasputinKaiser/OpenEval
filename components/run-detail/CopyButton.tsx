"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Copy } from "lucide-react";

/**
 * Inline copy-to-clipboard affordance with a brief "copied" confirmation.
 * Used on run ids, case ids, and final answers.
 */
export default function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    // No confirmation without a real write: clipboard is absent on insecure
    // origins (e.g. dashboard viewed over LAN IP) and optional chaining
    // would "succeed" silently.
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — leave state as-is.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded p-1 transition-colors",
        copied ? "text-ok" : "text-fg-dim hover:text-fg hover:bg-bg-elev",
        className,
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}
