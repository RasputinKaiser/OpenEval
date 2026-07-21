#!/usr/bin/env tsx
import { installProcessGuards } from '../process-guards';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { loadCases } from '../cases';
import { prepareWorkdir } from '../executor';
import { runGrader, evaluate } from '../grader';
import { getDb } from '../db';
import type { RunnerResult } from '../types';
import { runCodexParserSelfCheck } from '../adapters/codex';
import { makeGenericAdapter, parseGenericJsonlLine } from '../adapters/generic';
import type { HarnessDescriptor } from '../adapters/generic';
import { loadDescriptorAdapters } from '../adapters/loader';
import { getAdapter, listAdapters, getAllDescriptorIssues } from '../adapters/registry';

interface Check {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function printError(e: unknown, json: boolean, verbose: boolean): never {
  const msg = errorMessage(e);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: msg }));
  } else {
    console.error('Error: ' + msg);
  }
  if (verbose && e instanceof Error && e.stack) {
    console.error(e.stack);
  }
  process.exit(1);
}

function emptyRunnerResult(): RunnerResult {
  return {
    exitCode: 0, durationMs: 0, startedAt: Date.now(), endedAt: Date.now(),
    transcript: [], toolCalls: [], finalText: '', resultText: '',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 0, stopReason: null, sessionId: null, model: null, isError: false, rawJson: null,
    tokenSegments: [], toolCallCounts: {},
  };
}

