import fs from "node:fs";
import { readFileLines } from "../live";
import { runJudge, extractJudgeJson } from "../grader/judge";
import { loadJudgments, saveJudgment } from "../live-cache";
import { JUDGE_PROMPT_MARKER } from "./signals";
import type { SessionPoint, Marker } from "./timeline";

/**
 * LLM-judge refinement for session outcomes.
 *
 * The heuristic outcome score (lib/insights/outcome.ts) is deliberately crude —
 * it only sees surface signals like praise or apologies. This pass re-reads a
 * SAMPLE of transcripts (the sessions around each adoption marker, where the
 * timeline's before/after comparison actually draws from, plus an even spread
 * for the overall trend), asks an LLM judge "did this session achieve the
 * user's goal?", and persists the verdicts. Judged scores replace heuristic
 * ones with provenance "judged".
 *
 * Judging is opt-in (a button / API call, never during a page render) and
 * incremental: verdicts are cached per file, so each pass only pays for new
 * sessions. Default judge harness is Codex (JUDGE_HARNESS overrides) — cheap,
 * generous plan limits, and independent from the harness being judged.
 */

export interface JudgeDigest {
  firstUser: string | null;
  laterUsers: string[]; // most recent last
  lastAssistant: string | null;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text: string } => !!b && typeof b === "object" && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string")
    .map((b) => b.text)
    .join(" ");
}

/**
 * Pull just the conversational spine out of a transcript: the user's words and
 * the closing assistant message. Understands the Claude-projects shape
 * (message.content string/blocks) and the Codex shape (event_msg payloads);
 * anything else simply yields an empty digest and is skipped.
 */
export function extractJudgeDigest(file: string): JudgeDigest {
  let firstUser: string | null = null;
  const users: string[] = [];
  let lastAssistant: string | null = null;
  try {
    for (const line of readFileLines(file)) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(line); } catch { continue; }
      const type = obj.type;
      const message = obj.message as { role?: string; content?: unknown } | undefined;
      if (type === "user" && message && !(obj as { isMeta?: boolean }).isMeta) {
        // Tool results also arrive as "user" turns; only keep real text.
        const text = textFromContent(message.content).trim();
        if (text && !text.startsWith("<")) {
          if (firstUser == null) firstUser = text;
          else users.push(text);
        }
      } else if (type === "assistant" && message) {
        const text = textFromContent(message.content).trim();
        if (text) lastAssistant = text;
      } else if (type === "event_msg") {
        const payload = obj.payload as { type?: string; message?: unknown } | undefined;
        if (payload?.type === "user_message" && typeof payload.message === "string" && payload.message.trim()) {
          if (firstUser == null) firstUser = payload.message.trim();
          else users.push(payload.message.trim());
        } else if (payload?.type === "agent_message" && typeof payload.message === "string" && payload.message.trim()) {
          lastAssistant = payload.message.trim();
        }
      }
    }
  } catch {
    // Unreadable file → empty digest; caller skips it.
  }
  return {
    firstUser: firstUser ? clip(firstUser, 600) : null,
    laterUsers: users.slice(-8).map((u) => clip(u, 240)),
    lastAssistant: lastAssistant ? clip(lastAssistant, 400) : null,
  };
}

export function buildJudgePrompt(digest: JudgeDigest, stats: { durationMin: number; toolErrorRate: number }): string {
  const later = digest.laterUsers.length
    ? digest.laterUsers.map((u) => `- ${u}`).join("\n")
    : "(none)";
  return [
    // The marker prefix is load-bearing: parsers use it to recognize (and drop)
    // the judge's own CLI sessions. Keep it the exact first text of the prompt.
    `${JUDGE_PROMPT_MARKER} achieved the user's goal.`,
    'Reply with ONLY a JSON object, no prose: {"score": <number 0..1>, "reasons": [<up to 3 short strings>]}',
    "Scoring: 1.0 = goal clearly achieved and the user seemed satisfied; 0.5 = unclear or mixed; 0.0 = failed or abandoned.",
    "Weigh the user's own later messages most — corrections, repeated asks, and frustration are failure signals; approval and moving to new work are success signals.",
    "",
    `Session stats: ${stats.durationMin.toFixed(0)} min, tool-error rate ${(stats.toolErrorRate * 100).toFixed(0)}%.`,
    "",
    "First user message:",
    `"""${digest.firstUser ?? "(unavailable)"}"""`,
    "",
    "Later user messages (oldest → newest):",
    later,
    "",
    "Final assistant message:",
    `"""${digest.lastAssistant ?? "(unavailable)"}"""`,
  ].join("\n");
}

/**
 * Choose which sessions deserve a judge's attention, most valuable first:
 * the before/after windows of every adoption marker (those sessions decide the
 * impact table), then an even spread over the rest for the overall trend line.
 */
