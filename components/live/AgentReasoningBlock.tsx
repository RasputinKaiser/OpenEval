"use client";

import clsx from "clsx";
import { BrainCircuit, EyeOff } from "lucide-react";
import React from "react";
import { fmtDateTime, fmtStableDateTime, fmtTime } from "@/lib/format";

export { isAgentReasoningTurn } from "./live-shared";

/** Keep a reasoning disclosure useful on narrow screens and cheap to expand. */
export const MAX_REASONING_PARAGRAPHS = 8;
export const MAX_REASONING_CHARS = 3_200;

type ReasoningAvailability = "available" | "encrypted" | "unavailable" | "truncated";

export type ReasoningView = {
  status: ReasoningAvailability;
  paragraphs: string[];
  truncated: boolean;
};

function unavailableReason(preview: string): "encrypted" | "unavailable" | "truncated" | null {
  const text = preview.trim();
  if (!text) return "unavailable";
  if (/^\((?:encrypted|redacted)[^)]*(?:reasoning|thinking)[^)]*\)$/i.test(text)) return "encrypted";
  if (/^\((?:unavailable)[^)]*(?:reasoning|thinking)[^)]*\)$/i.test(text)) return "unavailable";
  if (/^\((?:truncated)[^)]*(?:reasoning|thinking)[^)]*\)$/i.test(text)) return "truncated";
  if (/^\(\d+\s+thinking block(?:s)?\)$/i.test(text)) return "unavailable";
  return null;
}

/** Produce paragraph-sized display data without ever copying an unbounded turn into the DOM. */
export function getReasoningView(preview: string): ReasoningView {
  const source = String(preview ?? "").trim();
  const unavailable = unavailableReason(source);
  if (unavailable) return { status: unavailable, paragraphs: [], truncated: false };

  const sourceWasTruncated = source.endsWith("...");
  const candidates = source
    .split(/\n\s*\n|\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const paragraphs: string[] = [];
  let remaining = MAX_REASONING_CHARS;
  let truncated = sourceWasTruncated || candidates.length > MAX_REASONING_PARAGRAPHS;

  for (const candidate of candidates.slice(0, MAX_REASONING_PARAGRAPHS)) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (candidate.length > remaining) {
      paragraphs.push(`${candidate.slice(0, Math.max(0, remaining - 1)).trimEnd()}…`);
      truncated = true;
      break;
    }
    paragraphs.push(candidate);
    remaining -= candidate.length;
  }

  return { status: paragraphs.length > 0 ? "available" : "unavailable", paragraphs, truncated };
}

export function AgentReasoningBlock({
  preview,
  model,
  at,
  mounted = false,
  className,
}: {
  preview: string;
  model?: string | null;
  at?: number;
  mounted?: boolean;
  className?: string;
}) {
  const view = getReasoningView(preview);
  const modelText = model?.trim() ? `Model: ${model.trim()}` : "Model unavailable";
  const unavailableText = view.status === "encrypted"
    ? "Reasoning is encrypted or was not emitted by the source."
    : view.status === "truncated"
      ? "The source only exposed a truncated reasoning marker."
      : "Reasoning content is unavailable in this normalized view.";
  const disclosureStatus = view.status === "available"
    ? "Collapsed detail · expand to read"
    : view.status === "truncated" ? "Preview truncated" : "Content unavailable";

  return (
    <details className={clsx("rounded-lg border border-accent/25 bg-accent/[0.04]", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <BrainCircuit className="size-4 shrink-0 text-accent-soft" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-accent-soft">Agent reasoning</span>
            <span className="mt-0.5 block truncate text-[10px] text-fg-dim">
              {disclosureStatus}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-[10px] text-fg-dim">{view.status === "available" ? "Show reasoning" : "Why?"}</span>
      </summary>
      <div className="space-y-3 border-t border-accent/15 px-3 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-fg-dim" aria-label="Agent reasoning metadata">
          <span>{modelText}</span>
          {at ? (
            <time dateTime={fmtStableDateTime(at)} title={fmtDateTime(at)} className="mono tabular-nums">
              {mounted ? fmtTime(at) : fmtStableDateTime(at)}
            </time>
          ) : (
            <span>Time unavailable</span>
          )}
        </div>

        {view.status !== "available" ? (
          <div role="status" className="flex items-start gap-2 rounded border border-warn/25 bg-warn/10 px-2.5 py-2 text-[11px] leading-5 text-warn">
            <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{unavailableText} The raw transcript remains authoritative.</span>
          </div>
        ) : (
          <div aria-label="Agent reasoning paragraphs" className="space-y-3">
            {view.paragraphs.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 16)}`} className="text-[12px] leading-6 text-fg/90">{paragraph}</p>
            ))}
          </div>
        )}

        {view.truncated && (
          <p role="status" className="rounded border border-accent/20 bg-accent/5 px-2.5 py-2 text-[10px] leading-5 text-fg-muted">
            Only a bounded reasoning preview is shown here; additional content remains in the raw transcript.
          </p>
        )}
      </div>
    </details>
  );
}
