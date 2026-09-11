# OpenEval visual system

## Authority
The incumbent implementation in app/globals.css and shared components is the visual authority. This document records the accepted refinement direction; it does not replace the existing visual identity.

## Style
Charcoal dark theme and white/light theme; violet accents; semantic green, amber and red; compact sans-serif headings and labels; monospaced tabular measurements; 12px rounded surfaces; quiet borders. Preserve existing navigation and page hierarchy.

## Analytical behavior
Operate and Read surfaces use progressive disclosure: overview, inspect, then explore evidence. Hover/focus inspects; click/tap pins; explicit evidence actions select or navigate. Every graphic has labeled units, population/coverage, keyboard access, non-color status cues and a data alternative. Axes use measured container width. Motion is short, interruptible and removed under reduced motion. Keep controls usable on phones without shrinking chart text to fit.

## Data boundaries
Date controls explicitly use UTC and exclusive upper bounds; the existing activity heatmap remains local time and says so. Redaction-safe source/session references connect to existing transcript routes. Preserve separate measured, inferred, missing, stale, partial and sampled states.

## Refinement details
The desktop sidebar fits the viewport with independently scrolling navigation and fixed support/theme controls. Runs prioritizes filtering and run selection before optional analysis. Evidence detail uses progressive disclosure for record lanes, task episodes, excerpts, and model review history. Review queue previews disclose source/date/model scope, reasons, session budget, serial execution, and freshness. An insufficient-evidence outcome has no numeric quality score.
