/**
 * Deterministic heuristics that infer "did this go well?" signals from a
 * transcript's own text. Crude by design — these are transparent proxies, not a
 * verdict. They run inside the single-pass parser (cheap) and feed the outcome
 * score. Pure functions so they're unit-testable in isolation.
 */

/**
 * First words of every outcome-judge prompt. CLI-backed judges (codex exec,
 * claude -p) leave their own session files behind in the harness's trace dir;
 * any "session" whose opening user message starts with this is OpenEval
 * grading itself, not the user working — parsers drop it so instrumentation
 * never pollutes collection totals, the timeline, or the search index.
 */
export const JUDGE_PROMPT_MARKER = "You are grading whether an AI coding-agent session";

// Word-boundary matches so "no" doesn't fire inside "nothing", etc.
// Bare determiner-"no" ("no rush", "make sure there are no regressions") and
// bare "works"/"correct" ("explain how login works", "the correct behavior
// should be X") are NEUTRAL grammar, not verdicts — only clearly evaluative
// phrasings may fire, because negative outweighs everything in the score.
const POSITIVE = /\b(?:thanks?|thank you|thankyou|perfect|great|awesome|nice|excellent|beautiful|love it|lgtm|(?:that|it) works|works (?:now|great|perfectly)|exactly|that'?s correct|nailed it|ship it|well done|good job)\b/i;
const NEGATIVE = /(?:^\s*no(?:\s*$|[,.!]|\s+thanks?\b)|\b(?:nope|wrong|incorrect|not right|that's not|thats not|still (?:broken|failing|not|wrong)|doesn'?t work|does not work|didn'?t work|broken|revert|undo|rollback|that broke|you broke|not what i|isn'?t what)\b)/i;
const REPHRASE_LEAD = /^\s*(?:no,|actually,|i meant|i said|to be clear|let me rephrase|what i (?:meant|want)|try again|again,|instead,)/i;
const APOLOGY_FAILURE = /\b(?:sorry|apolog|i was wrong|my mistake|unable to|couldn'?t|could not|failed to|i can'?t|cannot complete|didn'?t work|not able to)\b/i;
// Per-alternative boundaries: a blanket \b(...)\b silently killed "build
// succeeded" (trailing \b inside the word) and ✓/✔ (\b next to a non-word
// char needs a word char beside it — never true after a space).
const TESTS_PASSED = /(?:\ball tests? passed?\b|\btests? pass(?:ing|ed)?\b|\b\d+ pass(?:ing|ed)\b|\bbuild succe(?:eded|ss(?:ful(?:ly)?)?)?\b|✓|✔|\bpassing\b)/i;

export type Sentiment = "positive" | "negative" | "neutral";

/**
 * Classify a user message. Negative wins ties — a "thanks, but that's wrong" is
 * a correction, not praise.
 */
export function classifySentiment(text: string): Sentiment {
  if (!text) return "neutral";
  const neg = NEGATIVE.test(text);
  const pos = POSITIVE.test(text);
  if (neg) return "negative";
  if (pos) return "positive";
  return "neutral";
}

/** Does this user turn look like a re-statement of the previous ask (a struggle signal)? */
export function isRephrase(text: string, prevUserText: string | null): boolean {
  if (!text) return false;
  if (REPHRASE_LEAD.test(text)) return true;
  if (!prevUserText) return false;
  // High token overlap with the previous short-ish message → likely a rephrase.
  const a = tokenSet(text), b = tokenSet(prevUserText);
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const overlap = shared / Math.min(a.size, b.size);
  return overlap >= 0.6;
}

/** Assistant text that reads like an apology or an admission of failure. */
export function looksLikeApologyOrFailure(text: string): boolean {
  return !!text && APOLOGY_FAILURE.test(text);
}

/** Text that indicates verification passed at/near the end of the session. */
export function looksLikeTestsPassed(text: string): boolean {
  return !!text && TESTS_PASSED.test(text);
}

/** For a tool name like `mcp__server__tool`, return "server"; else null. */
export function mcpServerFromTool(toolName: string | undefined): string | null {
  if (!toolName || !toolName.startsWith("mcp__")) return null;
  const parts = toolName.split("__");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2),
  );
}
