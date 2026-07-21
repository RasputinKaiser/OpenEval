import { spawn, type ChildProcess } from "node:child_process";
import { getAdapter } from "../adapters/registry";
import type { ParseAccumulator } from "../adapters/types";
import type { RunnerContext, RunnerResult, TranscriptEntry } from "../types";

export interface SpawnHarnessResult {
  acc: ParseAccumulator;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
}

/** Max bytes retained per stream, so a runaway harness can't OOM the eval. */
export const MAX_RETAINED_BYTES = 8 * 1024 * 1024;

/**
 * How long after a kill to force-resolve the spawn promise if 'close' never
 * fires. Kept above killProcessGroup's SIGTERM→SIGKILL grace (2s) so a process
 * that would exit on the escalation still gets the chance to close naturally.
 */
export const FORCE_RESOLVE_AFTER_KILL_MS = 3000;

/**
 * Kill a detached child and every process it spawned. Escalates: a graceful
 * SIGTERM first, then SIGKILL after `graceMs` if the process is still alive, so
 * well-behaved harnesses can flush and exit cleanly while stuck ones are still
 * force-killed. Safe to call when the process is already gone.
 */
export function killProcessGroup(proc: ChildProcess, graceMs = 2000): void {
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      if (proc.pid) process.kill(-proc.pid, signal);
      else proc.kill(signal);
    } catch {
      try { proc.kill(signal); } catch {}
    }
  };
  signalGroup("SIGTERM");
  const escalation = setTimeout(() => {
    // Only escalate if the process has not already exited.
    if (proc.exitCode == null && proc.signalCode == null) signalGroup("SIGKILL");
  }, graceMs);
  // Don't let the grace timer keep the event loop (or a test) alive.
  escalation.unref?.();
}

// Detached children need an explicit parent-exit cleanup path. Keep the
// registry on globalThis so Next dev HMR does not install duplicate signal
// handlers or lose track of children spawned by an older module instance.
interface ProcessGroupRegistry {
  pids: Set<number>;
  installed: boolean;
}

const processGroupRegistry = (() => {
  const key = "__openevalProcessGroups";
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  if (!root[key]) root[key] = { pids: new Set<number>(), installed: false } satisfies ProcessGroupRegistry;
  return root[key] as ProcessGroupRegistry;
})();

function killRegisteredProcessGroups(): void {
  for (const pid of processGroupRegistry.pids) {
    try { process.kill(-pid, "SIGKILL"); } catch {}
  }
  processGroupRegistry.pids.clear();
}

function ensureParentCleanupHandlers(): void {
  if (processGroupRegistry.installed) return;
  processGroupRegistry.installed = true;
  process.once("exit", killRegisteredProcessGroups);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      killRegisteredProcessGroups();
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
}

export function registerProcessGroup(proc: ChildProcess): () => void {
  if (!proc.pid) return () => {};
  ensureParentCleanupHandlers();
  processGroupRegistry.pids.add(proc.pid);
  return () => { if (proc.pid) processGroupRegistry.pids.delete(proc.pid); };
}

/**
 * Append `chunk` to `current`, capping total length at `max`. Once the cap is
 * reached a single truncation marker is added and the string stops growing.
 * The live line parser still sees every line — only the retained diagnostic
 * copy is bounded.
 */
export function appendCapped(current: string, chunk: string, max = MAX_RETAINED_BYTES): string {
  if (current.length >= max) return current;
  const next = current + chunk;
  if (next.length <= max) return next;
  return next.slice(0, max) + "\n…[output truncated]…";
}

/**
 * Split buffered stdout into complete lines for the parser, returning the
 * trailing fragment. A fragment past `max` (a newline-less stream) is flushed
 * as a line and dropped so the line buffer cannot grow without bound.
 */
export function drainLineBuffer(buf: string, onLine: (line: string) => void, max = MAX_RETAINED_BYTES): string {
  const lines = buf.split("\n");
  let rest = lines.pop() ?? "";
  for (const line of lines) onLine(line);
  if (rest.length > max) {
    onLine(rest);
    rest = "";
  }
  return rest;
}

/**
 * Adapters seed a partial `acc.result` on session-init lines (endedAt: null)
 * so session/model survive a crash; only a terminal result/turn event stamps
 * `endedAt`. A harness that emitted init and then crashed, hung, or was killed
 * must take the runners' failure path — a seeded partial result is evidence,
 * never completion, or a mid-case crash would masquerade as a clean run.
 */