function resolveBinary(name: string): string | null {
  if (path.isAbsolute(name)) {
    return fs.existsSync(name) ? name : null;
  }
  try {
    // Pass the name as a positional arg ($1), not spliced into the script, so a
    // harness-descriptor binName can't inject shell commands.
    const out = execFileSync('sh', ['-c', 'command -v -- "$1"', 'sh', name], { stdio: 'pipe', timeout: 5_000 }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

function warn(e: unknown, verbose: boolean) {
  console.error('Warning: ' + errorMessage(e));
  if (verbose && e instanceof Error && e.stack) {
    console.error(e.stack);
  }
}

async function runChecks(json: boolean, verbose: boolean, withLlmJudge: boolean): Promise<Check[]> {
  const checks: Check[] = [];

  function record(name: string, status: 'pass' | 'fail' | 'skip', detail?: string) {
    checks.push({ name, status, detail });
    if (!json) {
      console.log('  ' + status.toUpperCase() + '  ' + name.padEnd(36) + ' ' + (detail ?? ''));
    }
  }

  try {
    getDb();
    record('db openable', 'pass');
  } catch (e) {
    record('db openable', 'fail', errorMessage(e));
  }

  const cases = await loadCases();
  if (cases.length === 0) {
    record('cases loaded', 'fail', 'loadCases returned no cases');
  } else {
    record('cases loaded', 'pass', cases.length + ' cases');
  }

  const defaultAdapter = getAdapter();
  const bin = defaultAdapter.defaultBin;
  const resolved = resolveBinary(bin);
  const binCheckName = `default harness (${defaultAdapter.id}) binary callable`;
  if (!resolved) {
    record(binCheckName, 'skip', 'binary not found: ' + bin);
  } else {
    try {
      execFileSync(resolved, defaultAdapter.versionArgs ?? ['--version'], { stdio: 'pipe', timeout: 10_000 });
      record(binCheckName, 'pass', resolved);
    } catch (e) {
      record(binCheckName, 'fail', errorMessage(e));
    }
  }

  const descriptorIssues = getAllDescriptorIssues();
  if (descriptorIssues.length === 0) {
    record('harness descriptors valid', 'pass', listAdapters().map((a) => a.id).join(','));
  } else {
    record('harness descriptors valid', 'fail', descriptorIssues.map((i) => `${i.source}: ${i.message}`).join('; '));
  }

  try {
    const pc = runCodexParserSelfCheck();
    record('codex adapter parser (canned stream)', pc.ok ? 'pass' : 'fail', pc.detail);
  } catch (e) {
    record('codex adapter parser (canned stream)', 'fail', errorMessage(e));
  }

  try {
    const descAdapters = loadDescriptorAdapters();
    const ids = descAdapters.map((a) => a.id).join(',') || '(none)';
    record('zero-code descriptor adapters loaded', descAdapters.length > 0 ? 'pass' : 'skip', ids);
  } catch (e) {
    record('zero-code descriptor adapters loaded', 'fail', errorMessage(e));
  }

  try {
    const sampleDesc: HarnessDescriptor = {
      id: '_selftest_generic',
      label: 'Self-test Generic',
      binNames: ['_selftest_bin'],
      output: 'jsonl',
      argTemplate: ['run', '{workdir}'],
      fields: {
        finalText: 'message.text',
        sessionId: 'session_id',
        toolCallName: 'tool.name',
        toolCallId: 'tool.id',
        toolCallInput: 'tool.input',
        toolCallOutput: 'result.output',
        toolCallError: 'result.is_error',
        inputTokens: 'usage.input_tokens',
        outputTokens: 'usage.output_tokens',
        durationMs: 'duration_ms',
        numTurns: 'num_turns',
        stopReason: 'stop_reason',
        isError: 'is_error',
      },
    };
    const acc: any = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: '', result: null };
    const lines = [
      '{"session_id":"s1","message":{"text":"hello world"}}',
      '{"tool":{"id":"t1","name":"shell","input":{"command":["npm","test"]}}}',
      '{"result":{"output":"3 passing","is_error":false}}',
      '{"duration_ms":500,"num_turns":2,"usage":{"input_tokens":10,"output_tokens":5},"stop_reason":"completed","is_error":false}',
    ];
    for (const l of lines) parseGenericJsonlLine(l, acc, sampleDesc);
    const r = acc.result;
    const ok = r && acc.finalText === 'hello world' && r.sessionId === 's1' &&
      acc.toolCalls.length === 1 && acc.toolCalls[0].name === 'shell' && acc.toolCalls[0].output === '3 passing' &&
      r.usage.inputTokens === 10 && r.usage.outputTokens === 5;
    record('generic descriptor parser (canned stream)', ok ? 'pass' : 'fail',
      `final=${acc.finalText === 'hello world'} tool=${acc.toolCalls.length === 1} usage=${!!r && r.usage.inputTokens === 10}`);
    void makeGenericAdapter;
  } catch (e) {
    record('generic descriptor parser (canned stream)', 'fail', errorMessage(e));
  }

  try {
    const judgeAdapter = getAdapter(process.env.JUDGE_HARNESS || 'claude-code');
    const ctx = { caseId: 'judge-test', workdir: '/tmp', prompt: 'grade this', maxTurns: 1, timeoutMs: 1000, permissionMode: 'bypassPermissions' as const, model: process.env.JUDGE_MODEL, extraArgs: [] as string[] };
    const cmd = judgeAdapter.buildCommand(ctx);
    const okJudge = !!cmd.bin && cmd.args.length > 0 && cmd.args.includes('grade this');
    record('rubric_llm judge decoupled (buildCommand via adapter)', okJudge ? 'pass' : 'fail', `harness=${judgeAdapter.id} bin=${cmd.bin} args=${cmd.args.length}`);
  } catch (e) {
    record('rubric_llm judge decoupled (buildCommand via adapter)', 'fail', errorMessage(e));
  }

  const tmpRun = 'selftest-' + Date.now().toString(36);
  let pass = 0, fail = 0, skip = 0, llmSkip = 0;

  if (!json) {
    console.log('Self-test: ' + cases.length + ' cases' + (withLlmJudge ? ' (with LLM judge)' : ''));
    console.log();
  }

  for (const def of cases) {
    const checkName = 'case:' + def.id;

    // Lint: the oracle loop grades an empty transcript and zero tool calls, so
    // step graders and transcript-sourced regexes can never be validated here.
    const unvalidatable = def.graders
      .filter((g) => g.type === 'step' || (g.type === 'regex_match' && g.source === 'transcript'))
      .map((g) => (g.type === 'step' ? 'step' : 'regex_match(transcript)'));
    if (unvalidatable.length > 0) {
      record(checkName + ':oracle-lint', 'skip', 'oracle loop cannot validate: ' + unvalidatable.join(', ') + ' (empty transcript)');
    }

    const noop = await prepareWorkdir(tmpRun, def.id + '-noop', def, 0);
    const noopRunner = emptyRunnerResult();
    const noopResults = [];
    for (const spec of def.graders) {
      if (spec.type === 'rubric_llm' && !withLlmJudge) { llmSkip++; continue; }
      const r = await runGrader(spec, { workdir: noop.dir, runner: noopRunner, transcriptText: '', fixtureSrc: noop.fixtureSrc });
      noopResults.push(r);
    }
    const noopEval = evaluate(noopResults, def.pass_threshold ?? 1);
    const noopMax = def.oracle?.noop_max_score ?? 0;
    if (noopEval.passed || noopEval.passRatio > noopMax) {
      fail++;
      record(checkName, 'fail', 'no-op baseline scored ' + noopEval.passRatio.toFixed(2) + ' (max ' + noopMax + ')');
      continue;
    }

    // Known-bad rejection: each declared known_bad script runs like a solve
    // oracle (its stdout is the bad final text; file-writing scripts populate
    // the workdir) and the graders MUST fail it — a known-bad that passes, or
    // a missing script, is a selftest failure.
    const knownBad = def.oracle?.known_bad ?? [];
    for (let i = 0; i < knownBad.length; i++) {
      const badName = checkName + ':known-bad[' + i + ']';
      const badScript = path.resolve('cases', def.category, knownBad[i]);
      if (!fs.existsSync(badScript)) {
        fail++;
        record(badName, 'fail', 'known_bad script missing: ' + knownBad[i]);
        continue;
      }
      const bad = await prepareWorkdir(tmpRun, def.id + '-bad' + i, def, 0);
      let badStdout = '';
      try {
        badStdout = execFileSync('bash', [badScript], { cwd: bad.dir, stdio: 'pipe', timeout: 30_000 }).toString();
      } catch (e: any) {
        fail++;
        record(badName, 'fail', 'known_bad script errored — ' + (e.stderr?.toString() || e.message || '').slice(0, 300));
        continue;
      }
      const badRunner = emptyRunnerResult();
      if (badStdout.trim()) {
        badRunner.finalText = badStdout.trim();
        badRunner.resultText = badRunner.finalText;
      }
      const badResults = [];
      for (const spec of def.graders) {
        if (spec.type === 'rubric_llm' && !withLlmJudge) continue;
        badResults.push(await runGrader(spec, { workdir: bad.dir, runner: badRunner, transcriptText: '', fixtureSrc: bad.fixtureSrc }));
      }
      if (badResults.length === 0) {
        record(badName, 'skip', 'only rubric_llm graders — needs --with-llm-judge');
        continue;
      }
      const badEval = evaluate(badResults, def.pass_threshold ?? 1);
      if (badEval.passed) {
        fail++;
        record(badName, 'fail', 'known-bad output PASSED graders (score ' + badEval.passRatio.toFixed(2) + ') — graders do not reject this wrong answer');
      } else {
        pass++;
        record(badName, 'pass', 'rejected (score ' + badEval.passRatio.toFixed(2) + ')');
      }
    }

    if (!def.oracle?.solve && !def.oracle?.final_text) {
      skip++;
      record(checkName, 'skip', 'no oracle');
      continue;
    }

    const { dir, fixtureSrc } = await prepareWorkdir(tmpRun, def.id, def, 0);
    const scriptPath = def.oracle.solve ? path.resolve('cases', def.category, def.oracle.solve) : null;
    let oracleOk = true;
    let oracleErr = '';
    if (scriptPath) {
      try {
        execFileSync('bash', [scriptPath], { cwd: dir, stdio: 'pipe', timeout: 30_000 });
      } catch (e: any) {
        oracleOk = false;
        oracleErr = (e.stderr?.toString() || e.message || '').slice(0, 300);
      }
    }
    if (!oracleOk) {
      fail++;
      record(checkName, 'fail', 'oracle script failed — ' + oracleErr);
      continue;
    }
    const runner = emptyRunnerResult();
    if (def.oracle.final_text) {
      runner.finalText = def.oracle.final_text;
      runner.resultText = def.oracle.final_text;
    }
    const transcriptText = '';
    const results = [];
    for (const spec of def.graders) {
      if (spec.type === 'rubric_llm' && !withLlmJudge) { llmSkip++; continue; }
      const r = await runGrader(spec, { workdir: dir, runner, transcriptText, fixtureSrc });
      results.push(r);
    }
    const eval_ = evaluate(results, def.pass_threshold ?? 1);
    const detail = results.map((r) => r.spec.type + ':' + (r.passed ? 'ok' : 'FAIL')).join('  ');
    if (eval_.passed) {
      pass++;
      record(checkName, 'pass', detail);
    } else {
      fail++;
      record(checkName, 'fail', results.filter((r) => !r.passed).map((r) => r.detail).join('; '));
    }
  }

  if (!json) {
    console.log();
    console.log('Self-test result: ' + pass + ' pass, ' + fail + ' fail, ' + skip + ' skip (no oracle)' + (llmSkip > 0 ? ', ' + llmSkip + ' skip (LLM judge — use --with-llm-judge to enable)' : ''));
  }

  // cleanup — workdirs live under <cwd>/data/workdirs (see lib/config.ts)
  try {
    const wd = path.resolve('data', 'workdirs', tmpRun);
    fs.rmSync(wd, { recursive: true, force: true });
  } catch (e) {
    warn(e, verbose);
  }

  return checks;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const verbose = argv.includes('--verbose') || process.env.DEBUG === '1';
  const withLlmJudge = argv.includes('--with-llm-judge');

  try {
    const checks = await runChecks(json, verbose, withLlmJudge);
    const errors = checks.filter((c) => c.status === 'fail').map((c) => c.name + ': ' + (c.detail ?? ''));

    if (json) {
      if (errors.length > 0) {
        console.log(JSON.stringify({ ok: false, errors }));
      } else {
        console.log(JSON.stringify({ ok: true, checks }));
      }
    }

    if (errors.length > 0) {
      process.exit(1);
    }
  } catch (e) {
    printError(e, json, verbose);
  }
}

installProcessGuards();

main().catch((e) => {
  const json = process.argv.slice(2).includes('--json');
  const verbose = process.argv.slice(2).includes('--verbose') || process.env.DEBUG === '1';
  printError(e, json, verbose);
});
