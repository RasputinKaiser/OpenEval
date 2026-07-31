# Accuracy audit

`/accuracy` and `npm run audit:accuracy` audit the case-definition proof surface without replaying an agent run. The audit is deliberately conservative:

- `pass` means the declared contract is structurally present and any local script reference supplied to the audit resolves.
- `fail` means a concrete authoring, loader, or path-resolution gap was found.
- `unknown` means a contract exists but runtime, rendered-pixel, judge, or human evidence is not attached to this audit.
- `not_applicable` means the case does not declare that surface.

The surfaces are deterministic tests, solve oracles, known-bad rejection scripts, trace-step graders, visual contracts, LLM judges, and manual review. Declared and verified counts are kept separate; neither is a run pass count.

The route uses the non-strict case loader so malformed case files remain visible as corpus issues instead of silently shrinking the denominator. The CLI keeps its strict behavior for release gates. Oracle references are resolved only below the case category directory, and displayed diagnostics redact absolute or traversal paths.

Visual contracts and LLM judges are `unknown` until a separate run or review receipt supplies runtime evidence. Weak judge backstops remain `fail` because a rubric judge backed only by regex checks can rubber-stamp an answer.
