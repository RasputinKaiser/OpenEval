"use client";
import { HighlightText } from "./TranscriptSearch";

/** Readable fenced code without interpreting transcript HTML or executing links. */
export function TranscriptContent({ text, query, tool }: { text: string; query: string; tool: boolean }) {
  const content = <div className="transcript-content mt-3 space-y-3 text-base leading-7 break-words">
    {text.split(/(```[^\n]*\n[\s\S]*?```)/g).map((part, index) => {
      if (part.startsWith("```")) {
        const newline = part.indexOf("\n"), language = part.slice(3, newline).trim();
        return <div key={index} className="rounded-md border border-bd bg-bg-elev overflow-hidden"><div className="px-3 py-1 text-xs text-fg-muted border-b border-bd">{language || "Code"}</div><pre tabIndex={0} aria-label="Code content, scrollable" className="p-3 overflow-auto max-h-96 text-xs mono"><HighlightText text={part.slice(newline + 1, -3)} query={query} /></pre></div>;
      }
      return <div key={index} className={`whitespace-pre-wrap ${tool ? "mono text-xs text-fg-muted" : "transcript-prose text-fg"}`}><HighlightText text={part} query={query} /></div>;
    })}
  </div>;
  return tool ? <details className="evidence-accordion mt-2"><summary className="cursor-pointer text-sm text-accent-soft min-h-10">Inspect tool input / output · {text.length.toLocaleString()} characters</summary>{content}</details> : content;
}
