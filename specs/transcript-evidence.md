# Trusted Transcript Evidence and Windowing

## Trusted Identity Resolution

Collection session links and continuation requests use source-qualified identity (`sourceId` plus stable session identity/revision), not a client-supplied absolute path as filesystem authority.

The server resolves that identity against a fresh or validated server-owned inventory of the named parseable source. Only the server-discovered path, stat, format, and field mapping reach parser/filesystem code. The page and API share this resolver.

Legacy `file=` links may redirect only after a safe equality match to the current inventory. A file merely located beneath a broad root is insufficient. Detect-only files, wrong formats/extensions, mismatched sources, and escaping symlinks never reach the parser. Pruned sessions resolve to an archived-summary/raw-unavailable state without accepting an arbitrary replacement path.

## Revision-Bound Transcript Windows

The initial view and each continuation return at most 240 semantic turns. A continuation cursor is opaque and bound to:

- source-qualified session identity;
- source file revision/stat/content identity;
- parser version and descriptor mapping context;
- next byte/record position plus the minimal semantic pairing state required to continue correctly.

The next window resumes from the cursor rather than scanning the complete file from byte zero. If the source changes, the server rejects the stale cursor with a recoverable refresh response; it never splices two revisions together.

Full counts may be precomputed/cached or reported as pending/partial. The first window must not require an unbounded full-file read solely to display an exact total. Call/result pairing that crosses a page boundary remains correct, and bounded prior context is explicit.

## Session Brief

The source-qualified session route leads with a plain-language brief before the expert transcript:

- task/title, project, harness, model, time, duration, and lineage;
- concise “what happened” evidence assembled from existing bounded summaries, not an untraceable generated claim;
- outcome/error/tool/usage signals with measured/inferred/missing/malformed provenance;
- scan/parser/raw availability and exact denominator/partial warnings;
- related OpenEval evaluation attempts when a runner session ID or stored observation reference matches;
- direct disclosure to conversation, reasoning, tools, errors, raw source when present, and normalized projection.

No summary replaces the raw source. Missing or pruned raw evidence stays visible as a limitation.

## Tests

- Hermetic temp-root resolver tests cover valid discovery, inside-root-but-undiscovered files, detect-only files, wrong format, source mismatch, escaping symlink, prune/archive, and legacy redirect.
- Window tests prove 240-turn caps, correct cross-window tool pairing, stale revision rejection, and no complete rescan for the second page of a large fixture.
- Session-brief tests trace every displayed claim to source fields and preserve unknown/partial/raw-unavailable states.

