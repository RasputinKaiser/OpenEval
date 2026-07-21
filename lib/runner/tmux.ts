import { spawn, spawnSync } from "node:child_process";
import { rm, writeFile, open, type FileHandle } from "node:fs/promises";
import { rmSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../adapters/registry";
import { resolveDefaultModel } from "../models";
import { normalizeParsedResult } from "./headless";
import { isCompleteResult } from "./spawn";
import { emit, type Runner } from "./parse";
import type { RunnerContext, RunnerResult, TranscriptEntry } from "../types";

function tmux(args: string[], opts?: { cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn("tmux", args, { stdio: ["ignore", "pipe", "pipe"], cwd: opts?.cwd });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.stderr.on("data", (c) => (err += c.toString()));
    p.on("error", () => resolve({ code: 1, stdout: out, stderr: err }));
    p.on("close", (code) => resolve({ code: code ?? 0, stdout: out, stderr: err }));
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Return only terminal text not already present in the previous snapshot. */
export function paneCaptureDelta(previous: string, current: string): string {
  if (!previous) return current;
  if (current.startsWith(previous)) return current.slice(previous.length);
  const maxOverlap = Math.min(previous.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (previous.endsWith(current.slice(0, overlap))) return current.slice(overlap);
  }
  return current;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Cap on how many bytes a single tail read pulls, so one tick can't allocate an unbounded buffer. */
const TAIL_READ_CHUNK = 8 * 1024 * 1024;

/**
 * Streaming tail reader for an append-only log. Tracks a byte offset and reads
 * only the bytes appended since the last call, so polling a growing logfile is
 * O(total) instead of O(n²) (the previous code re-read and re-decoded the whole
 * file every tick). Because reads follow the tail, a completion event at the END
 * of a multi-megabyte session is always observed — the old `slice(0, 8MB)`
 * front-truncation dropped it. A StringDecoder preserves multi-byte UTF-8
 * sequences that straddle a read boundary.
 */
export function makeTailReader(handle: FileHandle, chunkBytes = TAIL_READ_CHUNK) {
  const decoder = new StringDecoder("utf8");
  let offset = 0;
  return {
    /** Read the next appended slice (up to `chunkBytes`); "" when nothing new. */
    async read(): Promise<string> {
      const { size } = await handle.stat();
      if (size <= offset) return "";
      const len = Math.min(size - offset, chunkBytes);
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await handle.read(buf, 0, len, offset);
      if (bytesRead <= 0) return "";
      offset += bytesRead;
      return decoder.write(buf.subarray(0, bytesRead));
    },
    /** Flush any bytes the decoder buffered for an incomplete final sequence. */
    end(): string {
      return decoder.end();
    },
    /** Drain everything appended so far, looping past the per-read cap. */
    async drain(): Promise<string> {
      let all = "";
      for (;;) {
        const next = await this.read();
        if (!next) break;
        all += next;
      }
      return all + this.end();
    },
    get offset() {
      return offset;
    },
  };
}

// tmux daemonizes: its detached server and the agent subtree survive a parent
// crash/restart even though we hold no ChildProcess handle for the session.
// Mirror spawn.ts's process-group registry, but keyed on session name, and tear
// down synchronously (spawnSync) at parent exit — an async kill never runs on
// 'exit'. Kept on globalThis so Next dev HMR reuses one handler set.
interface TmuxSessionRegistry {
  sessions: Map<string, string>; // session name -> logfile to unlink
  installed: boolean;
}

const tmuxSessionRegistry = (() => {
  const key = "__openevalTmuxSessions";
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  if (!root[key]) root[key] = { sessions: new Map<string, string>(), installed: false } satisfies TmuxSessionRegistry;
  return root[key] as TmuxSessionRegistry;
})();

function killRegisteredTmuxSessions(): void {
  for (const [session, logPath] of tmuxSessionRegistry.sessions) {
    try { spawnSync("tmux", ["kill-session", "-t", session], { stdio: "ignore" }); } catch {}
    try { rmSync(logPath, { force: true }); } catch {}
  }
  tmuxSessionRegistry.sessions.clear();
}

function ensureTmuxCleanupHandlers(): void {
  if (tmuxSessionRegistry.installed) return;
  tmuxSessionRegistry.installed = true;
  process.once("exit", killRegisteredTmuxSessions);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      killRegisteredTmuxSessions();
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
}

function registerTmuxSession(session: string, logPath: string): () => void {
  ensureTmuxCleanupHandlers();
  tmuxSessionRegistry.sessions.set(session, logPath);
  return () => { tmuxSessionRegistry.sessions.delete(session); };
}

export class TmuxRunner implements Runner {
  kind = "tmux" as const;

  async run(ctx: RunnerContext): Promise<RunnerResult> {
    const session = `eval-${ctx.caseId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const adapter = getAdapter(ctx.harness);
    const fallbackModel = ctx.model ?? resolveDefaultModel(adapter.id).id ?? null;
    const { bin, args: cmdArgs, env: extraEnv } = adapter.buildCommand(ctx);

    const ncmd = [bin, ...cmdArgs].map((a) => (a.includes(" ") ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(" ");
    const startedAt = Date.now();
    emit(ctx, { kind: "started", at: startedAt });

    const acc = {
      startedAt,
      transcript: [] as TranscriptEntry[],
      toolCalls: [] as RunnerResult["toolCalls"],
      finalText: "",
      result: null as Partial<RunnerResult> | null,
    };

    if (ctx.signal?.aborted) {
      return normalizeParsedResult(fail(ctx, acc, startedAt, "Runner cancelled before the tmux session started"), fallbackModel);
    }

    const envPrefix = Object.entries(extraEnv).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    const shellCmd = (envPrefix ? envPrefix + " " : "") + ncmd;
    // A very short-lived harness can finish before tmux's pane capture is
    // observable. Persist the merged stream from inside the shell so the
    // runner retains result events even when the session disappears quickly.
    // The log lives OUTSIDE ctx.workdir: the workdir is the graded directory,
    // so a file-listing / glob grader must never observe this eval-internal
    // artifact mid-run.
    const logPath = path.join(os.tmpdir(), `openeval-tmux-${session}.jsonl`);
    await writeFile(logPath, "", "utf8");
    const loggedShellCmd = `${shellCmd} 2>&1 | tee ${shellQuote(logPath)}`;
    const newSession = await tmux([
      "new-session", "-d", "-s", session, "-x", "220", "-y", "50",
      "bash -lc " + JSON.stringify(loggedShellCmd),
    ], { cwd: ctx.workdir });

    if (newSession.code !== 0) {
      await rm(logPath, { force: true });
      return fail(ctx, acc, startedAt, `tmux new-session failed: ${newSession.stderr}`);
    }

    // Register for parent-exit teardown as soon as the session is live, so a
    // crash between here and cleanup still reaps the detached tmux server.
    const unregisterSession = registerTmuxSession(session, logPath);

    const handle = await open(logPath, "r").catch(() => null);
    const tailReader = handle ? makeTailReader(handle) : null;
    let lineBuffer = "";
    // Parse only complete lines each tick; a fragment split across a read
    // boundary is held until the newline arrives. The raw appended text is
    // still streamed to the live log verbatim.
    const consume = (delta: string) => {
      if (!delta) return;
      emit(ctx, { kind: "log", stream: "stdout", chunk: delta, at: Date.now() });
      lineBuffer += delta;
      const parts = lineBuffer.split("\n");
      lineBuffer = parts.pop() ?? "";
      for (const line of parts) {
        for (const ev of adapter.parseLine(line, acc)) emit(ctx, ev);
      }
    };
    const flushLineBuffer = () => {
      if (!lineBuffer) return;
      for (const ev of adapter.parseLine(lineBuffer, acc)) emit(ctx, ev);
      lineBuffer = "";
    };

    const deadline = startedAt + ctx.timeoutMs;
    let cancelled = false;
    try {
      while (Date.now() < deadline) {
        // Cancellation: stop polling and let the kill-session below tear down
        // the pane's process tree (tmux HUPs pane processes on session kill).
        if (ctx.signal?.aborted) {
          cancelled = true;
          break;
        }
        if (tailReader) consume(await tailReader.read());

        // No shell here: "2>/dev/null" would be passed as a literal arg and make
        // `tmux ls` error out, breaking the poll loop on its first iteration.
        const list = await tmux(["ls", "-F", "#{session_name}"]);
        if (!list.stdout.split("\n").includes(session)) break;
        await sleep(400);
      }

      // Drain everything the harness appended after the last poll, including a
      // completion event written just before the session ended. Consume one
      // capped chunk at a time so a huge post-poll tail can't be buffered whole.
      if (tailReader) {
        for (;;) {
          const chunk = await tailReader.read();
          if (!chunk) break;
          consume(chunk);
        }
        consume(tailReader.end());
      }
      flushLineBuffer();
    } finally {
      await tmux(["kill-session", "-t", session]).catch(async () => ({ code: 0, stdout: "", stderr: "" }));
      unregisterSession();
      await handle?.close().catch(() => {});
      await rm(logPath, { force: true });
    }

    const durationMs = Date.now() - startedAt;
    const exitCode = acc.result?.isError ? 1 : 0;
    emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode });

    // Same rule as headless: only a terminal result event (endedAt stamped)
    // counts as completion; an init-seeded partial result takes the fail path.
    if (isCompleteResult(acc.result)) {
      const parsed = { ...acc.result, exitCode, durationMs, startedAt, endedAt: startedAt + durationMs } as RunnerResult;
      return normalizeParsedResult(parsed, fallbackModel);
    }
    // Partial pane output stays in acc (transcript/toolCalls) either way.
    const failMsg = cancelled
      ? "Runner cancelled: tmux session killed before a result event"
      : "tmux session ended without a result event";
    return normalizeParsedResult(fail(ctx, acc, startedAt, failMsg), fallbackModel);
  }
}

function fail(
  ctx: RunnerContext,
  acc: { startedAt: number; transcript: TranscriptEntry[]; toolCalls: RunnerResult["toolCalls"]; finalText: string; result: Partial<RunnerResult> | null },
  startedAt: number,
  message: string,
): RunnerResult {
  const durationMs = Date.now() - startedAt;
  emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode: 1 });
  return {
    exitCode: 1,
    durationMs,
    startedAt,
    endedAt: Date.now(),
    transcript: acc.transcript,
    toolCalls: acc.toolCalls,
    // Match headless semantics: synthesized diagnostics never become agent
    // output that a regex grader can accidentally accept.
    finalText: acc.finalText,
    resultText: message,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0,
    stopReason: null,
    sessionId: null,
    model: acc.result?.model ?? null,
    isError: true,
    rawJson: null,
    tokenSegments: [],
    toolCallCounts: {},
  };
}
