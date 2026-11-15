# Warden pixel-art sprite-stacking proof

The owner selected the **coarser A2 concept**: “Proceed with this design.” Its
exact PNG, prompt and hash are retained in `art/approved-concept.png` and
`approved-art.json`. Approval covers that concept. The new projection images,
inferred volume and voxel-part motion remain drafts for visual review.

Build with `bun run study:sprite-stacking`, then open
`dist/sprite-stacking-study.html` offline. The template's data placeholder is
filled by that command, so opening `sprite-stacking-preview.html` directly is
not supported. The proof is separate from production gameplay and its renderer.

## Pixel-art source workflow

The active proof is reconstructed from **pixel-art projection images**. It uses
no mesh or Blender input. The browser draws horizontal PNG slices with Canvas2D;
there is no 3D renderer, shader or pixelation pass.

`art/source-sheet.png` is a generated top/side/front/back sheet based on A2, with
the original approved Warden views supplying hidden-form reference. Its prompt,
hash and draft status are recorded beside it. Deterministic preparation aligns
the four views to a 64-pixel ground grid and 48-pixel height, a shared floor and
waist origin. All four normalized PNGs and the fitting assumptions are retained
under `art/projections/`.

The exporter intersects top and side silhouettes with the front/back silhouette
union to construct a visual hull. It infers hidden volume, rather than recovering
exact geometry from the drawings. The retained silhouette overlap scores are
0.934 front, 0.933 back, 1.000 side and 0.993 top; these are axis-projection checks,
not proof of correct hidden or oblique surfaces.

Five gray tones shade voxel surfaces; interiors use a stable flat tone. Dark
features project only onto matching outer faces and stay away from silhouette
edges. Each launcher retains its eight painted aperture marks; these are not
carved tube cavities. Source contour colors are not extended through the volume.

The lower body splits into pelvis, thighs, shins and feet. Rigid voxel-part
transforms and a simple two-bone solve produce 16 poses for each walk, run and
dedicated backward cycle. The new gait is an in-place proof, not the previously
approved 3D motion. Editable pivot and split data are retained in `rig.json`.
The static upper stack follows each frame's waist position and turns independently.

The renderer composites slices at their logical scale, then enlarges the finished
image with nearest-neighbor sampling. The art's 2× display scale adds no source
texture pixels. Height sorting interleaves the torso and leg layers. Exploded
layers and the sheet inspector expose the actual slice representation.

## Reproduce

Offline authoring requires Python and Pillow (validated with Python 3.14.7 and
Pillow 12.3.0). Runtime/build dependencies remain the existing Bun project stack.
Both export commands require a new output folder and leave retained inputs alone.

```sh
python3 scripts/sprite-stacking/prepare_pixel_views.py \
  --sheet design/studies/warden-sprite-stacking/art/source-sheet.png \
  --baseline design/studies/warden-sprite-stacking/art/approved-concept.png \
  --output /absolute/new-normalized-views

python3 scripts/sprite-stacking/export_pixel_views.py \
  --views /absolute/new-normalized-views \
  --rig design/studies/warden-sprite-stacking/rig.json \
  --source-commit f26d443dcf583d642f1d4cdcb708b008089d37ee \
  --output /absolute/new-stack-output
```

`manifest.json` pins the normalized input hashes, source concept commit, palette,
grid, waist anchors and 49 PNG hashes. `sampling-report.json` records projection
overlap, occupied voxel counts, foot heights and solver clamps. The build verifies
PNG hashes before embedding them in the self-contained HTML. To inspect a fresh
candidate without replacing retained files, pass output HTML and asset directory
as the two optional arguments to `bun run study:sprite-stacking`.

## Memory and acceptance

The 49 sheets contain **18.75 MiB of RGBA8-equivalent pixels**, compared with 171 MiB
for the earlier mesh-derived proof. This measures width × height × 4 across the
images; browser overhead, GPU allocation, crowd performance and frame time are
unmeasured. The new logical grids and fewer height layers account for the
reduction; larger display pixels alone do not save storage. The earlier input
pipeline remains reproducible through `export_warden.py` and PR history, but its
large slice assets are superseded by the active pixel-art proof.

Remaining gates include owner review of the generated projections and oblique
volume, readability of small markings, torso pitch/roll, weapon articulation,
equipment swaps, planted-foot turns, world-speed synchronization, stopping and
motion transitions. The proof has an upright torso, simplified fixed cycles and
an idle pose held from walking. It establishes no terrain, perspective hangar,
world-occlusion, physical controller/touch, audio, hardware or balance acceptance.

Retain the selected concept, current proof and required source dependencies.
Rejected style candidates, intermediate color experiments and QA evidence stay
outside version control.
