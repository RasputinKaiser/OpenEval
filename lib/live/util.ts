import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { estimateCostUsd, isPlaceholderModel } from "../pricing";
import type { LiveMetricSources, LiveModelUsage, LiveSession, LiveSessionToolDuration, LiveUsageSegment, MetricSource } from "./types";

/**
 * Heuristic: does a tool's raw output text indicate a failure? Codex
 * `function_call_output` events carry no structured error flag, so we sniff the
 * text — but only for real error INDICATORS, not any occurrence of the words
 * "error"/"failed". Matching those as bare substrings flagged benign output
 * ("5 passed, 0 failed", "0 errors", "error handling") as failures, inflating
 * error rates and depressing data-quality scores across most real sessions.
 */
export function looksLikeToolError(output: string): boolean {
  if (!output) return false;
  return (
    /(?:exit(?:ed)? with code|exit code)\s+[1-9]/i.test(output) ||
    /traceback \(most recent call last\)/i.test(output) ||
    /\b(?:error|fatal|panic)\s*:/i.test(output) ||
    /\b(?:command not found|no such file or directory|permission denied|segmentation fault|command failed)\b/i.test(output)
  );
}

/**
 * Codex shell outputs carry a structured exit marker — either a leading
 * "Exit code: N" line or a JSON envelope {"output": …, "metadata":
 * {"exit_code": N}} (both shapes verified against real ~/.codex/sessions
 * rollouts). Trust the marker when present so exit-0 output that merely
 * MENTIONS "error:" (compiler diagnostics, grep hits) isn't flagged; fall back
 * to text sniffing only when no marker exists.
 */
export function codexToolOutputError(output: string): boolean {
  if (!output) return false;
  const head = output.match(/^Exit code: (-?\d+)/);
  if (head) return head[1] !== "0";
  if (output.startsWith("{")) {
    try {
      const exit = JSON.parse(output)?.metadata?.exit_code;
      if (typeof exit === "number") return exit !== 0;
    } catch {}
  }
  return looksLikeToolError(output);
}

const MIN_PLAUSIBLE_MS = 1_577_836_800_000; // 2020-01-01

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// `!line.trim()` ⇔ `!/\S/.test(line)`: regex \s and String.trim strip the
// same WhiteSpace ∪ LineTerminator set (incl. NBSP), and the test allocates
// no per-line string. Shared, non-global — no lastIndex state.
export const NON_WS_RE = /\S/;

// Hoisted from the per-tool_use hot path; contents must not change without
// auditing readLikeOperations/writeLikeOperations semantics.
export const READ_LIKE_TOOL_HINTS = ["read", "grep", "glob", "webfetch", "websearch"];
export const WRITE_TOOL_NAMES = ["write", "edit", "multiedit"];

export function decodeProjectDir(name: string): string {
  return name
    .replace(/^-/, "/")
    .replace(/--/g, "/.")
    .replace(/-/g, "/");
}

/**
 * Exact-shape fast path for `YYYY-MM-DDTHH:MM:SS.mmmZ` (toISOString output —
 * what these JSONL files carry on every record; Date.parse's general grammar
 * costs ~1µs/call, which dominated 6% of a cold scan). Returns NaN unless the
 * string matches the shape with in-range components (so out-of-range dates
 * fall back to Date.parse's own NaN, and years < 100 fall back because
 * Date.UTC would remap them to 1900+y). For matched strings, ECMA-262 defines
 * Date.parse of an ISO-UTC string as exactly the UTC MakeDate of its
 * components, which is what Date.UTC computes — identical results.
 */
