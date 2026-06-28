#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { loadCases } from '../cases';
import { prepareWorkdir } from '../executor';
import { runGrader, evaluate } from '../grader';
import { getDb } from '../db';
import type { RunnerResult } from '../types';

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

function runShell(cmd: string, cwd: string, timeoutMs = 30_000) {
  try {
    execSync(cmd, { cwd, stdio: 'pipe', timeout: timeoutMs });
    return { code: 0, stdout: '', stderr: '' };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
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
    const out = execSync('command -v ' + JSON.stringify(name), { stdio: 'pipe', timeout: 5_000 }).toString().trim();
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

async function runChecks(json: boolean, verbose: boolean): Promise<Check[]> {
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

  const bin = process.env.NCODE_BIN || 'ncode';
  const resolved = resolveBinary(bin);
  if (!resolved) {
    record('ncode binary callable', 'skip', 'binary not found: ' + bin);
  } else {
    try {
      execSync(resolved + ' --version', { stdio: 'pipe', timeout: 10_000 });
      record('ncode binary callable', 'pass', resolved);
    } catch (e) {
      record('ncode binary callable', 'fail', errorMessage(e));
    }
  }

  const tmpRun = 'selftest-' + Date.now().toString(36);
  let pass = 0, fail = 0, skip = 0;

  if (!json) {
    console.log('Self-test: ' + cases.length + ' cases');
    console.log();
  }

  for (const def of cases) {
    const checkName = 'case:' + def.id;
    const noop = await prepareWorkdir(tmpRun, def.id + '-noop', def, 0);
    const noopRunner = emptyRunnerResult();
    const noopResults = [];
    for (const spec of def.graders) {
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
        execSync('bash ' + JSON.stringify(scriptPath), { cwd: dir, stdio: 'pipe', timeout: 30_000 });
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
    console.log('Self-test result: ' + pass + ' pass, ' + fail + ' fail, ' + skip + ' skip (no oracle)');
  }

  // cleanup
  try {
    fs.rmSync(path.join(os.tmpdir(), '..', 'data', 'workdirs', tmpRun), { recursive: true, force: true });
  } catch (e) {
    warn(e, verbose);
  }
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

  try {
    const checks = await runChecks(json, verbose);
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

main().catch((e) => {
  const json = process.argv.slice(2).includes('--json');
  const verbose = process.argv.slice(2).includes('--verbose') || process.env.DEBUG === '1';
  printError(e, json, verbose);
});
