import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Consistent page chrome: icon + title + one-line purpose, with actions pinned
 * right. Keeps every page's header identical in rhythm so the content below is
 * what varies.
 */
export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="grid place-items-center size-8 rounded-lg bg-accent/10 shrink-0">
            <Icon className="size-4 text-accent-soft" />
          </span>
          <span className="truncate">{title}</span>
        </h1>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {subtitle && <p className="text-sm text-fg-muted mt-1.5">{subtitle}</p>}
      {children}
    </header>
  );
}
