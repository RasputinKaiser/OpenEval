import Link from "next/link";
import { ChevronDown, ExternalLink, FileText, Search, ShieldCheck } from "lucide-react";
import clsx from "clsx";

export type EvidenceTranscriptStatus = "available" | "archived" | "search" | "unavailable";

export interface EvidenceReviewProps {
  /** Stable, source-qualified identity when this surface has one. */
  identity: string;
  /** Where the identity came from; aggregate surfaces should say so explicitly. */
  source: string;
  /** What kind of evidence produced the displayed summary. */
  provenance: string;
  transcript: {
    status: EvidenceTranscriptStatus;
    detail: string;
    href?: string;
    linkLabel?: string;
  };
  /** The list is intentionally capped so a row can never become a transcript dump. */
  caveats?: string[];
  className?: string;
}

const STATUS_LABEL: Record<EvidenceTranscriptStatus, string> = {
  available: "Transcript available",
  archived: "Transcript archived",
  search: "Transcript lookup",
  unavailable: "Transcript unavailable",
};

const STATUS_TONE: Record<EvidenceTranscriptStatus, string> = {
  available: "text-ok",
  archived: "text-fg-muted",
  search: "text-accent-soft",
  unavailable: "text-warn",
};

/**
 * Compact, metadata-only handoff from a summary row to inspectable evidence.
 * It never renders transcript text; detail pages and bounded Collection search
 * remain the only transcript surfaces.
 */
export function EvidenceReview({
  identity,
  source,
  provenance,
  transcript,
  caveats = [],
  className,
}: EvidenceReviewProps) {
  const visibleCaveats = [...new Set(caveats.filter(Boolean))].slice(0, 3);
  const TranscriptIcon = transcript.status === "search" ? Search : FileText;

  return (
    <details className={clsx("group min-w-0", className)}>
      <summary className="inline-flex min-h-7 max-w-full cursor-pointer list-none items-center gap-1 rounded border border-bd-subtle px-1.5 py-1 text-[10px] text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="size-3 text-accent-soft" aria-hidden />
        <span>Review evidence</span>
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-bd bg-bg-subtle p-2.5 text-[10px] shadow-lg">
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <dt className="text-fg-dim">Identity</dt>
          <dd className="min-w-0 break-words font-medium text-fg">{identity}</dd>
          <dt className="text-fg-dim">Source</dt>
          <dd className="min-w-0 break-words text-fg-muted">{source}</dd>
          <dt className="text-fg-dim">Provenance</dt>
          <dd className="min-w-0 break-words text-fg-muted">{provenance}</dd>
        </dl>

        <div className="mt-2 border-t border-bd-subtle pt-2">
          <div className={clsx("flex items-center gap-1.5 font-medium", STATUS_TONE[transcript.status])}>
            <TranscriptIcon className="size-3" aria-hidden />
            <span>{STATUS_LABEL[transcript.status]}</span>
          </div>
          <p className="mt-1 leading-snug text-fg-dim">{transcript.detail}</p>
          {transcript.href && (
            <Link
              href={transcript.href}
              className="mt-1.5 inline-flex items-center gap-1 text-accent-soft hover:underline"
            >
              {transcript.linkLabel ?? "Inspect evidence"}
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          )}
        </div>

        <div className="mt-2 border-t border-bd-subtle pt-2">
          <div className="font-medium text-fg-muted">Caveats</div>
          {visibleCaveats.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 leading-snug text-fg-dim">
              {visibleCaveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
            </ul>
          ) : (
            <p className="mt-1 leading-snug text-fg-dim">No additional caveat is recorded on this summary surface.</p>
          )}
        </div>
      </div>
    </details>
  );
}
