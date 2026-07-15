# OpenEval Launch Film v3

This is the curated, reproducible source bundle for the 29.5-second OpenEval v0.1 launch film.

## Included

- HyperFrames root composition and seven scene compositions.
- Fourteen privacy-reviewed OpenEval dashboard clips used by the film.
- TouchDesigner focus-field project and rendered pulse asset.
- ImageGen evidence-field plate and final music bed.
- Storyboard, release contract, validation helper, video poster, 1280×640 social preview, and delivery master.

Intermediate renders, snapshot audits, contact sheets, redundant footage copies, and capture caches stay outside the public bundle.

## Preview and render

```bash
npm run release:preflight
npm run check
npm run dev
npm run render
```

After promoting a new render to `renders/video.mp4`, run:

```bash
npm run release:verify
```

The release gate checks the 29.5-second duration, 2-3.5 second attention-reset cadence, integrated OpenEval and Right to Intelligence closing acknowledgment, current render freshness, codecs, dimensions, frame rate, audio contract, and SHA-256 receipt.

## Credits

GPT-5.6 Sol (High) led the edit, HyperFrames composition, pacing, visual QA, and final release pass. GPT-5.6 Luna (xhigh) contributed additional iteration passes.

The production stack includes OpenAI Codex and ImageGen, TouchDesigner, HyperFrames, GSAP, CDP Recorder, and FFmpeg.
