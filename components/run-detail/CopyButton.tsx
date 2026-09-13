"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useToast } from "../ToastProvider";
import { Check, Copy } from "lucide-react";

/**
 * Inline copy-to-clipboard affordance with a brief "copied" confirmation.
 * Used on run ids, case ids, and final answers.
 */
export default function CopyButton({ text, label, className, static: staticFeedback = false }: { text: string; label: string; className?: string; static?: boolean }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const writing = useRef(false);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);

  async function copy() {
    // No confirmation without a real write: clipboard is absent on insecure
    // origins (e.g. dashboard viewed over LAN IP) and optional chaining
    // would "succeed" silently.
    if (writing.current) return;
    writing.current = true;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (!mounted.current) return;
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      if (!mounted.current) return;
      setCopied(false);
      toast({ title: "Clipboard access is unavailable", description: "Select the text and copy it manually, or allow clipboard access and try again.", variant: "error", duration: 0 });
    } finally { writing.current = false; }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      data-copied={copied || undefined}
      data-static={staticFeedback || undefined}
      className={clsx(
        "copy-feedback inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded p-1 transition-colors",
        copied ? "text-ok" : "text-fg-dim hover:text-fg hover:bg-bg-elev",
        className,
      )}
    >
      <span className="sr-only" role="status">{copied ? "Copied to clipboard" : ""}</span>
      <span className="copy-feedback-icons" aria-hidden="true">
        <Copy className="copy-feedback-idle size-3" />
        <Check className="copy-feedback-done size-3" />
      </span>
    </button>
  );
}
