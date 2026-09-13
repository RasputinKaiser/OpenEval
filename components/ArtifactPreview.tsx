"use client";

import { useEffect, useState } from "react";
import { previewDocument } from "@/lib/preview-document";
import { Loader2 } from "lucide-react";

export type ArtifactKind = "svg" | "html" | "text";

export function artifactKind(path: string, content: string): ArtifactKind {
  if (path.endsWith(".svg") || content.trimStart().startsWith("<svg")) return "svg";
  if (path.endsWith(".html") || path.endsWith(".htm") || content.includes("<html")) return "html";
  return "text";
}

function svgDocument(svg: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;background:#fff;display:grid;place-items:center}svg{max-width:100%;max-height:100%;width:100%;height:auto}</style></head><body>${svg}</body></html>`;
}

interface Props {
  path: string;
  content: string;
  kind?: ArtifactKind;
  className?: string;
}

/**
 * Artifact content is produced by the harness under test — untrusted by
 * definition. Static by default. Active playback grants scripts only inside
 * an opaque-origin sandbox; it never grants same-origin, popups or parent access.
 */
export default function ArtifactPreview({ path, content, kind, className }: Props) {
  const resolved = kind ?? artifactKind(path, content);
  const [active, setActive] = useState(false);
  const [replay, setReplay] = useState(0);
  const [tall, setTall] = useState(false);
  useEffect(() => { setActive(false); }, [path]);
  const [loadedDocument, setLoadedDocument] = useState<{ path: string; content: string; active: boolean; replay: number } | null>(null);
  const loaded = loadedDocument?.path === path && loadedDocument.content === content && loadedDocument.active === active && loadedDocument.replay === replay;
  const markLoaded = () => setLoadedDocument({ path, content, active, replay });

  if (resolved === "text") {
    return (
      <pre className={className ?? "max-h-[420px] overflow-auto rounded-md bg-white p-4 text-[11px] text-[#20242d]"}>{content}</pre>
    );
  }
  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-fg-muted">
        <button type="button" className="analysis-control" aria-pressed={active} onClick={() => setActive(!active)}>{active ? "Stop preview" : "Play preview"}</button>
        <button type="button" className="analysis-control" disabled={!active} onClick={() => setReplay(replay + 1)}>Replay</button>
        <button type="button" className="analysis-control" aria-pressed={tall} onClick={() => setTall(!tall)}>{tall ? "Compact view" : "Tall view"}</button>
        <span role="status">{active ? "Interactive playback · isolated frame" : "Still preview · Play enables interaction"}</span>
      </div>
      <div className="relative">
      {active ? <iframe key={`active-${replay}`} sandbox="allow-scripts" referrerPolicy="no-referrer"
        srcDoc={previewDocument(resolved === "svg" ? svgDocument(content) : content, true)} title={`Preview of ${path}`}
        onLoad={markLoaded} className={className ?? "h-[420px] w-full rounded-md bg-white ring-1 ring-white/10"} style={tall ? { height: "75vh", minHeight: 420 } : undefined} /> :
      <iframe key={`still-${replay}`} sandbox="" referrerPolicy="no-referrer" loading="lazy"
        srcDoc={previewDocument(resolved === "svg" ? svgDocument(content) : content, false)} title={`Preview of ${path}`}
        onLoad={markLoaded} className={className ?? "h-[420px] w-full rounded-md bg-white ring-1 ring-white/10"} style={tall ? { height: "75vh", minHeight: 420 } : undefined} />}
      {!loaded && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-white/80 text-sm text-[#5f6673]"
        >
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading preview
        </div>
      )}
      </div>
      <p className="text-xs text-fg-muted mt-2">Stop and Replay reset the document. Playback shows artifact behavior; it does not establish a passing evaluation.</p>
    </div>
  );
}