export function fastIsoUtcMs(value: string): number {
  if (value.length !== 24) return NaN;
  if (
    value.charCodeAt(4) !== 45 || value.charCodeAt(7) !== 45 || value.charCodeAt(10) !== 84 ||
    value.charCodeAt(13) !== 58 || value.charCodeAt(16) !== 58 || value.charCodeAt(19) !== 46 ||
    value.charCodeAt(23) !== 90
  ) return NaN;
  let y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, ms = 0;
  for (let i = 0; i < 23; i++) {
    if (i === 4 || i === 7 || i === 10 || i === 13 || i === 16 || i === 19) continue;
    const c = value.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return NaN;
    if (i < 4) y = y * 10 + c;
    else if (i < 7) mo = mo * 10 + c;
    else if (i < 10) d = d * 10 + c;
    else if (i < 13) h = h * 10 + c;
    else if (i < 16) mi = mi * 10 + c;
    else if (i < 19) s = s * 10 + c;
    else ms = ms * 10 + c;
  }
  if (y < 100 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return NaN;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (d > (mo === 2 && leap ? 29 : DAYS_IN_MONTH[mo - 1])) return NaN;
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

export function parseTimestamp(value: unknown): number | null {
  let ms: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Some harnesses (Codex) log UNIX seconds; interpreting them as ms lands
    // near 1970 and corrupts startedAt. Anything below ~1e12 is seconds.
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === "string") {
    const fast = fastIsoUtcMs(value);
    const parsed = Number.isNaN(fast) ? Date.parse(value) : fast;
    if (Number.isFinite(parsed)) ms = parsed;
  }
  // Reject implausible/placeholder timestamps rather than let them pull startedAt down.
  if (ms == null || ms < MIN_PLAUSIBLE_MS) return null;
  return ms;
}

export function jsonPreview(value: unknown, max = 420): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

export function summarizeToolDurations(
  durationMs: Map<string, number[]>,
  toolErrorsByName: Map<string, number>,
  limit = 10,
): LiveSessionToolDuration[] {
  return [...durationMs.entries()]
    .map(([name, durations]) => {
      const sorted = durations.slice().sort((a, b) => a - b);
      return {
        name,
        count: sorted.length,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: sorted[sorted.length - 1] ?? 0,
        errors: toolErrorsByName.get(name) ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function metricMissing(source: MetricSource): boolean {
  return source === "missing" || source === "malformed";
}

export function increment(map: Map<string, number>, key: string | null | undefined, amount = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

export function incrementRecord(record: Record<string, number>, key: string | null | undefined, amount = 1): void {
  if (!key) return;
  record[key] = (record[key] ?? 0) + amount;
}

function normalizeModelValue(model: unknown): string | null {
  if (typeof model !== "string") return null;
  const normalized = model.trim();
  return isPlaceholderModel(normalized) ? null : normalized;
}

export function coalesceModel(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeModelValue(value);
    if (normalized) return normalized;
  }
  return null;
}

export function ensureModelUsage(map: Map<string, LiveModelUsage>, model: unknown): LiveModelUsage | null {
  // Keys are inserted as normalizeModelValue output and normalize is
  // idempotent on them, so a raw string that exactly matches an existing key
  // resolves to the same entry the normalized path would — skip the per-call
  // trim/placeholder work for the overwhelmingly common repeat model.
  if (typeof model === "string") {
    const hit = map.get(model);
    if (hit) return hit;
  }
  const normalized = normalizeModelValue(model);
  if (!normalized) return null;
  let usage = map.get(normalized);
  if (!usage) {
    usage = {
      model: normalized,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      toolCalls: 0,
      toolErrors: 0,
    };
    map.set(normalized, usage);
  }
  return usage;
}

export function modelUsageVolume(usage: LiveModelUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
}

export function estimateModelUsageCost(rows: LiveModelUsage[]): number | null {
  let total = 0;
  let priced = false;
  for (const row of rows) {
    if (modelUsageVolume(row) === 0) continue;
    const estimate = estimateCostUsd(row.model, {
      input: row.inputTokens,
      output: row.outputTokens,
      cacheRead: row.cacheReadTokens,
      cacheCreate: row.cacheCreateTokens,
    });
    // A partial mixed-model estimate is more misleading than a missing cost.
    if (estimate == null) return null;
    total += estimate;
    priced = true;
  }
  return priced ? total : null;
}

export function attributedModelUsage(session: LiveSession): LiveModelUsage[] {
  const fallback = (): LiveModelUsage[] => [{
    model: session.model ?? "unknown",
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheCreateTokens: session.cacheCreateTokens,
    toolCalls: session.toolCalls,
    toolErrors: session.toolErrors,
  }];
  if (!session.modelUsage?.length) return fallback();

  const rows = session.modelUsage.map((usage) => ({ ...usage }));
  const sums = rows.reduce((total, usage) => ({
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
    cacheCreateTokens: total.cacheCreateTokens + usage.cacheCreateTokens,
    toolCalls: total.toolCalls + usage.toolCalls,
    toolErrors: total.toolErrors + usage.toolErrors,
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, toolCalls: 0, toolErrors: 0 });
  const expected = {
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheCreateTokens: session.cacheCreateTokens,
    toolCalls: session.toolCalls,
    toolErrors: session.toolErrors,
  };
  const fields = Object.keys(expected) as Array<keyof typeof expected>;
  if (fields.some((field) => sums[field] > expected[field])) return fallback();

  const primary = rows.find((usage) => usage.model === session.model) ?? rows[0];
  for (const field of fields) primary[field] += expected[field] - sums[field];
  return rows;
}

export function modelUsageCosts(session: LiveSession, rows: LiveModelUsage[]): number[] {
  if (session.costUsd <= 0) return rows.map(() => 0);
  const estimates = rows.map((row) => estimateCostUsd(row.model, {
    input: row.inputTokens,
    output: row.outputTokens,
    cacheRead: row.cacheReadTokens,
    cacheCreate: row.cacheCreateTokens,
  }) ?? 0);
  let weights = estimates;
  let weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) {
    weights = rows.map((row) => modelUsageVolume(row) || row.toolCalls || 0);
    weightTotal = weights.reduce((sum, value) => sum + value, 0);
  }
  if (weightTotal <= 0) return rows.map((_, index) => index === 0 ? session.costUsd : 0);
  return weights.map((weight) => session.costUsd * weight / weightTotal);
}

export function topEntries(map: Map<string, number>, limit: number): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

export function extractFilePaths(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    // Every alternation below requires one of these four substrings
    // ("/private/tmp/" contains "/tmp/", "../" contains "./"), so bailing on
    // their absence skips the regex for the common no-path string leaf.
    if (
      value.indexOf("/Users/") < 0 && value.indexOf("/home/") < 0 &&
      value.indexOf("/tmp/") < 0 && value.indexOf("./") < 0
    ) return out;
    const pathLike = value.match(/(?:\/Users\/[^\s"'<>`]+|\/home\/[^\s"'<>`]+|\/private\/tmp\/[^\s"'<>`]+|\/tmp\/[^\s"'<>`]+|\.{1,2}\/[A-Za-z0-9._/-]+)/g) ?? [];
    for (const candidate of pathLike) {
      const cleaned = candidate.replace(/[),.;:]+$/, "");
      if (cleaned.includes("://") || cleaned.startsWith("//")) continue;
      if (/[\[\]\^\?\*\|\\`]/.test(cleaned)) continue;
      if (cleaned.includes("/") && !cleaned.endsWith("/")) out.add(cleaned);
    }
  } else if (Array.isArray(value) || (value && typeof value === "object")) {
    // Explicit-stack DFS, not recursion: a parseable-but-deeply-nested payload
    // (fuzz: 5,000 nested arrays) overflowed the call stack here, and the
    // parser's outer catch then dropped the WHOLE session as a null tombstone.
    // Consumers sort the Set, so traversal order is not observable.
    const pending: unknown[] = [value];
    while (pending.length > 0) {
      const current = pending.pop();
      if (typeof current === "string") {
        extractFilePaths(current, out);
      } else if (Array.isArray(current)) {
        for (const item of current) pending.push(item);
      } else if (current && typeof current === "object") {
        for (const item of Object.values(current as Record<string, unknown>)) pending.push(item);
      }
    }
  }
  return out;
}

/**
 * Stream a file's lines without ever materializing the whole file as one string.
 * `fs.readFileSync(file, "utf8")` throws ERR_STRING_TOO_LONG on files over ~512MB
 * — real agent sessions get that big — which silently dropped the largest (and
 * most token-heavy) sessions from every total. Reads in bounded chunks with a
 * StringDecoder so multibyte characters spanning a chunk boundary aren't
 * corrupted, holding at most one chunk + one line in memory.
 */
export function* readFileLines(file: string): Generator<string> {
  const CHUNK = 1 << 20; // 1 MiB
  const fd = fs.openSync(file, "r");
  const decoder = new StringDecoder("utf8");
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let leftover = "";
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      leftover += decoder.write(buf.subarray(0, n));
      // Cursor scan: re-slicing leftover per line is O(lines × chunk) in
      // allocations; one tail slice per chunk yields the same line sequence.
      let start = 0;
      let idx: number;
      while ((idx = leftover.indexOf("\n", start)) >= 0) {
        yield leftover.slice(start, idx);
        start = idx + 1;
      }
      if (start > 0) leftover = leftover.slice(start);
    }
    leftover += decoder.end();
    if (leftover.length) yield leftover;
  } finally {
    fs.closeSync(fd);
  }
}

export function buildWarnings(
  sources: LiveMetricSources,
  malformedLineCount: number,
  lineCount: number,
  hookErrors: number,
  sawResult: boolean,
  model?: string | null,
  turnInferenceSource?: "messageCount" | "userMessages" | "turnContext",
): string[] {
  const warnings: string[] = [];
  if (sources.model === "missing") warnings.push("model missing from trace");
  if (sources.model === "inferred") warnings.push(`model inferred as ${model ?? "unknown"} from the harness descriptor's liveTrace default`);
  if (sources.tokens === "missing") warnings.push("token usage missing from trace");
  if (sources.cost === "missing") warnings.push("cost missing from trace");
  if (sources.duration === "missing") warnings.push("duration missing from trace");
  if (sources.turns === "inferred") {
    const label = turnInferenceSource === "userMessages"
      ? "user messages"
      : turnInferenceSource === "turnContext"
        ? "turn context records"
        : "messageCount";
    warnings.push(`turn count inferred from ${label}`);
  }
  if (!sawResult) warnings.push("no final result event found");
  if (malformedLineCount > 0) warnings.push(`${malformedLineCount}/${lineCount} malformed line(s) skipped`);
  if (hookErrors > 0) warnings.push(`${hookErrors} hook error(s) reported`);
  return warnings;
}

export function coalesceString(value: unknown, fallback: string | null): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function numericOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off", ""].includes(normalized)) return false;
  }
  return null;
}

/**
 * Cap usageSegments at a bounded count. One segment is pushed per usage
 * record, so a single huge session produced 4,100 segments (~595KB of JSON)
 * that were persisted to the cache and shipped whole in /api/live responses.
 * Halving by merging adjacent pairs (deltas summed, the later point's
 * cumulative snapshot kept) preserves the curve at sub-pixel resolution.
 */
export const MAX_USAGE_SEGMENTS = 500;

export function downsampleUsageSegments(segments: LiveUsageSegment[]): LiveUsageSegment[] {
  let out = segments;
  while (out.length > MAX_USAGE_SEGMENTS) {
    const merged: LiveUsageSegment[] = [];
    for (let i = 0; i + 1 < out.length; i += 2) {
      const a = out[i];
      const b = out[i + 1];
      merged.push({
        atMs: b.atMs,
        cumulativeInput: b.cumulativeInput,
        cumulativeOutput: b.cumulativeOutput,
        deltaInput: a.deltaInput + b.deltaInput,
        deltaOutput: a.deltaOutput + b.deltaOutput,
        outTokPerSec: b.outTokPerSec,
      });
    }
    if (out.length % 2 === 1) merged.push(out[out.length - 1]);
    out = merged;
  }
  return out;
}

export function buildUsageSegments(startedAt: number, durationMs: number, inputTokens: number, outputTokens: number): LiveUsageSegment[] {
  if (inputTokens <= 0 && outputTokens <= 0) return [];
  const elapsedSec = Math.max(durationMs / 1000, 0.001);
  return [{
    atMs: startedAt + Math.max(durationMs, 0),
    cumulativeInput: inputTokens,
    cumulativeOutput: outputTokens,
    deltaInput: inputTokens,
    deltaOutput: outputTokens,
    outTokPerSec: outputTokens / elapsedSec,
  }];
}

export function scoreQuality(sources: LiveMetricSources, malformedLineCount: number, lineCount: number, hookErrors: number, toolErrorRate: number): number {
  let score = 100;
  if (metricMissing(sources.model)) score -= 12;
  if (metricMissing(sources.tokens)) score -= 14;
  if (metricMissing(sources.cost)) score -= 8;
  if (metricMissing(sources.duration)) score -= 12;
  if (sources.turns === "missing") score -= 8;
  if (sources.turns === "inferred") score -= 3;
  if (malformedLineCount > 0) score -= Math.min(20, Math.ceil((malformedLineCount / Math.max(lineCount, 1)) * 100));
  if (hookErrors > 0) score -= Math.min(12, hookErrors * 2);
  if (toolErrorRate > 0.25) score -= 6;
  return Math.max(0, Math.min(100, score));
}
