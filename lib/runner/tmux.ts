import { spawn } from "node:child_process";
import { rm, writeFile, readFile } from "node:fs/promises";
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
    const logPath = path.join(ctx.workdir, `.openeval-tmux-${session}.jsonl`);
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

    let lastCapture = "";
    const readCapture = async () => {
      const output = await readFile(logPath, "utf8").catch(() => "");
      return output.slice(0, 8 * 1024 * 1024);
    };
    const deadline = startedAt + ctx.timeoutMs;
    let cancelled = false;
    while (Date.now() < deadline) {
      // Cancellation: stop polling and let the kill-session below tear down
      // the pane's process tree (tmux HUPs pane processes on session kill).
      if (ctx.signal?.aborted) {
        cancelled = true;
        break;
      }
      const capture = await readCapture();
      if (capture !== lastCapture) {
        const diff = paneCaptureDelta(lastCapture, capture);
        lastCapture = capture;
        emit(ctx, { kind: "log", stream: "stdout", chunk: diff, at: Date.now() });
        for (const line of diff.split("\n")) {
          for (const ev of adapter.parseLine(line, acc)) emit(ctx, ev);
        }
      }

      // No shell here: "2>/dev/null" would be passed as a literal arg and make
      // `tmux ls` error out, breaking the poll loop on its first iteration.
      const list = await tmux(["ls", "-F", "#{session_name}"]);
      if (!list.stdout.split("\n").includes(session)) break;
      await sleep(400);
    }

    const finalCapture = await readCapture();
    const remaining = paneCaptureDelta(lastCapture, finalCapture);
    if (remaining) emit(ctx, { kind: "log", stream: "stdout", chunk: remaining, at: Date.now() });
    for (const line of remaining.split("\n")) {
      for (const ev of adapter.parseLine(line, acc)) emit(ctx, ev);
    }
    await tmux(["kill-session", "-t", session]).catch(async () => ({ code: 0, stdout: "", stderr: "" }));
    await rm(logPath, { force: true });

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