export function selectJudgeSample(points: SessionPoint[], markers: Marker[], alreadyJudged: Set<string>, max: number): SessionPoint[] {
  const chosen: SessionPoint[] = [];
  const seen = new Set<string>();
  const push = (p: SessionPoint) => {
    if (!p.path || seen.has(p.path) || alreadyJudged.has(p.path)) return;
    seen.add(p.path);
    chosen.push(p);
  };

  for (const m of markers) {
    if (m.kind === "model" || m.sessionCount < 3) continue; // mirrors the impact filter
    const before = points.filter((p) => p.at < m.firstSeenAt).slice(-20);
    const after = points.filter((p) => p.at >= m.firstSeenAt).slice(0, 20);
    // Interleave so a small budget still covers both sides of the marker.
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (after[i]) push(after[i]);
      if (chosen.length >= max) return chosen;
      if (before[before.length - 1 - i]) push(before[before.length - 1 - i]);
      if (chosen.length >= max) return chosen;
    }
  }

  const rest = points.filter((p) => p.path && !seen.has(p.path) && !alreadyJudged.has(p.path));
  const remaining = max - chosen.length;
  if (remaining > 0 && rest.length) {
    const step = Math.max(1, Math.floor(rest.length / remaining));
    for (let i = 0; i < rest.length && chosen.length < max; i += step) push(rest[i]);
  }
  return chosen;
}

export interface RefineResult {
  sampled: number;
  judged: number;
  failed: number;
  alreadyJudged: number;
  judge: string;
  /** Most recent failure detail, for surfacing config problems (bad model, missing CLI). */
  lastError: string | null;
}

/**
 * Judge backend order: JUDGE_HARNESS always wins; otherwise prefer OpenRouter
 * when a key is available (free tier — judging shouldn't burn CLI plan quota),
 * falling back to the Codex CLI. "openrouter" is an HTTP backend, not a
 * harness adapter; JUDGE_MODEL picks the model for either.
 */
function resolveJudge(): { harness: string; model?: string; judgeName: string } {
  const harness = process.env.JUDGE_HARNESS || (process.env.OPENROUTER_API_KEY ? "openrouter" : "codex");
  const model = process.env.JUDGE_MODEL
    || (harness === "openrouter" ? "tencent/hy3:free" : undefined)
    // A concrete default model for the Codex judge: a user's `codex` config can
    // default to a model their installed CLI can't run (a real 400 in the wild),
    // and judging must not silently fail on that.
    || (harness === "codex" ? "gpt-5.5" : undefined);
  return { harness, model, judgeName: `${harness}${model ? "/" + model : ""}` };
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the assistant text out of an OpenRouter chat completion. */
export function openRouterContent(json: unknown): string | null {
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}

/**
 * Judge via the OpenRouter HTTP API instead of a local harness CLI. Retries
 * 429s with backoff — free-tier models are aggressively rate-limited and a
 * long queue must degrade to slower, not to failed.
 */
async function runOpenRouterJudge(prompt: string, model: string, timeoutMs: number): Promise<{ ok: boolean; text: string; error?: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, text: "", error: "OPENROUTER_API_KEY not set" };
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(5_000 * 2 ** (attempt - 1)); // 5s, 10s, 20s
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            // Reasoning models think in-band; leave room so the JSON verdict
            // at the end doesn't get truncated away.
            max_tokens: 2000,
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429) { lastError = "429 rate limited"; continue; }
      const json: unknown = await res.json();
      if (!res.ok) return { ok: false, text: "", error: JSON.stringify(json).slice(0, 300) };
      const text = openRouterContent(json);
      if (text) return { ok: true, text };
      lastError = "empty completion";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, text: "", error: lastError };
}

/** Judge one session; persists the verdict on success. Returns an error string on failure. */
async function judgeOne(p: SessionPoint, harness: string, model: string | undefined, judgeName: string, timeoutMs: number): Promise<string | null> {
  if (!p.path) return "session has no file path";
  const digest = extractJudgeDigest(p.path);
  if (!digest.firstUser && !digest.lastAssistant) return "no conversational text extractable";
  try {
    const prompt = buildJudgePrompt(digest, { durationMin: p.durationMin, toolErrorRate: p.toolErrorRate });
    const res = harness === "openrouter"
      ? await runOpenRouterJudge(prompt, model ?? "tencent/hy3:free", timeoutMs)
      : await runJudge({ harness, model, prompt, timeoutMs });
    const parsed = res.ok ? extractJudgeJson(res.text) : null;
    const score = parsed && typeof parsed.score === "number" && Number.isFinite(parsed.score)
      ? Math.max(0, Math.min(1, parsed.score))
      : null;
    if (score == null) return (res.error || res.text || "judge returned no parseable {score}").slice(0, 300);
    const reasons = Array.isArray(parsed!.reasons)
      ? (parsed!.reasons as unknown[]).filter((r): r is string => typeof r === "string").slice(0, 4)
      : [];
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(p.path).mtimeMs; } catch {}
    saveJudgment({
      file: p.path,
      sessionId: p.sessionId,
      mtimeMs, // informational — the verdict stays valid even if the file grows
      score,
      reasons,
      judge: judgeName,
      judgedAt: Date.now(),
    });
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
}

