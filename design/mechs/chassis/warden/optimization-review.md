# Warden optimization v1

Status: conservative geometry candidate, owner visual review pending. No game asset replacement, scale mutation, or gameplay changes.

Recipes: `scripts/mech-design/optimize-components.py`, `audit-firing-scale.ts`, and `blender/render_components.py`. Inputs: validated `warden-components-v2`. Outputs and hashes: `design/mechs/generated/warden-optimized-v1/optimization.json`. Large assets and reports remain local ignored files.

## Geometry and motion

Pinned glTF Transform CLI 4.3.0 simplifies each component independently with ratio 0.5, error 0.001, and locked topological borders. This is an error-limited target, not a promised 50% reduction. No transform flattening, node joining, texture conversion, or decoder extension is introduced. The common chassis is optimized once for all variants.

| Component | Original triangles | Candidate triangles |
| --- | ---: | ---: |
| Shared chassis | 182,109 | 125,701 |
| Left energy | 4,021 | 2,657 |
| Right energy | 4,110 | 2,510 |
| Left launcher | 5,400 | 3,372 |
| Right launcher | 5,374 | 3,398 |
| Each blank cover | 220 | 220 |

Shared chassis file size decreases from 4,678,056 to 3,661,220 bytes. This is a conservative reference derivative, not an established production polygon/draw-call budget. Separate objects remain numerous; rigid assembly consolidation and more aggressive LODs remain future work.

`verify-components.ts` passes for A/B/C/empty, preserving all checked world matrices over 91 frames (maximum component error 1.51e-6). Original source transform samples are retained in the candidate manifest; triangle counts intentionally change and are recorded separately from `sourceGeometry`. The derivative triangle check detects missing exports, not simplification quality. Matched source/candidate renders import actual GLBs and use the same neutral studio shading, cameras, and pose. They review geometry, not final production materials or lighting.

## Firing origins

`audit-firing-scale.ts` loads actual GLB assemblies and casts double-sided rays forward from all four anchors at every walk frame. Each A/B/C assembly has 364 clear rays in both source and simplified versions. This checks straight-ahead muzzle obstruction for a two-source-unit distance, not full turret aim arcs, projectile radius, bore alignment, or launcher tube placement. Bank anchors remain logical centers; per-tube launcher origins must be authored before production firing effects. No origin was silently relocated based only on this audit.

## Scale reference

Current standing production Warden bounds are approximately 79.90 wide × 101.75 high × 94.00 deep in game units. New source bounds are 0.94952 × 0.97481 × 0.71882. A uniform height-match factor of 104.37908 would produce approximately 99.11 × 101.75 × 75.03. This differs in proportions from the current model and requires an integration decision; it does not authorize collision or balance changes. These units are not established physical meters. Source ground bottom is approximately zero.

Keep authoring files at their shared scale for now. At integration, use one common chassis-root scale so sockets, cartridge geometry, muzzle anchors, and root-motion displacement inherit it exactly once. Never separately scale each cartridge to a world-space target height. Production forward-axis conversion must also follow the existing runtime aiming contract.

## Next gate

Owner reviews simplified appearance against source. Approval allows further asset preparation; it does not accept in-game performance, aim integration, physical scale, or gameplay replacement.

## Under-20,000-triangle trial

Owner requested a separate candidate below 20,000 total triangles including weapons. `warden-under20k-v3` meets the budget: shared chassis 18,145; A 19,221; B 18,954; C 19,081; empty covers 18,585. Status: unapproved visual experiment. Original approved sources remain unchanged.

The glTF Transform aggressive attempt (`optimize-components.py --under-20k`) stopped around 30,000 triangles and failed its budget assertion. Blender collapse decimation at 0.075 produced approximately 14,000; v3 uses 0.10 for more detail while remaining below budget. The blank-cover bevel geometry is retained without decimation.

Reproduce v3 in the Blender execution environment by setting `REPO_ROOT`, `DECIMATE_RATIO=0.10`, and `OUTPUT_FOLDER='warden-under20k-v3'` before running `blender/package_components.py`. Outputs refuse overwrite. Render with `CANDIDATE_FOLDER='warden-under20k-v3'` using `blender/render_components.py`. Run `verify-components.ts` and `audit-firing-scale.ts` against that output directory. All four assembled states retain checked transforms over 91 frames (maximum error 1.51e-6); A/B/C straight-ray checks remain clear. These checks do not establish unchanged geometry, appearance, physical clearance, or full aim behavior.

Visual tradeoffs: silhouette remains recognizable; circular bores and optics become angular, vents lose detail, and small armor surfaces become rounded or irregular. Matched neutral studio renders expose these changes without texture or normal-map baking. This is a budget experiment, not polished retopology or an accepted production model. A production low-poly pass may need targeted protection of bores, optics, and silhouette edges, plus baked surface detail, after owner direction.
