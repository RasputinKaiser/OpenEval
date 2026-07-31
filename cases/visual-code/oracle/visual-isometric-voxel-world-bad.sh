#!/usr/bin/env bash
set -euo pipefail
# Plausibly wrong: it has the title and nine repeated elements, but no actual
# CSS perspective, 3D preservation, distinct layers, or material composition.
cat > voxel-world.html <<'HTML'
<!doctype html><html><head><title>OpenEval Voxel World</title><style>
body{background:#111;color:white}.stage{height:300px}.voxel{display:inline-block;width:50px;height:50px;background:#777;margin:3px}
</style></head><body><h1>OpenEval Voxel World</h1><section class="stage">
<div class="voxel"></div><div class="voxel"></div><div class="voxel"></div><div class="voxel"></div><div class="voxel"></div><div class="voxel"></div><div class="voxel"></div><div class="voxel"></div><div class="voxel"></div>
</section></body></html>
HTML
