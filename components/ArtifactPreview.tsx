"use client";

import { useEffect, useState } from "react";
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
 * definition. Always render through a fully sandboxed iframe (sandbox="",
 * no scripts, no same-origin), never into the app DOM.
 */
export default function ArtifactPreview({ path, content, kind, className }: Props) {
  const resolved = kind ?? artifactKind(path, content);
  const [loaded, setLoaded] = useState(false);

  // New document content = new load cycle; show the affordance again.
  useEffect(() => { setLoaded(false); }, [path, content]);

  if (resolved === "text") {
    return (
      <pre className={className ?? "max-h-[420px] overflow-auto rounded-md bg-white p-4 text-[11px] text-[#20242d]"}>{content}</pre>
    );
  }
  return (
    <div className="relative">
      <iframe
        sandbox=""
        loading="lazy"
        srcDoc={resolved === "svg" ? svgDocument(content) : content}
        title={`Preview of ${path}`}
        onLoad={() => setLoaded(true)}
        className={className ?? "h-[420px] w-full rounded-md bg-white ring-1 ring-white/10"}
      />
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
  );
}
