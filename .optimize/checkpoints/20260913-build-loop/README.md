# Build loop measurement

Baseline: fae90707e643d04ee685f1c0378e149208ce8e48, codex/app-refinement-evidence, dirty primary checkout. Existing user WIP is excluded from these commits. Commands use OPENEVAL_BUILD_DIR=.next-interactive; preview stopped. before.json and probes.sh retain the full measured workload. Runtime probes use existing fixed synthetic fixtures.

Baseline build 130.286s; trace: node-file-trace-plugin 99.89s. Tests 14.184s median; types 3.508s; lint 2.526s. All probes passed.

Ranking convention: impact is seconds/week at 20 builds/week; confidence is probability of a valid win; effort hours. Build worker trial: provisional 20s/build *20 *0.5 /0.25 =800. Runtime memoization already present, analysis-repeat 0.407s; no new runtime target clears the 2s threshold. Frozen transcript tokens: heuristic chars/4, 62 estimated refetch-waste tokens; below acceptance threshold (10k wasted tokens =60s convention).

First hypothesis: explicitly enable documented Next build worker while preserving the existing webpack callback. Trace manifests contain mutable data; excluding it may change packaging semantics and is deferred. Installed Next plugin does not apply route exclusions to its initial tracing step, so do not assume exclusions fix the dominant 99.89s phase.

## Trial outcome

The supported webpackBuildWorker=true trial passed tests/typecheck/lint/build but did not establish a win: build 138.518s versus 130.286s (+6.3%). Removed the trial line only; prior distDir WIP remains. Typecheck 2.365s versus 3.508s saves only 1.143s and does not clear the 2s absolute threshold. Test median 14.400s versus 14.184s and lint 2.559s versus 2.526s are within noise. Worker trace still spent 101.37s in node-file-trace-plugin. Warm filesystem/build variability means this is a rejected hypothesis, not proof of causal slowdown.

No accepted source optimization this run. No tests were skipped, cached, silenced or weakened. No token reduction was attempted. Raw receipts remain under ignored .optimize/runs; checkpoint receipts normalize cwd only, preserving metric values.

Next run: begin at node-file-trace-plugin, using a controlled fixed runtime-data snapshot and the same build directory. Define which runtime directories are intentionally external before changing trace packaging. Do not retry the worker flag without new evidence. Existing runtime cache parity and cold-scan probes remain available.

Restoration verification: 275.466s, passed. This large variation reinforces that no reliable worker benefit or causal regression was established. Full baseline and trial suites passed; final restored build passed.
