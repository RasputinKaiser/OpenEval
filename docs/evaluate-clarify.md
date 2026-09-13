# Evaluate clarify pass

Audience: people choosing local agent evaluations, including users unfamiliar with benchmark shorthand. Preserve OpenEval terminology when it has technical meaning, explaining it at the decision point.

| Before | After | Purpose |
| --- | --- | --- |
| Start with Core suite | Set up Core suite | Makes clear this opens configuration |
| Repeat last run | Reuse last run settings | Does not imply an immediate launch |
| Build a benchmark recipe | Choose a starting suite | Removes an unnecessary metaphor |
| Visual lanes | Visual cases | Uses the same noun as the library |
| Samples (pass@k) | Attempts per case (samples) | Explains the setting before metric shorthand |
| Task & grading contract | Task & pass criteria | Names the information users are seeking |
| Declared reference answer | Cases with a reference solution | Clarifies what the count measures |

Case pass criteria now explain weighted checks and the forbidden-check override; infrastructure errors remain distinct. Suite evidence charts explain overlapping counts and declared-versus-collected evidence. Budget copy explicitly describes configuration, excluded undeclared budgets and its distinction from a spend estimate. Existing benchmark prompts, grader configuration, selection behavior and score computation are unchanged.

Two source-contract tests were updated for intentional heading/action wording changes. Verification results are recorded in state.yaml.

Verification: full suite passed after wording assertion updates. A browser-discovered singular/plural issue was corrected and the final production build with lint and post-build typecheck passed. Browser confirmed exact selected case, task/pass explanation, singular planned attempt and samples help wrapping at 390px (305px content and scroll width). No evaluation was launched. Preview restored to desktop Cases.
