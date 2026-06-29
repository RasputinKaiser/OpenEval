# OpenEval Launch Video Design

## Style Prompt

A dark operator-console launch film for OpenEval: precise, local-first, evidence-led, and public-release ready. The frame should feel like a high-confidence evaluation cockpit rather than a marketing landing page. Use dense but readable data surfaces, large editorial title moments, violet signal accents, and restrained terminal-inspired motion. The visual language is derived from the existing OpenEval app palette in `app/globals.css`.

## Colors

- `#0a0a0b` — primary canvas, near-black with a slight cool tint.
- `#111113` — elevated panels and secondary scene fields.
- `#26262b` — borders, dividers, dashboard grid lines.
- `#e8e8ea` — primary foreground text.
- `#8b8b94` — muted explanatory text.
- `#7c5cff` — OpenEval violet accent, used for key reveals and transitions.
- `#3fb950` — verified/pass state.
- `#d29922` — warning/provenance state.
- `#f85149` — failure/risk state.

## Typography

- Headlines: `Georgia`, 800-900 weight where available, tight but readable. Editorial weight against the technical UI.
- Data, labels, and counters: `Menlo`, `Monaco`, or `ui-monospace`, 400-700 weight with tabular numbers.
- Supporting copy: system sans, 350-500 weight. Keep it secondary to the serif headline and mono data voice.

## Motion

- Entrances should feel precise and tool-like: line draws, panel reveals, short x/y offsets, scale catches.
- Scene changes use violet block wipes and focus/blur holds, not jump cuts.
- Ambient motion is subtle: slow grid drift, glow breathing, and data-line scanning.
- Missing values and privacy boundaries must feel intentionally labeled, not hidden.

## What NOT To Do

- Do not use generic blue gradients or neon cyberpunk overload.
- Do not show local stats as something being uploaded.
- Do not use random particle fields or non-deterministic motion.
- Do not use Inter, Roboto, or other default SaaS typography.
- Do not imply the repo is public if the GitHub visibility has not been flipped yet.
