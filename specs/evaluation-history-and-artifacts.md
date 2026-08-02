# Bounded Evaluation History and Artifact Evidence

## Evaluation History

Runs and comparison selection use server-side cursor pagination with stable ordering and full matching counts. Page-size controls never claim access to rows the server did not supply, and an operator can search, open, and compare a run older than the first 50 records without loading transcript bodies.

Concurrent insertion cannot duplicate or skip rows within a cursor generation. Empty, stale, malformed, and expired cursor states produce concrete recovery. Rename, tags, saved suites, saved comparisons, and archive taxonomy are future-release organization features.

## Artifact Delivery

Artifact access preserves the existing server-owned workdir and realpath/symlink containment contract. Metadata returns exact kind, media type, byte count, hash, and preview eligibility before content hydration.

Small supported text, HTML, SVG, image, and report artifacts remain inspectable. Binary or oversized artifacts are streamed/ranged or presented as metadata/download-only evidence; they are never synchronously read in full, coerced into UTF-8 JSON, or silently truncated and presented as complete. Artifact bytes remain immutable under inspection.

## API and UI Bounds

Run lists, run overview, Compare, and history selectors do not carry transcript or artifact bodies. Detail routes hydrate only the selected bounded evidence. All unavailable, partial, oversized, unsupported, and raw-missing states stay explicit.

## Tests

- History fixtures exceed 50 runs and prove stable cursor paging, search, old-run opening, comparison selection, full matching counts, and concurrent insertion behavior.
- API payload tests prove list/overview/Compare responses omit transcript and artifact bodies.
- Artifact fixtures cover small supported previews, binary metadata, oversized streaming/range behavior, exact hash/bytes, traversal/symlink rejection, and no full synchronous read.
