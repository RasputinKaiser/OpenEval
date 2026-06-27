import { spawn } from "node:child_process";
import { NCODE_BIN } from "../config";
import { emit, parseStreamLine, type Runner } from "./parse";
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

export class TmuxRunner implements Runner {
  kind = "tmux" as const;

  async run(ctx: RunnerContext): Promise<RunnerResult> {
    const session = `eval-${ctx.caseId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const cmdArgs = [
      "-p",
      "--output-format", "stream-json",
      "--input-format", "text",
      "--permission-mode", ctx.permissionMode,
      "--add-dir", ctx.workdir,
    ];
    if (ctx.model) cmdArgs.push("--model", ctx.model);
    if (ctx.maxTurns > 0) cmdArgs.push("--max-turns", String(ctx.maxTurns));
    cmdArgs.push(...ctx.extraArgs);
    cmdArgs.push(ctx.prompt);

    const ncmd = [NCODE_BIN, ...cmdArgs].map((a) => (a.includes(" ") ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(" ");
    const startedAt = Date.now();
    emit(ctx, { kind: "started", at: startedAt });

    const acc = {
      transcript: [] as TranscriptEntry[],
      toolCalls: [] as RunnerResult["toolCalls"],
      finalText: "",
      result: null as Partial<RunnerResult> | null,
    };

    const newSession = await tmux([
      "new-session", "-d", "-s", session, "-x", "220", "-y", "50",
      "bash -lc " + JSON.stringify(ncmd),
    ], { cwd: ctx.workdir });

    if (newSession.code !== 0) {
      return fail(ctx, acc, startedAt, `tmux new-session failed: ${newSession.stderr}`);
    }

    let lastCapture = "";
    const deadline = startedAt + ctx.timeoutMs;
    while (Date.now() < deadline) {
      const list = await tmux(["ls", "-F", "#{session_name}", "2>/dev/null"]);
      if (!list.stdout.split("\n").includes(session)) break;

      const cap = await tmux(["capture-pane", "-p", "-S", "-", "-E", "-", "-t", session]);
      if (cap.stdout !== lastCapture) {
        const diff = cap.stdout.slice(lastCapture.length);
        lastCapture = cap.stdout;
        emit(ctx, { kind: "log", stream: "stdout", chunk: diff, at: Date.now() });
        for (const line of diff.split("\n")) {
          for (const ev of parseStreamLine(line, acc)) emit(ctx, ev);
        }
      }
      await sleep(400);
    }

    const finalCap = await tmux(["capture-pane", "-p", "-S", "-", "-E", "-", "-t", session]);
    for (const line of finalCap.stdout.split("\n")) {
      for (const ev of parseStreamLine(line, acc)) emit(ctx, ev);
    }
    await tmux(["kill-session", "-t", session]).catch(async () => ({ code: 0, stdout: "", stderr: "" }));

    const durationMs = Date.now() - startedAt;
    const exitCode = acc.result?.isError ? 1 : 0;
    emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode });

    if (acc.result) {
      return { ...acc.result, exitCode, durationMs } as RunnerResult;
    }
    return fail(ctx, acc, startedAt, "tmux session ended without a result event");
  }
}

function fail(
  ctx: RunnerContext,
  acc: { transcript: TranscriptEntry[]; toolCalls: RunnerResult["toolCalls"]; finalText: string; result: Partial<RunnerResult> | null },
  startedAt: number,
  message: string,
): RunnerResult {
  const durationMs = Date.now() - startedAt;
  emit(ctx, { kind: "finished", at: Date.now(), durationMs, exitCode: 1 });
  return {
    exitCode: 1,
    durationMs,
    transcript: acc.transcript,
    toolCalls: acc.toolCalls,
    finalText: acc.finalText || message,
    resultText: message,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0,
    stopReason: null,
    sessionId: null,
    model: acc.result?.model ?? null,
    isError: true,
    rawJson: null,
  };
}