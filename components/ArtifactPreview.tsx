"use client";

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
  if (resolved === "text") {
    return (
      <pre className={className ?? "max-h-[420px] overflow-auto rounded-md bg-white p-4 text-[11px] text-[#20242d]"}>{content}</pre>
    );
  }
  return (
    <iframe
      sandbox=""
      loading="lazy"
      srcDoc={resolved === "svg" ? svgDocument(content) : content}
      title={`Preview of ${path}`}
      className={className ?? "h-[420px] w-full rounded-md bg-white ring-1 ring-white/10"}
    />
  );
}
