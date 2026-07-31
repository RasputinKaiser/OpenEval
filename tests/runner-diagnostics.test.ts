import test from "node:test";
import assert from "node:assert/strict";
import { describeHarnessFailure } from "../lib/adapters/diagnostics";
import { describeRunnerFailure } from "../lib/runner/diagnostics";

test("Codex wrapper probe failure is actionable and blocks launch", () => {
  const diagnostic = describeHarnessFailure({
    id: "codex",
    status: "error",
    detail: "ERR_UNKNOWN_FILE_EXTENSION: .vibe-ads-orig",
  });

  assert.equal(diagnostic.level, "error");
  assert.match(diagnostic.title, /cannot start/i);
  assert.match(diagnostic.message, /restore or reinstall/i);
  assert.match(diagnostic.message, /refresh harnesses/i);
});

test("Claude revoked OAuth output tells the operator how to recover and keeps evidence", () => {
  const output = describeRunnerFailure(
    "claude-code",
    "API Error: 401 OAuth access token has been revoked.",
  );

  assert.match(output, /claude login/i);
  assert.match(output, /authentication expired or was revoked/i);
  assert.match(output, /API Error: 401 OAuth access token has been revoked/i);
});

test("ordinary runner diagnostics retain the existing raw error shape", () => {
  assert.equal(
    describeRunnerFailure("ncode", "SECRET_DIAGNOSTIC"),
    "Runner error: SECRET_DIAGNOSTIC",
  );
});
