import clsx from "clsx";
import { CheckCircle2, XCircle, AlertCircle, Clock, Loader2, MinusCircle } from "lucide-react";

type Status = "pending" | "running" | "grading" | "passed" | "failed" | "error" | "skipped" | "completed" | "aborted";

const MAP: Record<Status, { icon: typeof CheckCircle2; color: string; label: string }> = {
  pending: { icon: Clock, color: "text-fg-dim", label: "Pending" },
  running: { icon: Loader2, color: "text-accent-soft", label: "Running" },
  grading: { icon: Loader2, color: "text-warn", label: "Grading" },
  passed: { icon: CheckCircle2, color: "text-ok", label: "Passed" },
  failed: { icon: XCircle, color: "text-err", label: "Failed" },
  error: { icon: AlertCircle, color: "text-err", label: "Error" },
  skipped: { icon: MinusCircle, color: "text-fg-dim", label: "Skipped" },
  completed: { icon: CheckCircle2, color: "text-ok", label: "Completed" },
  aborted: { icon: AlertCircle, color: "text-warn", label: "Aborted" },
};

export default function StatusBadge({ status, size = "sm" }: { status: Status | string; size?: "xs" | "sm" | "md" }) {
  const m = MAP[status as Status] || MAP.pending;
  const Icon = m.icon;
  const animated = status === "running" || status === "grading";
  return (
    <span className={clsx(
      "inline-flex items-center gap-1.5 rounded-full border border-bd px-2 py-0.5",
      size === "xs" ? "text-[10px]" : size === "md" ? "text-xs" : "text-[11px]"
    )}>
      <Icon className={clsx("size-3", m.color, animated && "animate-spin")} />
      <span className={m.color}>{m.label}</span>
    </span>
  );
}