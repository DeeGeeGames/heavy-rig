# Warden sprite-stacking proof

Experimental visual proof, awaiting owner review. This is separate from the
production renderer and PR 67's approved model checkpoints.

Build the self-contained interactive study with `bun run study:sprite-stacking`,
then open `dist/sprite-stacking-study.html`. It works offline with no server.
The HTML template is `sprite-stacking-preview.html`; its data placeholder is
filled by the build command, so opening that template directly is not supported.

## What it demonstrates

The browser uses **Canvas2D and horizontal PNG slices only**. It loads no GLBs,
meshes, shaders or 3D library. It rotates every slice around the vertical axis,
squashes its footprint for the camera, and raises it by its sampled height.
Torso and leg headings are independent. Their layers are interleaved by absolute
height so lower-hanging weapons are not simply painted over the entire pelvis.

One torso sheet is shared by all motions. The lower body has 16 sampled poses for
each approved walk, run and dedicated backward cycle. The waist translation and
height recorded for each pose connect the two stacks. Layer explosion and the
sheet inspector expose the actual source slices.

## Offline source and reproduction

Source: PR 67, commit `9881bcfbc23d9fd1109f5f33609900ad9869ea17`, retained
`design/mechs/assets/warden/components/{walk,run,backward}/` packages. The proof
uses the **unoptimized shared chassis** and the two launcher cartridges. None
of the stage 7 optimized pods or experimental gun reductions are required.
Exact source and output PNG SHA-256 values are in `manifest.json`; the exporter
rejects inputs that do not match this frozen source.

In a checkout of that source revision, restore its Git LFS assets. Then run
Blender 5.2 with absolute paths (the Flatpak resolves relative paths internally):

```sh
flatpak run org.blender.Blender --background --factory-startup \
  --python /absolute/proof-repo/scripts/sprite-stacking/export_warden.py -- \
  --source /absolute/source-repo/design/mechs/assets/warden/components \
  --output /absolute/new-output-directory --samples 16
```

The source model evaluates **offline only**. BVH surface crossings sample the
whole torso/lower assembly into a volume at 96 pixels per source unit. Sampling
the entire assembly avoids treating every open mesh partition as a separate
solid. One fixed neighborhood pass suppresses isolated chips and tiny cracks;
voxel density supplies simple palette shading. Blender's image API encodes the
PNGs; it does not render images of the model. No retopology, decimation, LODs,
normal baking or hand-edited component geometry is used for this proof.

Output sheets contain 128 by 128 pixel slices, eight across, ordered from lowest
to highest. `zMin` and waist anchors are in voxel units. The footprint is Blender
X/Y; height is Z; forward is -Y. The palette and lighting are experimental and
object-relative, so shading turns with each stack.

## Boundaries of this result

- This proves a slice-based representation and animated lower-body frames. It
  does not remove the need to author three-dimensional form: this trial reuses
  the retained model; a future source could be a deliberately simple voxel model.
- Generated source surfaces are imperfect. Unpaired ray hits receive a bounded
  one-voxel shell. Sampling counts are recorded in `sampling-report.json`; this
  is an approximate visual volume, not a watertight reconstruction or collision mesh.
- The torso stays upright. Source torso pitch, roll, independent weapon elevation,
  recoil and equipment swaps are not represented in this proof.
- Fixed cycles do not establish planted-foot turns, speed changes, stopping,
  motion transitions, terrain adaptation or compatibility with the runtime gait.
  Idle currently holds the first walking pose.
- Nearest-neighbor rotation can make pixels flicker along thin edges. Art quality,
  final palette and gameplay resolution require owner review.
- Height sorting works for these horizontal layers; game-world occlusion,
  perspective title/hangar views, lighting and shadows need separate integration.
- This one-mech study is not a memory, crowd or hardware benchmark. Decoded atlas
  memory and overlapping sprite draws must be measured before a roster-wide pivot.

The PNGs and manifest are retained so the proof is reviewable without Blender or
access to PR 67's large authoring assets. Rejected sampling experiments and QA
screenshots are not part of the deliverable.
