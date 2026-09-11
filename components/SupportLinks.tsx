import {
  ExternalLink,
  GraduationCap,
  Heart,
  MessageCircle,
  PanelsTopLeft,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";

export const SUPPORT_LINKS = [
  { id: "support", label: "Support OpenEval", href: "https://ko-fi.com/rasputinkaiser", icon: Heart },
  { id: "contact", label: "Contact on X", href: "https://x.com/RasputinKaiser", icon: MessageCircle },
  { id: "projects", label: "Other projects", href: "https://ras.artificiallexicon.com/", icon: PanelsTopLeft },
  { id: "learning-ai", label: "Learning AI", href: "https://www.artificiallexicon.com/", icon: GraduationCap },
] satisfies ReadonlyArray<{ id: string; label: string; href: string; icon: LucideIcon }>;

/**
 * Shared outbound support surface for the persistent desktop shell and the
 * mobile More sheet. There is intentionally no account, payment, or tracking
 * behavior here: these are ordinary links to the project's public resources.
 */
export default function SupportLinks({ collapsed = false, headingId = "support-links-title", compact = false }: { collapsed?: boolean; headingId?: string; compact?: boolean }) {
  return (
    <section aria-labelledby={headingId} className={clsx("support-links", compact ? "px-2 py-2" : "px-3 py-3")}>
      <div className={clsx("mb-2", collapsed && "md:sr-only")}>
        <h2 id={headingId} className="text-[10px] font-medium uppercase tracking-widest text-fg-dim">
          Support &amp; contact
        </h2>
        <p className={clsx("mt-1 text-[10px] leading-4 text-fg-dim", compact && "sr-only")}>
          OpenEval is free and local-first. Support is optional.
        </p>
      </div>
      <nav aria-label="Support and contact links" className={clsx(compact && !collapsed ? "grid grid-cols-2 gap-0.5" : "space-y-0.5")}>
        {SUPPORT_LINKS.map(({ id, label, href, icon: Icon }) => (
          <a
            key={id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={label}
            aria-label={`${label} (opens in a new tab)`}
            data-testid={`support-link-${id}`}
            className="support-links__item flex min-h-10 items-center gap-2 rounded-md px-2 text-[11px] text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0 text-accent-soft" />
            <span className={clsx("min-w-0 truncate", collapsed && "md:sr-only")}>{compact ? ({ support: "Support", contact: "Contact on X", projects: "Projects", "learning-ai": "Learning AI" }[id]) : label}</span>
            <ExternalLink aria-hidden="true" className={clsx("ml-auto size-3 shrink-0 text-fg-dim", (collapsed || compact) && "md:hidden")} />
          </a>
        ))}
      </nav>
    </section>
  );
}
