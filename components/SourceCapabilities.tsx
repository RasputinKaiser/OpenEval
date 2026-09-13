import { ChevronRight } from 'lucide-react';
import { sourceCapabilities } from '@/lib/collection/source-capabilities';
export function SourceCapabilities({ format, parseable = true, compact = false }: { format: string; parseable?: boolean; compact?: boolean }) {
  const support = sourceCapabilities(format, parseable);
  return <details className="source-capabilities my-2 text-xs text-fg-muted"><summary className="cursor-pointer min-h-10 flex items-center gap-2"><ChevronRight className="source-capabilities-chevron size-3.5 shrink-0" aria-hidden="true" /><span>Format coverage{!compact && <> · {support.readable ? 'transcript reader available' : 'inventory only'}</>}</span></summary>
    <dl className={compact ? "grid grid-cols-1 gap-y-1 py-2 whitespace-normal [&_dt]:font-medium [&_dt:not(:first-child)]:mt-2" : "grid grid-cols-2 gap-x-3 gap-y-2 py-2"}>
      <dt>Readable transcript</dt><dd>{support.readable ? 'Supported within reader limits' : 'Unavailable'}</dd>
      <dt>Whole-session search</dt><dd>{support.searchable ? 'Redacted text · within reader limits' : 'Unavailable'}</dd>
      <dt>Normalized conversation</dt><dd>{support.normalized ? 'Derived view; original source retained' : 'Unavailable'}</dd>
      <dt>Evidence-judge input</dt><dd>{support.judgeEvidence ? 'Extractor available; sufficient evidence not guaranteed' : 'Unsupported by the evidence extractor'}</dd>
    </dl><p>{support.note} These are format capabilities, not proof that every discovered file was readable or every event was supported.</p>
  </details>;
}
