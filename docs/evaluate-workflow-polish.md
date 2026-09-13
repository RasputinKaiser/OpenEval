# Evaluate workflow polish

The six-page Evaluate navigation now uses a two/three/six-column responsive grid. All destinations remain visible, with the existing hover, focus, active-state and reduced-motion styling. Contextual guidance explains the next step on Runs, Leaderboard, Compare, Cases, New Run and Accuracy. The playground is accessible from every Evaluate page.

Case cards separate task inspection from run setup. Expand the grading contract to read the actual prompt, configured pass threshold and grader weights. Five supported reference demos link to their exact playground section. Setup links continue to preselect the exact case. Case category links preserve the current search; matching trims surrounding whitespace.

This pass changes navigation and case presentation, not executor behavior or benchmark scoring. Existing benchmark identities and uncommitted work are preserved. No paid evaluations or publication were initiated.

Validation: full tests passed after updating two source contracts for the intentional label/grid changes. Production and browser validation recorded in state.yaml.

Production build, lint and post-build typecheck passed. Browser visited all six destinations and verified search/category preservation, trimmed matching and keyboard disclosure. Narrow screenshots showed the two-column navigation; light/dark layouts were reviewed. The browser geometry query timed out under viewport emulation; exact touch-target measurements were not established. Preview restored to desktop dark mode.
