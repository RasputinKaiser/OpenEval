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
    <header className="page-header mb-6">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="page-header-title flex min-w-0 items-center gap-3 text-2xl font-semibold tracking-tight text-balance">
          <span aria-hidden="true" className="page-header-icon grid size-8 shrink-0 place-items-center rounded-lg">
            <Icon className="size-4 text-accent-soft" />
          </span>
          <span className="min-w-0">{title}</span>
        </h1>
        {actions && <div className="page-header-actions flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </div>
      {subtitle && <p className="page-header-subtitle mt-2 max-w-[72ch] text-base leading-6 text-fg-muted">{subtitle}</p>}
      {children}
    </header>
  );
}
