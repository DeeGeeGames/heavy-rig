# Warden isolated torso stack

This is a static chest/cockpit fidelity test following the distorted whole-mech
experiment in PR 68. It does not approve a graphics pivot, a complete model, or
leg animation. The selected A2 concept remains the only owner-approved art.

Run `bun run study:torso`, then open `dist/torso-stack-test.html`. The output is
self-contained and works without a server. It is separate from the game and the
earlier whole-mech study.

## What is being tested

- One deliberately authored volume, described by nine chamfered cross-section
  keyframes in `volume.json`, with shallow lower-front armor relief.
  Intermediate horizontal sections are interpolated. The cockpit slit and side
  opening are painted details; their black pixels do not establish cavity depth.
- 29 horizontal 48 × 48 RGBA sprites, packed eight across in `layers.png`.
  Canvas2D rotates and vertically compresses those sprites, offsets them by
  height, then composites them from bottom to top at logical resolution.
- The completed logical image is enlarged by an integer with nearest-neighbor
  sampling. Individual slices are not enlarged before projection.
- There is no mesh source, 3D engine, generated turnaround, silhouette
  intersection, lighting calculation, rig or animation in this test.

`unpainted.png` contains the identical geometry in one flat source color. The
plain-volume, rotation and exploded-layer controls expose the underlying stack.
Changing the camera never changes a voxel's stored color. The optional reference
overlay starts at zero and is explicitly marked when active.

## Reference and fixed paint

`reference.json` records a manual isolation polygon and the SHA-256 of the
selected A2 image at `../warden-sprite-stacking/art/approved-concept.png`.
It excludes the pods, cannons, legs and waist. The original source pixels are
cropped and uniformly reduced with nearest-neighbor sampling into the shared
48 × 48 frame. The reference is not stretched to the result.

The static camera is yaw 212°, elevation 34°, origin (24, 35). This is an
approximate camera match to stylized art, not a recovered physical camera.
Both panels use the same frame and integer display scale at that camera.
Other cameras use an explicitly padded diagnostic frame to avoid clipping.

`paint.json` freezes 687 color anchors sampled from the isolated reference onto
the visible voxel IDs at that camera. Each occupied reference/result pixel pair
contributes its original RGB color; the most frequent sample wins if a voxel
covers several pixels. Nearest reference colors fill the small silhouette
mismatch. These anchor colors extend through each solid slice by nearest XY
distance, with a flat placeholder on the unobserved rear/far-side boundary.
This prevents a thin painted skin from exposing speckled unpainted interiors.
All 285 resulting RGB colors occur in the selected A2 image.

This is one-view paint fitting. The low RGB error is a check of that fitting,
not an independent fidelity score. Hidden-face colors are extrapolated
placeholders, with visible bands and incomplete features when rotated. They
have no approved reference. This test does not establish all-angle fidelity.

## Reproduction and diagnostics

Use Python with Pillow 12.3.0:

```sh
python scripts/sprite-stacking/export_torso_test.py
bun run study:torso
```

The selected image hash is checked before export. The build verifies embedded
PNG hashes. `volume.json`, `reference.json` and the fixed `paint.json` are the
editable source; no Blender file or generated orthographic sheet is needed.
Changing geometry or camera invalidates the current paint calibration and
requires repainting/recalibration. The exporter checks the frozen volume hash,
camera and source hash, and rejects a changed volume rather than silently
regenerating paint for another camera.

`ids.png` assigns a deterministic RGB identifier to each occupied voxel for
offline calibration. It is not embedded in the viewer. `calibration.json`
records the matched-view silhouette intersection/union and mean absolute RGB
channel error on overlapping opaque pixels. The contour reaches 713 / 783
(91.06%) overlap; its roof and lower outline still differ from the concept.

Each atlas occupies 294,912 bytes (288 KiB) at RGBA8, including unused tiles.
The viewer loads painted and plain atlases for comparison, plus a 48 × 48
reference. These are allocation equivalents, not measured GPU/browser memory.

The next creative gate is review of this isolated static result. Pods, weapons,
independent torso rotation in the game and the animated legs remain outside
this test. A production sprite-stack workflow would still require coherent
authored cross-sections and materials for every visible angle.
