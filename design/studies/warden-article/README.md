# Four-view sprite-stacking reproduction

This study follows the conversion and drawing rules in the
[SpriteCook article](https://www.spritecook.ai/blog/sprite-stacking-pixel-art).
It replaces the previous experiment's single-view fitting as the primary test
of that process. The game renderer and PR 67 are separate.

Build `bun run study:article`, then open `dist/article-stack-study.html` offline.
The four actual inputs, a slice inspector, the rotating result and the article
car control are included. Defaults are static yaw 0, squash 0.75, spacing 1.

## Inputs

Warden uses the retained generated `../warden-sprite-stacking/art/source-sheet.png`,
not the angled A2 illustration. `input-regions.json` names its top, side, front
and back quadrants. Preparation thresholds alpha at 128, tightly crops each
view and applies one shared nearest-neighbor scale of 32/592. Original RGB is
retained. This preparation does not fit a volume, center a waist, substitute a
grayscale palette or transfer paint from an oblique image.

Prepared sizes are top 28 × 25, side 24 × 32, front/back 30 × 32. These are
intended orthographic drafts, not validated turnarounds. Dimensions differ,
details disagree across views, and the nominal top view depicts muzzle openings
that are inconsistent with the side view. The side arm hides part of the chest,
so this test uses the static full mech rather than incomplete isolated chest
silhouettes. No new paid art generation was performed.

The car inputs in `control/` come from the article's published illustration,
reduced from its exact 6× enlargement after removing the white presentation
background. `control/source.json` pins the source URL, hash, crops and native
dimensions. This attributed third-party art is a diagnostic control only and
is not imported by the production game.

## Conversion rules

`article_converter.py` independently implements the published algorithm:

1. Remove dark boundary outlines using the adjacent interior pixel.
2. Quantize all four views onto one shared 24-color palette, without dithering.
3. Flip the left-facing side input to match forward +Y. The known top input
   already faces down. The article exposes these orientation choices as options.
4. Keep the top view's footprint. Compute height from the side aspect ratio;
   nearest-resize side/front/back to that shared width, depth and height.
5. Intersect the top footprint with each side row and the **union** of front and
   back rows. The front/back union follows the actual published Python code.
6. Color column tops from the top view; color a two-pixel boundary from the
   appropriate side/front/back row; carry the color above through deeper cells.
7. Export one row of horizontal RGBA layers, ground first, with shade 0, the
   published CLI default. Optional shade 0.25 is covered by the reference check.

The adaptation is explicit view naming: the article's detector assumes the
most elongated drawing is the car top and the widest drawing is the side. A
wide mech does not satisfy that assumption. Naming the views changes neither
the carving nor the color-transfer rules. The article's dimension fitting is
retained; its ability to resize images does not validate their geometry.

Warden exports 33 layers of 28 × 25 pixels (92,400 RGBA8 bytes); the car exports
15 layers of 24 × 43 (61,920 RGBA8 bytes). These are raw pixel equivalents, not
measured runtime allocations. Source and output hashes are retained in the
input report, conversion report and manifest; the HTML build checks every
embedded PNG hash.

## Rendering

Every layer rotates around `(-floor(width/2), -floor(depth/2))`, compresses
vertically by `squash`, and rises by `round(z * spacing)`. It draws bottom to top
at whole logical pixels, then enlarges the completed frame by an integer.
There is no elevation-dependent lift multiplier or live lighting.

The browser uses an explicit nearest-texel blit of the PNG pixels through that
inverse 2D transform, then puts the completed RGBA frame into Canvas2D. This
avoids transformed Canvas `drawImage` quad-edge antialiasing and scale rounding.
It uses no mesh, depth buffer, 3D engine or pixelated model treatment. The
reference views and selected slice are displayed directly from their PNGs.

## Result and limits

The car remains coherent. Its measured bounds reproduce the article's 24 × 52
at squash 1, 24 × 41 at squash 0.75, and width 43 after a quarter turn.
Warden remains mottled and striped, with column-like legs. That is a failed
fidelity result for these inputs and this automatic conversion, not evidence
that the design is complete or that every sprite-stack workflow must fail.

The full mech has overlapping parts, gaps and overhangs that the flat-view
shortcut cannot resolve reliably. One specific published-code behavior is
preserved: color is copied from the immediately higher layer in a deep cell,
even when that layer is empty beneath an overhang. Warden gains 338 opaque
black voxels although its fitted inputs have no opaque RGB(0,0,0) pixels. The
published converter produces the same output. No hand repair hides that result.

Better consistent views could address source contradictions. Coherent separate
component inputs or hand-edited slices would still be needed for disconnected
and overhanging forms. Those are later experiments. This static test does not
establish independent torso animation, walking legs, artistic acceptance or
production performance. A2 remains the selected style reference.

## Reproduction

Use Python with the pinned NumPy and Pillow requirements:

```sh
python -m venv /tmp/warden-article-venv
/tmp/warden-article-venv/bin/pip install -r scripts/sprite-stacking/requirements-article.txt
/tmp/warden-article-venv/bin/python -B scripts/sprite-stacking/prepare_article_inputs.py
/tmp/warden-article-venv/bin/python -B scripts/sprite-stacking/export_article_study.py
bun run study:article
```

The car inputs are retained. To recover them again, run
`prepare_article_control.py`, optionally with `--source` pointing to the
downloaded illustration; otherwise it fetches the pinned public source.

For independent converter comparison, save the article's Python block locally
and run `compare_article_converter.py --reference /path/to/views_to_slices.py`.
It checks the inspected reference block's SHA-256 before loading it, then
compares every RGBA channel for both datasets at shade 0 and 0.25. The inspected
block hash is `edc1d4bc842aa4129944be4cbd74323d2091f9b16c6de9bf64e965a3d6538b70`.
Browser QA and screenshots remain outside version control.
