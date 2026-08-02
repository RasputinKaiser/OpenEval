# OpenEval evidence pulse

`openeval-evidence-pulse.toe` is the original editable TouchDesigner source for `../assets/td-evidence-pulse.mp4`.

`openeval-focus-field-v5.toe` and its TouchDesigner-generated save sibling are the v5 focus-field network. The network uses the ImageGen plate at `../assets/openeval-evidence-field-v1.png` as its Movie File In source, passes it through the animated displacement/noise chain, and keeps `out1` as the compositing output.

- Source network: `/project1/openeval_pulse`
- Output: 1280x720 TouchDesigner Non-Commercial frames, deterministically upscaled to 1920x1080 during H.264 encoding
- Duration: 3 seconds at 30 fps; visible scan motion finishes in the first 1.2 seconds
- Integration: the scan is used as a restrained full-frame screen-blend layer at 0.0–1.2, 2.12–3.32, and 22.70–23.90 seconds; opacity is deliberately reduced after the quarter-second readability review.
- Brand color: OpenEval violet `#7c5cff` over ink-black

The pulse effect is a vertical signal displaced by sparse noise and composited over the sharp field. The v5 network adds the generated evidence field as the source texture. Both remain supporting layers: authentic OpenEval dashboard footage stays dominant throughout the proof sequence.
