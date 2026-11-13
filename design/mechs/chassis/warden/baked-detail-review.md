# Warden baked detail trial

Status: visual experiment, not approved or integrated into the game. Preserve the approved high-detail master as the bake source.

## Method

Use one low-poly shared chassis, with individual animated parts retaining their pivots and transforms. Allocate more triangles to guns, optics, and shoulder housings; aggressively reduce shallow armor detail. UV-pack the entire chassis into a shared 2048×2048 atlas. Each left/right cartridge has its own 512×512 atlas. Bake tangent-space normals from matching high-detail parts, then export those maps inside component GLBs. This trial uses neutral base color/roughness; it does not invent painted textures or claim that color/roughness/AO were baked.

Recipes:

- `scripts/mech-design/blender/bake_detail.py`: hash-verifies approved interface source, creates the low-poly candidate, UV atlases and normal bakes, and enforces an assembled total below 20,000 triangles.
- `scripts/mech-design/blender/package_components.py`: exports shared animated chassis and socket-local cartridges with embedded normals and tangent attributes. `SOURCE_OVERRIDE` is an explicit hash-checked derivative input, not a new approval record.
- `scripts/mech-design/blender/render_baked_detail.py`: imports actual exports and compares high source, low geometry without normals, and the same low geometry with normals under identical material/light settings. Workbench/clay mode is insufficient for this review because it ignores the normal textures.
- `scripts/mech-design/verify-normal-textures.py`: checks embedded PNG payload decoding, material normal-texture links, UVs, and tangent presence.

## Lessons

The first bake joined all parts during projection, introducing dark shoulder-edge artifacts. Pairwise baking avoids projecting nearby parts onto one another while keeping a shared atlas. Tangents were initially missing from two n-gon housing meshes even with tangent export enabled; explicitly tessellate n-gons before baking/export. Exported tangent attributes must be checked rather than assumed.

More geometry is necessary where the low-poly surface diverges too far from the source, particularly around shoulder shell openings. A normal map changes shading, not silhouette or occlusion. The revised candidate increases those housing budgets from 6.5% to 16% of source geometry while retaining the overall 20,000-triangle limit.

Headless Three.js verification uses placeholder textures solely to check geometry, hierarchy, and motion. It does not validate texture decoding or browser GPU shading. The separate image-payload check and actual-export Blender renders cover additional evidence, but browser rendering/performance remains a future gate.

Each active variant uses one 2048 atlas plus two 512 atlases. PNG transfer size and decoded GPU texture memory are separate costs; no GPU performance claim is made. Atlases do not by themselves combine the many rigid objects into fewer draw calls. Final texture compression, rigid-part consolidation, material polish and production integration remain outstanding.

## Current candidate and validation

Current source: `design/mechs/generated/warden-baked-v5/baked.blend`; exported assembly: `design/mechs/generated/warden-baked-components-v6/`. Earlier revisions are superseded experiments. A is **19,459 triangles**, B **18,983**, C **19,210**, including shared guns and shoulder cartridges. Blank-cover assembly: 17,961.

Reproduction order: run `bake_detail.py` (v3), then `filter_baked_normals.py` (v5), then `package_components.py` with the v5 path/SHA as `SOURCE_OVERRIDE`, `SOURCE_SCENE='Warden baked trial v1'`, and `OUTPUT_FOLDER='warden-baked-components-v6'`. Render with `render_baked_detail.py`. Outputs are guarded against overwrite.

The filter rejects back-facing projected normals and falls back to geometric normals at those texels. This is a defensive fallback, not proof that all projection artifacts are resolved. The two rear shoulder housings still had visible edge artifacts after pairwise baking and extra geometry; they use geometry-only shading in this candidate. Unchanged blank covers also use geometry-only shading. Their materials are explicitly named `Geometry_only_*`; the payload verifier permits those exceptions and still requires maps on all other primitives. Housing bake cleanup remains an authoring task, not a hidden pass.

Actual exported GLBs pass the four-state 91-frame transform and triangle-count checks, all A/B/C straight-ray checks, and the normal-texture payload/UV/tangent checks. Source-to-baked motion samples were also compared: zero matrix difference before export. The source atlas is reused across A/B/C; modules remain independent. All 426 project tests, typecheck, lint, and build passed after adding the texture-aware headless validators.

Owner review concerns are restored shallow surface detail, remaining geometric faceting, weapon opening shapes, and atlas quality. This is not yet a production-ready texture set or accepted visual replacement. Exact browser material rendering and performance are untested.

Final render inspection still shows some dark edge artifacts near cartridge collars and visibly faceted low-poly armor. The housing material exception does not establish a clean whole-mech bake. Present v6 as a proof of concept for detail transfer, not a finished asset or approval-ready production model.
