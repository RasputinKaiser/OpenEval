import clsx from "clsx";
import { CheckCircle2, XCircle, AlertCircle, Clock, Loader2, MinusCircle } from "lucide-react";

type Status = "pending" | "running" | "grading" | "passed" | "failed" | "error" | "skipped" | "completed" | "aborted";

const MAP: Record<Status, { icon: typeof CheckCircle2; color: string; label: string; bg: string; border: string }> = {
  pending: { icon: Clock, color: "text-fg-dim", label: "Pending", bg: "bg-bg-elev", border: "border-bd-subtle" },
  running: { icon: Loader2, color: "text-accent-soft", label: "Running", bg: "bg-accent/10", border: "border-accent/30" },
  grading: { icon: Loader2, color: "text-warn", label: "Grading", bg: "bg-warn/10", border: "border-warn/30" },
  passed: { icon: CheckCircle2, color: "text-ok", label: "Passed", bg: "bg-ok/10", border: "border-ok/30" },
  failed: { icon: XCircle, color: "text-err", label: "Failed", bg: "bg-err/10", border: "border-err/30" },
  error: { icon: AlertCircle, color: "text-err", label: "Error", bg: "bg-err/10", border: "border-err/30" },
  skipped: { icon: MinusCircle, color: "text-fg-dim", label: "Skipped", bg: "bg-bg-elev", border: "border-bd-subtle" },
  completed: { icon: CheckCircle2, color: "text-ok", label: "Completed", bg: "bg-ok/10", border: "border-ok/30" },
  aborted: { icon: AlertCircle, color: "text-warn", label: "Aborted", bg: "bg-warn/10", border: "border-warn/30" },
};

export default function StatusBadge({ status, size = "sm" }: { status: Status | string; size?: "xs" | "sm" | "md" }) {
  const m = MAP[status as Status] || MAP.pending;
  const Icon = m.icon;
  const animated = status === "running" || status === "grading";
  return (
    <span className={clsx(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
      m.bg, m.border,
      size === "xs" ? "text-[10px]" : size === "md" ? "text-xs" : "text-[11px]"
    )}>
      <Icon className={clsx("size-3", m.color, animated && "animate-spin")} />
      <span className={m.color}>{m.label}</span>
    </span>
  );
}