async function runJudgeQueue(
  sample: SessionPoint[],
  concurrency: number,
  timeoutMs: number,
  onEach?: (ok: boolean, error: string | null) => void,
): Promise<{ ok: number; failed: number; lastError: string | null }> {
  const { harness, model, judgeName } = resolveJudge();
  let ok = 0, failed = 0;
  let lastError: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < sample.length) {
      const p = sample[next++];
      const error = await judgeOne(p, harness, model, judgeName, timeoutMs);
      if (error == null) ok++;
      else { failed++; lastError = error; }
      onEach?.(error == null, error);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sample.length) }, worker));
  return { ok, failed, lastError };
}

/**
 * Run one incremental judging pass over up to `max` unjudged sampled sessions.
 * Small concurrency — each judgment is a full CLI invocation.
 */
export async function judgePoints(points: SessionPoint[], markers: Marker[], opts: { max?: number; timeoutMs?: number } = {}): Promise<RefineResult> {
  const max = Math.max(1, Math.min(opts.max ?? 10, 50));
  const judged = loadJudgments();
  const sample = selectJudgeSample(points, markers, new Set(judged.keys()), max);
  const { ok, failed, lastError } = await runJudgeQueue(sample, 2, opts.timeoutMs ?? 90_000);
  return { sampled: sample.length, judged: ok, failed, alreadyJudged: judged.size, judge: resolveJudge().judgeName, lastError };
}

// ---------- Background judge-all job ----------

export interface JudgeJobStatus {
  running: boolean;
  total: number; // sessions queued for this job
  done: number;
  judged: number;
  failed: number;
  judge: string;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
}

/** Singleton per server process — one long judging job at a time. */
let job: JudgeJobStatus = {
  running: false, total: 0, done: 0, judged: 0, failed: 0,
  judge: "", startedAt: null, finishedAt: null, lastError: null,
};

export function judgeJobStatus(): JudgeJobStatus {
  return { ...job };
}

/** Every unjudged session inside a qualifying marker's before/after window. */
export function markerWindowSample(points: SessionPoint[], markers: Marker[], alreadyJudged: Set<string>): SessionPoint[] {
  // No `rest` fill and no cap — this is the full set the impact table draws from.
  return selectJudgeSampleWindowsOnly(points, markers, alreadyJudged);
}

function selectJudgeSampleWindowsOnly(points: SessionPoint[], markers: Marker[], alreadyJudged: Set<string>): SessionPoint[] {
  const chosen: SessionPoint[] = [];
  const seen = new Set<string>();
  for (const m of markers) {
    if (m.kind === "model" || m.sessionCount < 3) continue; // mirrors the impact filter
    const before = points.filter((p) => p.at < m.firstSeenAt).slice(-20);
    const after = points.filter((p) => p.at >= m.firstSeenAt).slice(0, 20);
    for (const p of [...before, ...after]) {
      if (!p.path || seen.has(p.path) || alreadyJudged.has(p.path)) continue;
      seen.add(p.path);
      chosen.push(p);
    }
  }
  return chosen;
}

/**
 * Start judging EVERY unjudged marker-window session in the background
 * (the sessions the impact table actually draws from). Returns immediately;
 * poll judgeJobStatus() for progress. One job at a time; verdicts persist, so
 * an interrupted job resumes where it left off on the next start.
 */
export function startJudgeAll(points: SessionPoint[], markers: Marker[], opts: { cap?: number; timeoutMs?: number } = {}): { started: boolean; status: JudgeJobStatus } {
  if (job.running) return { started: false, status: judgeJobStatus() };
  const judged = loadJudgments();
  const sample = markerWindowSample(points, markers, new Set(judged.keys())).slice(0, Math.min(opts.cap ?? 500, 1000));
  job = {
    running: sample.length > 0,
    total: sample.length,
    done: 0, judged: 0, failed: 0,
    judge: resolveJudge().judgeName,
    startedAt: Date.now(),
    finishedAt: sample.length === 0 ? Date.now() : null,
    lastError: null,
  };
  if (sample.length > 0) {
    void runJudgeQueue(sample, 3, opts.timeoutMs ?? 90_000, (ok, error) => {
      job.done++;
      if (ok) job.judged++;
      else { job.failed++; job.lastError = error; }
      if (job.done >= job.total) { job.running = false; job.finishedAt = Date.now(); }
    }).catch(() => {
      job.running = false;
      job.finishedAt = Date.now();
    });
  }
  return { started: sample.length > 0, status: judgeJobStatus() };
}
