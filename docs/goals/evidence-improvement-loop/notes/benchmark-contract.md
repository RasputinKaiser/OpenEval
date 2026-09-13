# Benchmark reporting contract

Extend existing scripts rather than add a second framework. Keep script entrypoint guards so tests/imports do not execute benchmarks. Report a versioned JSON object with fixed workload identity, git revision and dirty state, Node/runtime/OS/architecture, sizes, warmup and measured sample counts, nearest-rank p95 and median, and explicit units. Sizes/samples have hard upper bounds.

Measure synthetic Collection aggregation/filtering, bounded evidence extraction, and existing transcript initial/continuation reads. Existing live parser cache measurements may be included by reusing bench-live functions. Report exact response bytes and source bytes only when actual instrumentation supplies them. OS disk-cache coldness must not be claimed from a fresh path alone. Memory readings are process snapshots or deltas with scope labels, not browser memory. Browser long tasks/navigation/FPS remain unavailable in this CLI report. Do not synthesize those fields.

Use isolated temp/source fixture directories and in-memory/test database. No real source discovery/indexing and no cache writes under real data roots. Fail if workload invalid rather than output zero times. Evidence fixture should include enough records to test continuation and bounds; benchmark one matching fixed workload twice to prove repeatability, without claiming a speedup from ordinary noise.

UI latency is verified separately through ComputerUse. Do not claim the CLI benchmark covers production server cold starts or browser interactions.
