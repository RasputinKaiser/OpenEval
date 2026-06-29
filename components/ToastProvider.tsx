"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
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
    setTimeout(() => dismiss(id), newToast.duration);
  }, [dismiss]);

  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  const iconColors = {
    success: "text-ok",
    error: "text-err",
    info: "text-accent-soft",
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[110] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => {
          const Icon = icons[t.variant];
          return (
            <div
              key={t.id}
              className="rounded-lg border border-bd bg-bg-subtle shadow-2xl p-4 flex items-start gap-3"
              style={{ animation: "menu-enter 150ms cubic-bezier(0.2, 0, 0, 1)" }}
            >
              <Icon className={clsx("size-4 shrink-0 mt-0.5", iconColors[t.variant])} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t.title}</div>
                {t.description && <div className="mt-0.5 text-xs text-fg-muted">{t.description}</div>}
                {t.actionHref && t.actionLabel && (
                  <Link href={t.actionHref} onClick={() => dismiss(t.id)} className="mt-1.5 inline-block text-xs text-accent-soft hover:underline">
                    {t.actionLabel} →
                  </Link>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} className="min-h-8 min-w-8 flex items-center justify-center rounded text-fg-dim hover:text-fg shrink-0">
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}