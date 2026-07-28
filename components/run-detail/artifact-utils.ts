/** Pure helpers for the artifact preview stage (kept React-free for tests). */

export interface ArtifactReceipt {
  path: string;
  content: string;
  bytes: number;
  sha256: string;
  modifiedAtMs: number;
}

export async function fetchArtifact(runId: string, caseId: string, artifact: string) {
  const res = await fetch(`/api/runs/${runId}/case/${caseId}/artifact?path=${encodeURIComponent(artifact)}`);
  if (!res.ok) throw new Error("Artifact is not available yet.");
  return (await res.json()) as ArtifactReceipt;
}

export function inlineStyles(html: string, css: string) {
  const style = `<style>${css}</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${style}</head>`);
  return `${style}${html}`;
}
