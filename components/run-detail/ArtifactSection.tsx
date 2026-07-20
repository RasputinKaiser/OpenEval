"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronRight, Eye, FileCode, Loader2, Sparkles } from "lucide-react";
import type { RunCaseRecord } from "@/lib/types";
import { redactSensitiveText } from "@/lib/redaction";
import { useRedaction } from "@/lib/use-redaction";
import ArtifactPreview, { artifactKind } from "../ArtifactPreview";
import { fetchArtifact, inlineStyles } from "./artifact-utils";

/**
 * Live artifact preview stage: artifact tab picker, fetch state, and the
 * sandboxed preview frame. Header collapse state is owned by the caller.
 */
export default function ArtifactStage({
  artifacts,
  caseId,
  runId,
  status,
  collapsed,
  onToggle,
}: {
  artifacts: string[];
  caseId: string;
  runId: string;
  status: RunCaseRecord["status"];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [selected, setSelected] = useState(artifacts[0] ?? "");
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { redact } = useRedaction();

  useEffect(() => {
    if (!selected || collapsed) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const main = await fetchArtifact(runId, caseId, selected);
        let content = main.content;
        const kind = artifactKind(selected, content);
        if (kind === "html" && artifacts.includes("styles.css")) {
          try {
            const css = await fetchArtifact(runId, caseId, "styles.css");
            content = inlineStyles(content, css.content);
          } catch {
            // HTML still renders without the optional stylesheet while the run is in flight.
          }
        }
        if (!cancelled) setPreview({ path: selected, content });
      } catch (e) {
        if (!cancelled) {
          setPreview(null);
          setError(e instanceof Error ? e.message : "Artifact is not available yet.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [artifacts, caseId, runId, selected, status, collapsed]);

  return (
    <div className="card overflow-hidden">
      <div className={clsx(
        "flex flex-wrap items-center justify-between gap-3 bg-bg-subtle/50 px-4 py-3",
        !collapsed && "border-b border-bd-subtle",
      )}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <ChevronRight className={clsx("size-3 shrink-0 text-fg-dim transition-transform", !collapsed && "rotate-90")} />
          <Eye className="size-4 shrink-0 text-accent-soft" />
          <div className="min-w-0">
            <div className="text-xs font-medium">Live artifact preview</div>
            <div className="truncate text-[10px] text-fg-dim mono">{redact ? redactSensitiveText(preview?.path ?? selected) : (preview?.path ?? selected)}</div>
          </div>
        </button>
        {!collapsed && (
          <div className="flex flex-wrap gap-1.5">
            {artifacts.map((artifact) => (
              <button
                key={artifact}
                onClick={() => setSelected(artifact)}
                className={clsx(
                  "inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-[11px] mono",
                  selected === artifact
                    ? "border-accent-soft bg-accent-soft/10 text-accent-soft"
                    : "border-bd-subtle bg-bg text-fg-muted hover:text-fg"
                )}
              >
                <FileCode className="size-3" />
                {artifact}
              </button>
            ))}
          </div>
        )}
      </div>
      {!collapsed && (
        <div className="bg-[#f6f7fb] p-3">
          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center text-sm text-[#5f6673]">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Rendering artifact
            </div>
          ) : preview ? (
            <ArtifactPreview path={preview.path} content={preview.content} />
          ) : (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-[#cbd2df] bg-white px-6 text-center">
              <Sparkles className="mb-2 size-6 text-[#7c5cff]" />
              <div className="text-sm font-medium text-[#20242d]">Waiting for artifact</div>
              <div className="mt-1 max-w-sm text-xs leading-5 text-[#687182]">
                {error ?? "The preview appears automatically once the eval writes the expected file."}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
