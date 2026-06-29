import { type LucideIcon } from "lucide-react";
import Link from "next/link";

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionHref,
  actionLabel,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="grid place-items-center size-12 rounded-xl bg-bg-elev mb-3">
        <Icon className="size-6 text-fg-dim opacity-60" />
      </div>
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {description && <p className="mt-1 text-xs text-fg-muted max-w-xs">{description}</p>}
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent hover:bg-accent/90 active:scale-[0.96] text-white text-xs font-medium transition-colors"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}