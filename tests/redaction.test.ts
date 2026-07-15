import test from "node:test";
import assert from "node:assert/strict";
import {
  collectPathUsernames,
  compactDisplayPath,
  rampartAvailable,
  redactDisplay,
  redactNamedUsers,
  redactPii,
  redactSecrets,
  redactSensitiveText,
  redactText,
} from "../lib/redaction";

test("redactSecrets masks deterministic credential shapes", () => {
  const privateKey = [
    "-----BEGIN PRIVATE KEY-----",
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
    "-----END PRIVATE KEY-----",
  ].join("\n");

  const cases: Array<[string, string]> = [
    ["openai-key", "sk-abcdefghijklmnopqrstuvwxyz"],
    ["github-token", "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ"],
    ["aws-key", "AKIA1234567890ABCDEF"],
    ["slack-token", "xoxb-1234567890-ABCDEFGHIJK"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature"],
    ["private-key", privateKey],
    ["bearer", "Bearer abcdefghijklmnopqrstuvwxyz123456"],
    ["google-api-key", "AIzaSyA1234567890abcdefghijklmnopqrstuv"],
    ["npm-token", "npm_abcdefghijklmnopqrstuvwxyz0123456789"],
    // Construct at runtime so GitHub push protection does not treat this
    // intentionally fake redaction fixture as a committed access token.
    ["huggingface-token", "hf_" + "abcdefghijklmnopqrstuvwxyzABCDEFGH"],
    ["openrouter-key", `sk-or-v1-${"0123456789abcdef".repeat(4)}`],
  ];

  for (const [kind, secret] of cases) {
    const redacted = redactSecrets(`value=${secret}`);
    assert.match(redacted, new RegExp(`\\[REDACTED:${kind}\\]`));
  }
});

test("redactSecrets leaves near-miss key shapes alone", () => {
  const nearMisses = [
    "AIzaTooShort123",
    "npm_notlongenough",
    "hf_short",
  ];
  for (const value of nearMisses) {
    assert.equal(redactSecrets(value), value);
  }
  // Non-hex body fails the openrouter shape but still trips the generic sk- pattern.
  const nonHex = `sk-or-v1-${"XYZXYZXYZXYZXYZX".repeat(4)}`;
  const redacted = redactSecrets(nonHex);
  assert.doesNotMatch(redacted, /openrouter-key/);
  assert.match(redacted, /\[REDACTED:openai-key\]/);
});

test("redactSecrets is idempotent", () => {
  const text = [
    "sk-abcdefghijklmnopqrstuvwxyz",
    "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
    "Bearer abcdefghijklmnopqrstuvwxyz123456",
  ].join(" ");
  const once = redactSecrets(text);
  const twice = redactSecrets(once);

  assert.equal(twice, once);
});

test("redactSensitiveText preserves existing path behavior", () => {
  assert.equal(redactSensitiveText("/Users/alice/x"), "/Users/[redacted]/x");
  assert.equal(
    redactSensitiveText("prefix -Users-alice-project suffix"),
    "prefix -Users-[redacted]-project suffix",
  );
});

test("redactDisplay composes paths, secrets, and named users", () => {
  const users = new Set(["alicesmith"]);
  const input = "by alicesmith at /Users/alicesmith/x with sk-abcdefghijklmnopqrstuvwxyz";
  assert.equal(
    redactDisplay(input, { usernames: users, secrets: true }),
    "by [redacted] at /Users/[redacted]/x with [REDACTED:openai-key]",
  );
  // without opts it still scrubs path shapes
  assert.equal(redactDisplay("/home/bob/app"), "/home/[redacted]/app");
});

test("redactNamedUsers scrubs bare username tokens but not substrings", () => {
  const users = new Set<string>();
  collectPathUsernames("/Users/alicesmith/projects/x", users);
  assert.deepEqual([...users], ["alicesmith"]);
  assert.equal(
    redactNamedUsers("bundle com.alicesmith.estate, by alicesmith", users),
    "bundle com.[redacted].estate, by [redacted]",
  );
  // substring of a longer word is left alone
  assert.equal(redactNamedUsers("malicesmithy", users), "malicesmithy");
  // short names are too collision-prone to scrub bare
  assert.equal(redactNamedUsers("ian variant", new Set(["ian"])), "ian variant");
});

test("redactSensitiveText redacts munged dirs ending at a slash or end-of-string", () => {
  assert.equal(
    redactSensitiveText("/private/tmp/claude-501/-Users-alice/uuid/scratchpad"),
    "/private/tmp/claude-501/-Users-[redacted]/uuid/scratchpad",
  );
  assert.equal(redactSensitiveText("x -Users-alice"), "x -Users-[redacted]");
  assert.equal(redactSensitiveText("y -home-bob"), "y -home-[redacted]");
});

test("compactDisplayPath collapses a redacted home path", () => {
  assert.equal(compactDisplayPath("/Users/alice/projects/openeval", true), "~/projects/openeval");
});

test("redactText defaults to secrets and paths without pii", async () => {
  const input = [
    "Alice Example lives at 123 Main Street.",
    "token sk-abcdefghijklmnopqrstuvwxyz",
    "path /Users/alice/projects/openeval",
  ].join(" ");

  const redacted = await redactText(input);

  assert.equal(
    redacted,
    "Alice Example lives at 123 Main Street. token [REDACTED:openai-key] path /Users/[redacted]/projects/openeval",
  );
});

test("redactPii is unchanged when Rampart is not installed", async () => {
  const input = "Alice Example lives at 123 Main Street.";
  const available = await rampartAvailable();

  assert.equal(typeof available, "boolean");
  if (!available) {
    assert.equal(await redactPii(input), input);
  }
});
