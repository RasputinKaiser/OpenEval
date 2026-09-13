"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: "success" | "error" | "info";
  actionHref?: string;
  actionLabel?: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2, 9);
    const newToast: Toast = { id, duration: 5000, ...t };
    setToasts((prev) => [...prev.slice(-3), newToast]);

  }, []);

  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  const iconColors = {
    success: "text-ok",
    error: "text-err",
    info: "text-accent-soft",
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Live region exists from mount so screen readers announce new toasts. */}
      <div aria-live="polite" aria-label="Notifications" role="region" className="toast-stack">
        {toasts.map((t) => {
          const Icon = icons[t.variant];
          return (
            <ToastLifetime key={t.id} toast={t} dismiss={dismiss}>
              <Icon aria-hidden="true" className={clsx("size-4 shrink-0 mt-0.5", iconColors[t.variant])} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium break-words">
                  {/* Variant is conveyed by color+icon visually; give AT the word. */}
                  <span className="sr-only">{t.variant === "success" ? "Success: " : t.variant === "error" ? "Error: " : "Info: "}</span>
                  {t.title}
                </div>
                {t.description && <div className="mt-0.5 text-xs text-fg-muted break-words">{t.description}</div>}
                {t.actionHref && t.actionLabel && (
                  <Link href={t.actionHref} onClick={() => dismiss(t.id)} className="mt-1.5 inline-block text-xs text-accent-soft hover:underline">
                    {t.actionLabel} →
                  </Link>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="min-h-11 min-w-11 flex items-center justify-center rounded text-fg-dim hover:text-fg shrink-0">
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </ToastLifetime>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Pause the remaining lifetime while a notification is being read or the tab is hidden. */
function ToastLifetime({ toast, dismiss, children }: { toast: Toast; dismiss: (id: string) => void; children: ReactNode }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const remaining = useRef(toast.duration ?? 5000);
  useEffect(() => { const sync = () => setHidden(document.hidden); sync(); document.addEventListener("visibilitychange", sync); return () => document.removeEventListener("visibilitychange", sync); }, []);
  useEffect(() => {
    if (hovered || focused || hidden || toast.duration === 0) return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), Math.max(0, remaining.current));
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [hovered, focused, hidden, toast.id, toast.duration, dismiss]);
  return <div className="toast-message rounded-lg border border-bd bg-bg-subtle p-4 flex items-start gap-3" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>{children}</div>;
}
