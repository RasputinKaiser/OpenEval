# OpenEval dashboard clip pack — 2026-07-15

Fourteen short, silent UI clips recorded from the live OpenEval dashboard at
`http://127.0.0.1:3000`.

## Delivery

- `clips/` — 14 H.264 MP4 clips, each exactly 3.0 seconds
- `stills/` — matching mid-clip JPEG frames
- `contact-sheet.jpg` — the 14 stills in filename order, left-to-right and top-to-bottom
- `review-reel.mp4` — all clips joined with hard cuts for a 42-second review pass

All clips are 1920×968 at 30 fps. The browser was seeded with OpenEval's dark
theme, onboarding dismissed, and Live username redaction enabled.

## Clip index

| # | Clip | Route | Moment |
|---:|---|---|---|
| 01 | `01-dashboard-overview.mp4` | `/` | Metrics, recent sessions, outcome impact |
| 02 | `02-dashboard-components.mp4` | `/` | Scrolling dashboard components and recent runs |
| 03 | `03-live-usage-quality.mp4` | `/live` | Live usage and data-quality panels |
| 04 | `04-live-sessions-intelligence.mp4` | `/live` | Scrolling sessions and trace-intelligence panels |
| 05 | `05-collection-overview.mp4` | `/collection` | Collection totals and usage distribution |
| 06 | `06-timeline-trends.mp4` | `/collection/timeline` | Timeline and impact trends |
| 07 | `07-new-run-builder.mp4` | `/runs/new` | New Run configuration and preflight summary |
| 08 | `08-runs-history.mp4` | `/runs` | Run history and pass-rate rows |
| 09 | `09-leaderboard.mp4` | `/runs/leaderboard` | Harness leaderboard |
| 10 | `10-compare-runs.mp4` | `/runs/compare` | Side-by-side run comparison |
| 11 | `11-run-confidence.mp4` | `/runs/39e17453` | Visual run confidence and case timeline |
| 12 | `12-cases-library.mp4` | `/cases` | Searchable case library |
| 13 | `13-bench-telemetry.mp4` | `/runs/39e17453/bench` | Bench telemetry integrity and charts |
| 14 | `14-accuracy-audit.mp4` | `/accuracy` | Accuracy audit and evidence mix |

## Verification

- Every target route returned HTTP 200 with the `OpenEval` page title before capture.
- Port 3002 was explicitly excluded after it was identified as HyperFrames Studio.
- Every clip decodes as H.264, 1920×968, 30 fps, and 3.000 seconds.
- The review reel decodes as H.264, 1920×968, 30 fps, and 42.000 seconds.
- Representative frames were visually reviewed through `contact-sheet.jpg`.
