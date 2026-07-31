import { type LucideIcon } from "lucide-react";
import Link from "next/link";

/**
 * Shared empty-state surface. Always give the user a concrete next action:
 * `actionHref`/`actionLabel` render a primary link (e.g. "New run" → /runs/new)
 * and `command` renders an equivalent CLI one-liner as a secondary path.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionHref,
  actionLabel,
  command,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
  /** CLI one-liner offered as the secondary next action. */
  command?: string;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="grid place-items-center size-12 rounded-xl bg-bg-elev mb-3">
        <Icon aria-hidden="true" className="size-6 text-fg-dim opacity-60" />
      </div>
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {description && <p className="mt-1 text-xs text-fg-muted max-w-xs">{description}</p>}
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.96]"
        >
          {actionLabel}
        </Link>
      )}
      {command && (
        <code className="mt-3 block max-w-full overflow-x-auto break-all rounded-md border border-bd-subtle bg-bg-subtle px-3 py-1.5 text-[11px] mono text-fg-muted select-all">
          {command}
        </code>
      )}
    </div>
  );
}
