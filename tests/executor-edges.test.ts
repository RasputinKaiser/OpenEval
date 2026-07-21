import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { CaseDefinition, RunnerContext, RunnerResult } from "../lib/types";

/**
 * Runner/executor edge hardening (U07):
 *
 * - cancellation kills the whole child process tree (headless group SIGKILL,
 *   tmux kill-session) with no orphaned harness processes;
 * - a runner crash mid-case persists partial output and a terminal case state
 *   (no stranded "running" rows);
 * - ENOSPC/EIO during workdir prep or transcript write resolves to an honest
 *   "error" with the cause in error_msg (injected by monkeypatching the
 *   node:fs/promises seam, never by filling the disk);
 * - the orphan sweep never flips a genuinely live run.
 *
 * Hermetic like tests/executor.test.ts: the harness is this Node executable
 * running a tiny emitter script, registered via a temp descriptor and pinned
 * with OPENEVAL_DEFAULT_HARNESS; executeCase is called with harness=undefined
 * so loadHarnessInfo never probes real CLIs. All cwd-rooted state lands in a
 * mkdtemp root; OPENEVAL_DATA_ROOT + chdir happen BEFORE lib imports.
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-executor-edges-"));
process.env.OPENEVAL_DATA_ROOT = path.join(tmpRoot, "state");
process.env.OPENEVAL_DEFAULT_HARNESS = "edgenode";
process.chdir(tmpRoot);

const emitScript = path.join(tmpRoot, "emit-edges.mjs");
fs.writeFileSync(emitScript, [
  'import { spawn } from "node:child_process";',
  'import fs from "node:fs";',
  'const prompt = process.argv[2] || "";',
  "const line = (o) => console.log(JSON.stringify(o));",
  'line({ type: "system", subtype: "init", session_id: "sess-edge", model: "test-model" });',
  'if (prompt.includes("MODE=crash-mid")) {',
  '  line({ type: "assistant", message: { content: [{ type: "text", text: "partial before crash" }] } });',
  '  console.error("EDGE_CRASH_DIAGNOSTIC: harness died mid-case");',
  "  process.exit(1);",
  '} else if (prompt.includes("MODE=hang")) {',
  '  line({ type: "assistant", message: { content: [{ type: "text", text: "partial before hang" }] } });',
  '  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
  '  fs.writeFileSync("pids.json", JSON.stringify({ parent: process.pid, child: child.pid }));',
  "  setInterval(() => {}, 1000);",
  "} else {",
  '  line({ type: "assistant", message: { content: [{ type: "text", text: "hello world" }] } });',
  '  line({ type: "result", result: "done", duration_ms: 5, num_turns: 1, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 }, is_error: false });',
  "}",
].join("\n"));

const harnessesDir = path.join(tmpRoot, "state", "harnesses");
fs.mkdirSync(harnessesDir, { recursive: true });
fs.writeFileSync(path.join(harnessesDir, "edgenode.harness.json"), JSON.stringify({
  id: "edgenode",
  label: "Edge Node Harness",
  binNames: ["node"],
  defaultBin: process.execPath,
  parser: "claude-stream-json",
  argTemplate: [emitScript, "{prompt}"],
}));

test.after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code !== "ESRCH";
  }
}

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(check(), `timed out waiting for: ${what}`);
}

async function ensureRun(id: string): Promise<void> {
  const db = await import("../lib/db");
  if (!db.getRun(id)) {
    db.insertRun({ id, name: id, status: "running", created_at: Date.now(), ended_at: null, params: { runner: "headless", parallel: 1 }, summary: null });
  }
}

function caseDef(overrides: Partial<CaseDefinition> & { id: string; graders: CaseDefinition["graders"] }): CaseDefinition {
  return {
    name: overrides.id,
    category: "single-tool",
    prompt: "MODE=ok",
    runner: { timeout_seconds: 60 },
    ...overrides,
  } as CaseDefinition;
}

function enospc(syscall: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`ENOSPC: no space left on device, ${syscall}`);
  err.code = "ENOSPC";
  err.syscall = syscall;
  return err;
}

// ---- process-tree kill: timeout and cancellation (headless) ----

test("spawnHarnessProcess timeout SIGKILLs the whole process tree, including grandchildren", async () => {
  const { spawnHarnessProcess } = await import("../lib/runner/spawn");
  const workdir = path.join(tmpRoot, "tree-timeout");
  fs.mkdirSync(workdir, { recursive: true });
  const ctx: RunnerContext = {
    caseId: "tree-timeout", workdir, prompt: "MODE=hang", maxTurns: 1,
    timeoutMs: 1_500, permissionMode: "default", extraArgs: [],
  };
  const result = await spawnHarnessProcess(ctx, () => {});
  assert.equal(result.timedOut, true);
  assert.equal(result.aborted, false);
  const pids = JSON.parse(fs.readFileSync(path.join(workdir, "pids.json"), "utf8"));
  await waitFor(() => !alive(pids.parent) && !alive(pids.child), 5_000, "harness process tree to die after timeout");
});

test("cancelling executeCase kills the harness tree, persists partial output, and lands a terminal error row", async () => {
  const { executeCase } = await import("../lib/executor");
  const { WORKDIRS_DIR, TRANSCRIPTS_DIR } = await import("../lib/config");
  const db = await import("../lib/db");
  await ensureRun("run-edges");
  const def = caseDef({
    id: "edge-cancel",
    prompt: "MODE=hang",
    graders: [{ type: "regex_match", pattern: "partial", source: "final_text" }],
  });
  const controller = new AbortController();
  const pidsPath = path.join(WORKDIRS_DIR, "run-edges", "edge-cancel__s0", "pids.json");
  const done = executeCase("run-edges", def, "headless", 1, undefined, 0, undefined, controller.signal);
  await waitFor(() => fs.existsSync(pidsPath), 10_000, "harness to start and spawn its grandchild");
  const pids = JSON.parse(fs.readFileSync(pidsPath, "utf8"));
  controller.abort();

  const rec = await done;
  assert.equal(rec.status, "error", "a cancelled in-flight case is an infrastructure error, not a pass/fail verdict");
  assert.equal(rec.runner_result?.isError, true);
  assert.match(rec.runner_result?.resultText ?? "", /cancelled/i);
  assert.equal(rec.runner_result?.finalText, "partial before hang", "partial agent output survives cancellation");
  assert.ok((rec.runner_result?.transcript.length ?? 0) >= 1, "partial transcript survives cancellation");
  await waitFor(() => !alive(pids.parent) && !alive(pids.child), 5_000, "no orphaned harness processes after cancel");

  const row = db.getRunCaseBySeq("run-edges", 1);
  assert.equal(row?.status, "error", "no stranded running/grading row");
  assert.ok(row?.ended_at, "terminal row carries ended_at");
  const transcript = fs.readFileSync(path.join(TRANSCRIPTS_DIR, "run-edges_edge-cancel__s0.jsonl"), "utf8");
  assert.match(transcript, /partial before hang/, "partial output is persisted to the transcript file");
});

test("spawnHarnessProcess with an already-aborted signal resolves aborted without leaving a process", async () => {
  const { spawnHarnessProcess } = await import("../lib/runner/spawn");
  const workdir = path.join(tmpRoot, "tree-preabort");
  fs.mkdirSync(workdir, { recursive: true });
  const controller = new AbortController();
  controller.abort();
  const ctx: RunnerContext = {
    caseId: "tree-preabort", workdir, prompt: "MODE=hang", maxTurns: 1,
    timeoutMs: 30_000, permissionMode: "default", extraArgs: [], signal: controller.signal,
  };
  const result = await spawnHarnessProcess(ctx, () => {});
  assert.equal(result.aborted, true);
});

// ---- runner crash mid-case ----

test("a runner crash mid-case persists partial output and a terminal error state", async () => {
  const { executeCase } = await import("../lib/executor");
  const { TRANSCRIPTS_DIR } = await import("../lib/config");
  const db = await import("../lib/db");
  await ensureRun("run-edges");
  const def = caseDef({
    id: "edge-crash",
    prompt: "MODE=crash-mid",
    graders: [{ type: "regex_match", pattern: "partial before crash", source: "final_text" }],
  });
  const rec = await executeCase("run-edges", def, "headless", 2, undefined, 0, undefined);
  assert.equal(rec.status, "error");
  assert.equal(rec.runner_result?.isError, true);
  assert.equal(rec.runner_result?.finalText, "partial before crash", "partial agent text is preserved");
  assert.ok((rec.runner_result?.transcript.length ?? 0) >= 1, "partial transcript is preserved");
  assert.ok(rec.error_msg?.includes("EDGE_CRASH_DIAGNOSTIC"), `error_msg carries the crash cause: ${rec.error_msg}`);
  assert.equal(db.getRunCaseBySeq("run-edges", 2)?.status, "error", "no stranded running row");
  const transcript = fs.readFileSync(path.join(TRANSCRIPTS_DIR, "run-edges_edge-crash__s0.jsonl"), "utf8");
  assert.match(transcript, /partial before crash/, "partial output reached the transcript file");
});

test("an unknown harness id lands a terminal error row instead of throwing a stranded running row", async () => {
  const { executeCase } = await import("../lib/executor");
  const db = await import("../lib/db");
  await ensureRun("run-edges");
  const def = caseDef({ id: "edge-unknown-harness", graders: [{ type: "regex_match", pattern: "hello", source: "final_text" }] });
  const rec = await executeCase("run-edges", def, "headless", 3, undefined, 0, "no-such-harness");
  assert.equal(rec.status, "error");
  assert.match(rec.error_msg ?? "", /Case setup failed/);
  assert.match(rec.error_msg ?? "", /Unknown harness/);
  assert.equal(db.getRunCaseBySeq("run-edges", 3)?.status, "error");
});

// ---- ENOSPC/EIO honesty (injected via the node:fs/promises seam) ----

test("ENOSPC during workdir prep resolves to an honest error with the cause in error_msg", async () => {
  const fixture = path.join(tmpRoot, "fixtures", "enospc-fixture");
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, "file.txt"), "fixture content\n");

  const { executeCase } = await import("../lib/executor");
  const db = await import("../lib/db");
  await ensureRun("run-edges");
  const def = caseDef({
    id: "edge-enospc-prep",
    setup: { type: "fixture", fixture: "enospc-fixture" },
    graders: [{ type: "file_exists", path: "file.txt" }],
  });

  const realCopyFile = fsp.copyFile;
  (fsp as { copyFile: typeof fsp.copyFile }).copyFile = () => Promise.reject(enospc("copyfile"));
  let rec;
  try {
    rec = await executeCase("run-edges", def, "headless", 4, undefined, 0, undefined);
  } finally {
    (fsp as { copyFile: typeof fsp.copyFile }).copyFile = realCopyFile;
  }
  assert.equal(rec.status, "error");
  assert.match(rec.error_msg ?? "", /Workdir preparation failed/);
  assert.match(rec.error_msg ?? "", /ENOSPC/);
  assert.equal(db.getRunCaseBySeq("run-edges", 4)?.status, "error", "prep failure still lands a terminal row");
});

test("ENOSPC during transcript write turns a would-be pass into an honest error with the cause", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-edges");
  const def = caseDef({
    id: "edge-enospc-transcript",
    graders: [{ type: "regex_match", pattern: "hello", source: "final_text" }],
  });

  const realAppendFile = fsp.appendFile;
  (fsp as { appendFile: typeof fsp.appendFile }).appendFile = () => Promise.reject(enospc("write"));
  let rec;
  try {
    rec = await executeCase("run-edges", def, "headless", 5, undefined, 0, undefined);
  } finally {
    (fsp as { appendFile: typeof fsp.appendFile }).appendFile = realAppendFile;
  }
  assert.equal(rec.evaluation?.passed, true, "graders themselves passed");
  assert.equal(rec.status, "error", "a pass without persisted evidence is not a pass");
  assert.match(rec.error_msg ?? "", /Transcript write failed/);
  assert.match(rec.error_msg ?? "", /ENOSPC/);
});

test("a genuine agent failure is not masked by a concurrent transcript write failure", async () => {
  const { executeCase } = await import("../lib/executor");
  await ensureRun("run-edges");
  const def = caseDef({
    id: "edge-enospc-agent-fail",
    graders: [{ type: "regex_match", pattern: "definitely absent output", source: "final_text" }],
  });

  const realAppendFile = fsp.appendFile;
  (fsp as { appendFile: typeof fsp.appendFile }).appendFile = () => Promise.reject(enospc("write"));
  let rec;
  try {
    rec = await executeCase("run-edges", def, "headless", 6, undefined, 0, undefined);
  } finally {
    (fsp as { appendFile: typeof fsp.appendFile }).appendFile = realAppendFile;
  }
  assert.equal(rec.status, "failed", "error-vs-failed precedence: real agent evidence wins");
  assert.match(rec.error_msg ?? "", /Transcript write failed/, "the infrastructure cause is still recorded");
});

// ---- harden-executor: robustness regressions ----

test("transcriptToText coerces a non-string tool_result content instead of throwing", async () => {
  // transcriptToText is exported and grades transcripts from ANY source. The
  // built-in stream-json parser coerces tool_result.content to a string
  // upstream, but a descriptor/custom adapter (or an externally reconstructed
  // transcript) can hand it a structured block. The type says `content: string`
  // yet the unguarded `.slice()` used to throw on a non-string and turn a
  // gradeable run into a spurious "Grader threw" error.
  const { transcriptToText } = await import("../lib/executor");
  const runner = {
    transcript: [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: { path: "a" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "structured" }] as unknown as string }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: 42 as unknown as string }] },
    ],
  } as unknown as RunnerResult;

  let text = "";
  assert.doesNotThrow(() => { text = transcriptToText(runner); });
  assert.match(text, /TOOL_USE\(read\)/);
  assert.match(text, /structured/, "structured content is JSON-stringified into the text");
  assert.match(text, /TOOL_RESULT\(t2\): 42/, "numeric content is coerced, not dropped");
});

test("prepareWorkdir git-clone is async and honors an AbortSignal instead of blocking uncancellably", async () => {
  const { prepareWorkdir } = await import("../lib/executor");
  // A real source repo to clone — proves the clone would otherwise succeed, so
  // the rejection is the signal doing its job, not a broken repo.
  const srcRepo = await fsp.mkdtemp(path.join(os.tmpdir(), "openeval-clone-src-"));
  fs.writeFileSync(path.join(srcRepo, "file.txt"), "content\n");
  execFileSync("git", ["init", "-q"], { cwd: srcRepo });
  execFileSync("git", ["add", "-A"], { cwd: srcRepo });
  execFileSync("git", ["-c", "user.email=eval@local", "-c", "user.name=eval", "commit", "-q", "-m", "seed"], { cwd: srcRepo });

  const controller = new AbortController();
  controller.abort();
  const def = caseDef({ id: "edge-clone-abort", setup: { type: "git-clone", repo: srcRepo }, graders: [{ type: "manual" }] });
  // With the old synchronous execFileSync the signal was ignored and the clone
  // completed regardless; this must now reject as a cancelled/handled clone.
  await assert.rejects(
    prepareWorkdir("run-edges", def.id, def, 0, controller.signal),
    "an aborted signal must interrupt the git clone",
  );
  await fsp.rm(srcRepo, { recursive: true, force: true }).catch(() => {});
});

test("an appendEvent (SQLite) throw on the runner hot path does not abort the in-flight case", async () => {
  const { executeCase } = await import("../lib/executor");
  const db = await import("../lib/db");
  await ensureRun("run-edges");

  // Inject the fault at the SQLite seam (better-sqlite3 handle), mirroring a
  // transient SQLITE_BUSY/serialization error on the events insert that
  // appendEvent runs from the onEvent hot path. Only the hot-path event kinds
  // (bound as the 3rd param of the events INSERT) throw; the unguarded
  // lifecycle events (case_started/case_grading/case_finished) pass through, so
  // this test isolates the onEvent guard specifically.
  const hotKinds = new Set(["tool_use", "tool_result", "assistant_message"]);
  const handle = db.getDb();
  const realPrepare = handle.prepare.bind(handle);
  (handle as { prepare: typeof handle.prepare }).prepare = ((sql: string) => {
    const stmt = realPrepare(sql);
    if (typeof sql === "string" && sql.includes("INSERT INTO events")) {
      const realRun = stmt.run.bind(stmt);
      (stmt as { run: typeof stmt.run }).run = ((...args: unknown[]) => {
        if (hotKinds.has(args[2] as string)) throw new Error("SQLITE_BUSY: database is locked");
        return realRun(...(args as Parameters<typeof stmt.run>));
      }) as typeof stmt.run;
    }
    return stmt;
  }) as typeof handle.prepare;
  let rec;
  try {
    const def = caseDef({
      id: "edge-appendevent-throw",
      graders: [{ type: "regex_match", pattern: "hello world", source: "final_text" }],
    });
    rec = await executeCase("run-edges", def, "headless", 21, undefined, 0, undefined);
  } finally {
    (handle as { prepare: typeof handle.prepare }).prepare = realPrepare;
  }
  assert.equal(rec.status, "passed", "a swallowed hot-path event write must not fail the case");
});

// ---- orphan sweep liveness guard ----

test("sweepOrphanRuns never flips a run that still has a live in-process loop", async () => {
  const { sweepOrphanRuns } = await import("../lib/run");
  const db = await import("../lib/db");
  const runId = "edge-live-run";
  const staleCreatedAt = Date.now() - 11 * 60 * 1000; // past the 10-minute threshold
  db.insertRun({ id: runId, name: runId, status: "running", created_at: staleCreatedAt, ended_at: null, params: { runner: "headless", parallel: 1 }, summary: null });
  db.insertRunCase({
    id: "edge-live-case", run_id: runId, case_id: "c1", case_name: "c1", category: "single-tool",
    status: "running", started_at: staleCreatedAt, ended_at: null, workdir_path: "", transcript_path: null,
    runner_kind: "headless", runner_result: null, grader_result: null, evaluation: null,
    budget_exceeded: false, error_msg: null,
    case_def: { id: "c1", name: "c1", category: "single-tool", prompt: "p", graders: [{ type: "manual" }] } as CaseDefinition,
    seq: 1, sample: 0,
  });

  // Event-stale but LIVE (a loop is driving it): must not be swept.
  assert.equal(sweepOrphanRuns(() => true), 0);
  assert.equal(db.getRun(runId)?.status, "running");
  assert.equal(db.listRunCases(runId)[0]?.status, "running");

  // Same run with no live loop: swept to aborted with terminal cases.
  assert.equal(sweepOrphanRuns(() => false), 1);
  assert.equal(db.getRun(runId)?.status, "aborted");
  assert.equal(db.listRunCases(runId)[0]?.status, "error");
});

// ---- tmux cancellation ----

test("cancelling a tmux run kills the session and its harness process, keeping the error honest", async (t) => {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
  } catch {
    t.skip("tmux is not installed");
    return;
  }
  const { TmuxRunner } = await import("../lib/runner/tmux");
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "openeval-tmux-cancel-"));
  const script = path.join(workdir, "fake-ncode");
  await fsp.writeFile(script, `#!/bin/sh
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"tmux-cancel"}'
echo $$ > pid.txt
sleep 60
`);
  await fsp.chmod(script, 0o755);
  const previous = process.env.NCODE_BIN;
  process.env.NCODE_BIN = script;
  const controller = new AbortController();
  try {
    const ctx: RunnerContext = {
      caseId: "tmux-cancel", workdir, prompt: "hang forever", maxTurns: 1,
      timeoutMs: 30_000, permissionMode: "default", extraArgs: [], harness: "ncode",
      signal: controller.signal,
    };
    const done = new TmuxRunner().run(ctx);
    const pidPath = path.join(workdir, "pid.txt");
    await waitFor(() => fs.existsSync(pidPath) && fs.readFileSync(pidPath, "utf8").trim().length > 0, 10_000, "tmux harness to start");
    const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
    controller.abort();

    const result = await done;
    assert.equal(result.isError, true);
    assert.match(result.resultText, /cancelled/i);
    await waitFor(() => !alive(pid), 5_000, "tmux harness process to die after kill-session");
    let sessions: string[] = [];
    try {
      sessions = execFileSync("tmux", ["ls", "-F", "#{session_name}"], { encoding: "utf8" }).split("\n");
    } catch {
      // `tmux ls` exits nonzero when no server/sessions exist — that is "none".
    }
    assert.ok(!sessions.some((s) => s.startsWith("eval-tmux-cancel-")), "no orphaned tmux session");
  } finally {
    if (previous == null) delete process.env.NCODE_BIN; else process.env.NCODE_BIN = previous;
    await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
});
