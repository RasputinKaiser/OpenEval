/**
 * Manual smoke test for the rubric_llm judge chain. NOT run in CI — it hits a
 * real judge backend (OpenRouter or the Codex CLI) and proves the env-driven
 * resolution actually discriminates a good answer from a bad one.
 *
 *   npx tsx scripts/verify-judge.ts
 *
 * Backend order (resolveJudge): JUDGE_HARNESS always wins; otherwise
 * openrouter when OPENROUTER_API_KEY is set, else codex. JUDGE_MODEL overrides
 * the default model for either. No model is pinned here on purpose — the point
 * is to exercise the same chain a stock rubric_llm case would use.
 *
 * Exit codes: 0 = judge discriminated correctly, 1 = judge answered but got it
 * wrong, 2 = judge infrastructure unavailable (nothing proven either way).
 */
import os from "node:os";
import { runGrader } from "../lib/grader";
import { resolveJudge } from "../lib/grader/judge";
import type { RunnerResult, GraderSpec } from "../lib/types";

function mockRunner(finalText: string): RunnerResult {
  return {
    exitCode: 0,
    durationMs: 100,
    startedAt: Date.now(),
    endedAt: Date.now() + 100,
    transcript: [],
    toolCalls: [],
    finalText,
    resultText: finalText,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
    numTurns: 1,
    stopReason: "end_turn",
    sessionId: "verify-judge",
    model: "test",
    isError: false,
    rawJson: null,
    tokenSegments: [],
    toolCallCounts: {},
  };
}

// No judge_harness/judge_model/model overrides: runGrader must fall back to
// the env-driven resolveJudge chain, same as a stock case.
const rubricSpec: Extract<GraderSpec, { type: "rubric_llm" }> = {
  type: "rubric_llm",
  rubric: "The agent must produce a complete FizzBuzz from 1 to 15. Output must contain '1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz'.",
  min_score: 0.7,
};

const goodAnswer = "1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz";
const badAnswer = "1 2 3 4 5";

async function main() {
  const resolved = resolveJudge();
  console.log("=== rubric_llm judge chain smoke test ===\n");
  console.log("Environment:");
  console.log(`  JUDGE_HARNESS      = ${process.env.JUDGE_HARNESS ?? "(unset)"}`);
  console.log(`  JUDGE_MODEL        = ${process.env.JUDGE_MODEL ?? "(unset)"}`);
  console.log(`  OPENROUTER_API_KEY = ${process.env.OPENROUTER_API_KEY ? "(set)" : "(unset)"}`);
  console.log(`Resolved judge: ${resolved.judgeName}\n`);

  console.log("Good answer:");
  const goodResult = await runGrader(rubricSpec, {
    workdir: os.tmpdir(),
    runner: mockRunner(goodAnswer),
    transcriptText: goodAnswer,
  });
  console.log(`  passed: ${goodResult.passed}`);
  console.log(`  score:  ${goodResult.score}`);
  console.log(`  detail: ${goodResult.detail}\n`);

  console.log("Bad answer:");
  const badResult = await runGrader(rubricSpec, {
    workdir: os.tmpdir(),
    runner: mockRunner(badAnswer),
    transcriptText: badAnswer,
  });
  console.log(`  passed: ${badResult.passed}`);
  console.log(`  score:  ${badResult.score}`);
  console.log(`  detail: ${badResult.detail}\n`);

  if (goodResult.infraError || badResult.infraError) {
    console.log("INFRA: judge backend unavailable — this proves nothing about discrimination.");
    console.log("Set JUDGE_HARNESS/JUDGE_MODEL or OPENROUTER_API_KEY and retry.");
    process.exit(2);
  }
  if (goodResult.passed && !badResult.passed) {
    console.log(`PASS: ${resolved.judgeName} correctly distinguished good from bad.`);
  } else {
    console.log(`FAIL: ${resolved.judgeName} did not distinguish correctly.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