export function isCompleteResult(result: Partial<RunnerResult> | null): result is Partial<RunnerResult> {
  return result != null && result.endedAt != null;
}

export function emptyRunnerResult(): RunnerResult {
  return {
    exitCode: 0,
    durationMs: 0,
    startedAt: Date.now(),
    endedAt: null,
    transcript: [],
    toolCalls: [],
    finalText: "",
    resultText: "",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0,
    stopReason: null,
    sessionId: null,
    model: null,
    isError: false,
    rawJson: null,
    tokenSegments: [],
    toolCallCounts: {},
  };
}

export function spawnHarnessProcess(ctx: RunnerContext, onLine: (line: string, acc: ParseAccumulator) => void): Promise<SpawnHarnessResult> {
  const adapter = getAdapter(ctx.harness);
  const { bin, args, env: extraEnv, stdin } = adapter.buildCommand(ctx);
  const startedAt = Date.now();
  const acc: ParseAccumulator = {
    startedAt,
    transcript: [] as TranscriptEntry[],
    toolCalls: [] as RunnerResult["toolCalls"],
    finalText: "",
    result: null as Partial<RunnerResult> | null,
  };
  let stdout = "";
  let stderr = "";
  let stdoutBuf = "";

  let timedOut = false;
  let aborted = false;

  return new Promise<SpawnHarnessResult>((resolve) => {
    const proc = spawn(bin, args, {
      cwd: ctx.workdir,
      env: { ...process.env, ...extraEnv },
      stdio: [stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
      // Group leader, so a timeout or cancellation can kill agent-spawned children too.
      detached: true,
    });
    const unregisterProcessGroup = registerProcessGroup(proc);

    let settled = false;
    let killForceTimer: ReturnType<typeof setTimeout> | null = null;
    // Belt-and-suspenders: after a kill, 'close' normally resolves the promise,
    // but if it is delayed or never fires (stuck grandchild holding the pipe,
    // lost SIGCHLD) the runner would hang forever. Force-resolve as timed-out.
    const scheduleForceResolve = () => {
      if (killForceTimer || settled) return;
      killForceTimer = setTimeout(() => finish(124), FORCE_RESOLVE_AFTER_KILL_MS);
      killForceTimer.unref?.();
    };

    // Cancellation mirrors the timeout path: kill the whole process group
    // so agent-spawned grandchildren cannot outlive an aborted case.
    const onAbort = () => {
      aborted = true;
      killProcessGroup(proc);
      scheduleForceResolve();
    };
    if (ctx.signal?.aborted) onAbort();
    else ctx.signal?.addEventListener("abort", onAbort, { once: true });
    if (stdin != null && proc.stdin) {
      // A child that exits before reading stdin emits EPIPE on this stream;
      // without a handler that error is unhandled and crashes the eval process.
      proc.stdin.on("error", () => {});
      try { proc.stdin.write(stdin); proc.stdin.end(); } catch {}
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(proc);
      scheduleForceResolve();
    }, ctx.timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout = appendCapped(stdout, text);
      // A throw from onLine (adapter.parseLine → onEvent → synchronous SQLite
      // appendEvent, which can raise SQLITE_BUSY) would otherwise escape this
      // 'data' handler uncaught and abort the whole process, killing every
      // parallel worker. Swallow per-line like the flush path below does.
      stdoutBuf = drainLineBuffer(stdoutBuf + text, (line) => {
        try { onLine(line, acc); } catch {}
      });
    });
    proc.stderr?.on("data", (c: Buffer) => { stderr = appendCapped(stderr, c.toString()); });

    const finish = (exitCode: number) => {
      if (settled) return; // 'error' and 'close' can both fire; flush only once
      settled = true;
      clearTimeout(timer);
      if (killForceTimer) clearTimeout(killForceTimer);
      unregisterProcessGroup();
      ctx.signal?.removeEventListener("abort", onAbort);
      if (stdoutBuf.trim()) {
        try { onLine(stdoutBuf, acc); } catch {}
      }
      resolve({ acc, stdout, stderr, exitCode, durationMs: Date.now() - startedAt, timedOut, aborted });
    };
    proc.on("error", () => finish(2));
    proc.on("close", (code) => finish(code ?? (acc.result?.isError ? 1 : 0)));
  });
}
