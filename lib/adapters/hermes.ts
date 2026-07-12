/**
 * Hermes Agent (Nous Research) session adapter.
 *
 * Hermes stores each session as ONE pretty-printed JSON document
 * (~/.hermes/sessions/session_*.json) with session-level metadata and an
 * OpenAI-chat-shaped `messages` array — not JSONL. Rather than teach the
 * line-oriented parser a second input mode, this transform re-emits the
 * document as the Claude-style records `parseLiveSession` already
 * understands, so tool counting, sentiment, markers, and duration all come
 * from the one battle-tested code path.
 *
 * Hermes records no token usage or cost; those metrics stay "missing" —
 * accuracy over breadth.
 */

interface HermesToolCall {
  id?: string;
  name?: string;
  function?: { name?: string; arguments?: unknown };
}

interface HermesMessage {
  role?: string;
  content?: unknown;
  tool_calls?: HermesToolCall[];
  tool_call_id?: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : ""))
      .join(" ");
  }
  return "";
}

function parseArgs(args: unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  try { return JSON.parse(args); } catch { return { raw: args }; }
}

/**
 * Convert a raw Hermes session document into Claude-style JSONL records.
 * Returns [] when the document isn't Hermes-shaped (caller treats as no session).
 */
export function hermesJsonToRecords(raw: string): string[] {
  let doc: any;
  try { doc = JSON.parse(raw); } catch { return []; }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.messages)) return [];

  const model = typeof doc.model === "string" && doc.model ? doc.model : undefined;
  const records: unknown[] = [];
  records.push({
    type: "system",
    model,
    session_id: typeof doc.session_id === "string" ? doc.session_id : undefined,
    timestamp: doc.session_start,
    messageCount: Number(doc.message_count) || doc.messages.length,
  });

  for (const m of doc.messages as HermesMessage[]) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "user") {
      records.push({ type: "user", message: { role: "user", content: textOf(m.content) } });
    } else if (m.role === "assistant") {
      const content: unknown[] = [];
      const text = textOf(m.content);
      if (text) content.push({ type: "text", text });
      for (const tc of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
        content.push({
          type: "tool_use",
          id: typeof tc?.id === "string" ? tc.id : undefined,
          name: tc?.function?.name ?? tc?.name ?? "(unknown)",
          input: parseArgs(tc?.function?.arguments),
        });
      }
      records.push({ type: "assistant", message: { model, content } });
    } else if (m.role === "tool") {
      records.push({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: textOf(m.content) }],
        },
      });
    }
  }

  const startMs = Date.parse(String(doc.session_start ?? ""));
  const endMs = Date.parse(String(doc.last_updated ?? ""));
  const haveSpan = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
  records.push({
    type: "system",
    timestamp: doc.last_updated,
    ...(haveSpan ? { durationMs: endMs - startMs } : {}),
  });

  return records.map((r) => JSON.stringify(r));
}
